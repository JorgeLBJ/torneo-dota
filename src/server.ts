import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { resolveSetupToken } from './auth/setup-token.js';
import { configFromEnv } from './config.js';
import { openDatabase } from './db/open.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/torneos.db');

try {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  const setup = resolveSetupToken(process.env.ADMIN_SETUP_TOKEN);
  const { app, repo } = createApp({ db, config: { ...configFromEnv(), setupToken: setup.token } });
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

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(`Startup failed: ${(error as Error).message}`);
  process.exit(1);
}
