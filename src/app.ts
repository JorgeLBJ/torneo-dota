import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PUBLIC_DIR, assetUrl } from './assets.js';
import { adminApp } from './admin/index.js';
import { LoginRateLimiter } from './auth/rate-limit.js';
import type { AppConfig } from './config.js';
import { clockOf } from './clock.js';
import { createRepository } from './db/repository.js';
import { createEvents } from './events.js';
import { FAVICON_SVG } from './favicon.js';
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
  const accountLimiter = new LoginRateLimiter();
  const now = clockOf(config);
  const app = new Hono();

  app.use(
    '*',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.text('La solicitud es demasiado grande.', 413) }),
  );

  // Static files (CSS, JS, self-hosted hero portraits) are served from ./public under /assets.
  // Only URLs carrying the file's current fingerprint (see assetUrl) are immutable; portraits and the
  // hero background keep plain URLs, so they get a day and are revalidated after that.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (!c.res.ok) return;
    const fingerprinted = assetUrl(c.req.path.slice('/assets/'.length)) === `${c.req.path}?v=${c.req.query('v')}`;
    c.res.headers.set('Cache-Control', fingerprinted ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
  });
  app.use(
    '/assets/*',
    serveStatic({ root: relative(process.cwd(), PUBLIC_DIR) || '.', rewriteRequestPath: (p) => p.replace(/^\/assets/, '') }),
  );
  // Liveness for Docker/monitors: no auth, never cached; 503 when the database does not answer.
  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1').pluck().get();
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'error' }, 503);
    }
  });
  // Crawlers: public pages are open, the backoffice is not (see public/robots.txt).
  app.get('/robots.txt', (c) => c.body(readFileSync(`${PUBLIC_DIR}/robots.txt`, 'utf8'), 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }));
  app.get('/favicon.svg', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }));
  app.get('/favicon.ico', (c) => c.body(null, 204));
  app.route('/admin', adminApp({ repo, events, config, limiter, accountLimiter, now }));
  app.route('/', publicApp({ repo, events, config, now }));

  return { app, repo, events };
}
