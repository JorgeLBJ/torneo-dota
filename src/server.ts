import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { configFromEnv } from './config.js';
import { openDatabase } from './db/open.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/torneos.db');

try {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  const { app, repo } = createApp({ db, config: configFromEnv() });
  await ensureInitialAdmin(repo, process.env.ADMIN_PASSWORD);

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
