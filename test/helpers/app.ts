import type Database from 'better-sqlite3';
import { createApp, type AppConfig } from '../../src/app.js';
import { ensureInitialAdmin } from '../../src/auth/bootstrap.js';
import { openDatabase } from '../../src/db/open.js';

export const PASSWORD = 'secret-pass-1';

export type FormInput = Record<string, string | string[]>;

export interface SendOptions {
  form?: FormInput;
  cookie?: string;
  headers?: Record<string, string>;
}

export interface TestApp {
  db: Database.Database;
  app: ReturnType<typeof createApp>['app'];
  repo: ReturnType<typeof createApp>['repo'];
  events: ReturnType<typeof createApp>['events'];
  /** POST bodies are urlencoded forms with a same-origin Origin header unless overridden. */
  send(method: string, path: string, opts?: SendOptions): Promise<Response>;
  get(path: string, cookie?: string): Promise<Response>;
  post(path: string, form?: FormInput, cookie?: string): Promise<Response>;
  /** Logs in and returns the Cookie header value. */
  login(username?: string, password?: string): Promise<string>;
}

export async function makeApp(config: Partial<AppConfig> = {}, options: { withAdmin?: boolean } = {}): Promise<TestApp> {
  const db = openDatabase(':memory:');
  const created = createApp({ db, config: { secureCookies: false, trustProxy: false, ...config } });
  if (options.withAdmin !== false) await ensureInitialAdmin(created.repo, PASSWORD);

  const send: TestApp['send'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.cookie) headers.cookie = opts.cookie;
    let body: URLSearchParams | undefined;
    if (opts.form) {
      body = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.form)) {
        for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
      }
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (method !== 'GET' && !('origin' in headers) && !('referer' in headers)) headers.origin = 'http://localhost';
    return created.app.request(path, { method, headers, body });
  };

  return {
    db,
    app: created.app,
    repo: created.repo,
    events: created.events,
    send,
    get: (path, cookie) => send('GET', path, { cookie }),
    post: (path, form = {}, cookie) => send('POST', path, { form, cookie }),
    async login(username = 'admin', password = PASSWORD) {
      const res = await send('POST', '/admin/login', { form: { username, password } });
      const raw = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
      if (!raw) throw new Error(`Login failed with status ${res.status}`);
      return raw.split(';')[0]!;
    },
  };
}

/** Extracts the flash cookie (name=value) from a response so a follow-up GET can render it. */
export function flashCookie(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('flash='));
  return raw ? raw.split(';')[0]! : '';
}

/** Follows the flash of a redirect response and returns the text of the next page. */
export async function flashText(t: TestApp, res: Response, cookie: string): Promise<string> {
  const location = res.headers.get('location') ?? '/admin';
  const page = await t.get(location, [cookie, flashCookie(res)].filter(Boolean).join('; '));
  return page.text();
}
