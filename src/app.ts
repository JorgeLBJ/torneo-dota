import { relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PUBLIC_DIR } from './assets.js';
import { adminApp } from './admin/index.js';
import { LoginRateLimiter } from './auth/rate-limit.js';
import type { AppConfig } from './config.js';
import { createRepository } from './db/repository.js';
import { createEvents } from './events.js';
import { publicApp } from './public/routes.js';

export type { AppConfig } from './config.js';

export interface CreateAppOptions {
  db: Database.Database;
  config: AppConfig;
}

/** Largest accepted request body; every form in the app is far smaller. */
export const MAX_BODY_BYTES = 64 * 1024;

export function createApp({ db, config }: CreateAppOptions) {
  const repo = createRepository(db);
  const events = createEvents();
  const limiter = new LoginRateLimiter();
  const app = new Hono();

  app.use(
    '*',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.text('La solicitud es demasiado grande.', 413) }),
  );

  // Static files (CSS, JS, self-hosted hero portraits) are served from ./public under /assets.
  // Asset URLs are fingerprinted (see assetUrl), so they can be cached for a year.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use(
    '/assets/*',
    serveStatic({ root: relative(process.cwd(), PUBLIC_DIR) || '.', rewriteRequestPath: (p) => p.replace(/^\/assets/, '') }),
  );
  app.route('/admin', adminApp({ repo, events, config, limiter }));
  app.route('/', publicApp({ repo }));

  return { app, repo, events };
}
