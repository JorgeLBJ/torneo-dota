/** The parts of the HTTP server the shutdown needs (satisfied by Node's http.Server). */
export interface ClosableServer {
  close(callback?: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
}

export interface ClosableDatabase {
  close(): unknown;
}

export interface ShutdownDeps {
  server: ClosableServer;
  db: ClosableDatabase;
  exit: (code: number) => void;
  log: (message: string) => void;
  /** Longest wait for the server to drain before closing the database anyway. */
  timeoutMs: number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Builds the signal handler for SIGTERM/SIGINT: stop accepting connections, drop the open ones (live SSE
 * streams would otherwise keep the server open forever), close the SQLite database so its WAL is
 * checkpointed, then exit. It runs once however many signals arrive, and never leaves the process hanging:
 * after `timeoutMs` the database is closed regardless.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;

  const run = async (signal: string): Promise<void> => {
    deps.log(`${signal} received: shutting down`);
    let failed = false;

    const drained = new Promise<void>((resolve) => {
      deps.server.close((error) => {
        if (error) {
          failed = true;
          deps.log(`Server close failed: ${error.message}`);
        }
        resolve();
      });
      // Stop accepting first (above), then end the streams that would keep the server open.
      deps.server.closeAllConnections?.();
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = deps.setTimeout(() => resolve('timeout'), deps.timeoutMs);
    });
    const outcome = await Promise.race([drained.then(() => 'drained' as const), timeout]);
    if (timer !== undefined) deps.clearTimeout(timer);
    if (outcome === 'timeout') {
      failed = true;
      deps.log(`Shutdown timed out after ${deps.timeoutMs} ms: closing the database anyway`);
    }

    try {
      deps.db.close();
    } catch (error) {
      failed = true;
      deps.log(`Closing the database failed: ${(error as Error).message}`);
    }
    if (!failed) deps.log('Shutdown complete: database closed cleanly');
    deps.exit(failed ? 1 : 0);
  };

  return (signal) => (running ??= run(signal));
}
