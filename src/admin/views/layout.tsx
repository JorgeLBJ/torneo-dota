import { Select } from './parts.js';
import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import { assetUrl } from '../../assets.js';
import type { Admin, Team, Tournament } from '../../db/repository.js';
import type { Flash } from '../flash.js';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=Figtree:wght@400;500;600;700&display=swap';

const PALETTE = ['#e6b65f', '#6fa8ff', '#5fd3a2', '#c58cff', '#ff8f6b', '#e57580', '#62d0e0'];

export const teamColor = (id: number): string => PALETTE[id % PALETTE.length]!;

export const TeamBadge: FC<{ team: Pick<Team, 'id' | 'code'> }> = ({ team }) => (
  <span class="badge" style={`--tc:${teamColor(team.id)}`}>
    {team.code}
  </span>
);

export const FlashMessage: FC<{ flash?: Flash }> = ({ flash }) =>
  flash ? (
    <div class={`flash ${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>
      {flash.message}
    </div>
  ) : null;

export interface NavInfo {
  tournaments: Tournament[];
  current?: Tournament;
  teamCount: number;
  played: number;
  total: number;
  /** Public site URL of the current tournament ("/" when it is the active one). */
  publicUrl?: string;
}

export type Section = 'torneos' | 'config' | 'reglas' | 'equipos' | 'fixture' | 'resultados' | 'playoffs' | 'usuarios';

interface LayoutProps {
  title: string;
  active: Section;
  admin: Admin;
  nav: NavInfo;
  flash?: Flash;
}

const SECTIONS: { key: Exclude<Section, 'torneos' | 'usuarios'>; path: string; label: string }[] = [
  { key: 'config', path: 'config', label: 'Configuración' },
  { key: 'reglas', path: 'reglas', label: 'Reglas' },
  { key: 'equipos', path: 'equipos', label: 'Equipos' },
  { key: 'fixture', path: 'fixture', label: 'Fixture' },
  { key: 'resultados', path: 'resultados', label: 'Resultados' },
  { key: 'playoffs', path: 'playoffs', label: 'Playoffs' },
];

const Document: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <>
    {raw('<!doctype html>')}
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Torneos Admin</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href={assetUrl('admin.css')} />
      </head>
      <body>
        {children}
        <script src={assetUrl('admin.js')} defer></script>
      </body>
    </html>
  </>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ title, active, admin, nav, flash, children }) => {
  const { current } = nav;
  const section = SECTIONS.find((s) => s.key === active)?.path ?? 'config';
  const badge = (value: string | number) => <span>{value}</span>;
  return (
    <Document title={title}>
      <div class="shell">
        <aside>
          <div class="brand">
            Torneos <em>Admin</em>
          </div>
          <div class="tsel">
            <small>
              Torneo
              {current?.isActive ? <span class="pill next">Activo</span> : null}
            </small>
            <Select data-nav-select aria-label="Torneo">
              {nav.tournaments.map((t) => (
                <option value={`/admin/t/${t.id}/${section}`} selected={t.id === current?.id}>
                  {t.isActive ? '● ' : ''}
                  {t.name}
                </option>
              ))}
              <option value="/admin/torneos">+ Nuevo torneo…</option>
            </Select>
          </div>
          <nav class="side" aria-label="Secciones">
            <span class="navlbl">Gestión</span>
            <a href="/admin/torneos" class={active === 'torneos' ? 'on' : ''}>
              Torneos
            </a>
            {current
              ? SECTIONS.map((s) => (
                  <a href={`/admin/t/${current.id}/${s.path}`} class={active === s.key ? 'on' : ''}>
                    {s.label}
                    {s.key === 'equipos' ? badge(nav.teamCount) : null}
                    {s.key === 'resultados' ? badge(`${nav.played}/${nav.total}`) : null}
                  </a>
                ))
              : null}
            <a href="/admin/usuarios" class={active === 'usuarios' ? 'on' : ''}>
              Usuarios
            </a>
          </nav>
          {nav.publicUrl ? (
            <a class="btn sm" href={nav.publicUrl} target="_blank" rel="noopener">
              ↗ Ver página pública
            </a>
          ) : null}
          <div class="side-foot">
            <form method="post" action="/admin/logout" class="stack">
              <small class="muted">Sesión: {admin.username}</small>
              <button class="btn logout" type="submit" data-logout-open aria-label="Cerrar sesión">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                <span class="logout-text">Cerrar sesión</span>
              </button>
              <dialog id="logoutDialog" class="confirm-modal" aria-labelledby="logoutTitle">
                <h2 id="logoutTitle">¿Cerrar sesión?</h2>
                <p>Tendrás que volver a ingresar con tu usuario y contraseña.</p>
                <div class="actions">
                  <button class="btn" type="button" autofocus data-logout-cancel>
                    Cancelar
                  </button>
                  <button class="btn pri" type="submit">
                    Cerrar sesión
                  </button>
                </div>
              </dialog>
            </form>
          </div>
        </aside>
        <main>
          <FlashMessage flash={flash} />
          {children}
        </main>
      </div>
    </Document>
  );
};

export const AuthLayout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <Document title={title}>{children}</Document>
);
