import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { resolveSetupToken } from './auth/setup-token.js';
import { configFromEnv } from './config.js';
import { openDatabase } from './db/open.js';
import { imageStoreFromEnv } from './storage/from-env.js';
import { createShutdown } from './shutdown.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/torneos.db');

try {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  const setup = resolveSetupToken(process.env.ADMIN_SETUP_TOKEN);
  const images = imageStoreFromEnv();
  console.log(images.message);
  const { app, repo } = createApp({ db, config: { ...configFromEnv(), setupToken: setup.token, imageStore: images.store } });
  if ((await ensureInitialAdmin(repo, process.env.ADMIN_PASSWORD)) === 'setup-required') {
    // The generated code is printed once, here; an operator-chosen code is never echoed.
    console.log(
      setup.generated
        ? `Setup required: open /admin/setup and use code: ${setup.token}`
        : 'Setup required: open /admin/setup and use the code from ADMIN_SETUP_TOKEN',
    );
  }

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Torneos listening on http://localhost:${info.port} (database: ${databasePath})`);
  });

  const shutdown = createShutdown({
    server,
    db,
    exit: (code) => process.exit(code),
    log: (message) => console.log(message),
    // Docker sends SIGKILL after stop_grace_period (20 s in deploy/compose.yml): finish well before that.
    timeoutMs: 10_000,
    setTimeout,
    clearTimeout,
  });
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
} catch (error) {
  console.error(`Startup failed: ${(error as Error).message}`);
  process.exit(1);
}
