import type { FC } from 'hono/jsx';
import type { Admin } from '../../db/repository.js';
import { formatDateTime } from '../../format/datetime.js';
import type { Flash } from '../flash.js';
import { AuthLayout, FlashMessage } from './layout.js';

export const LoginPage: FC<{ flash?: Flash }> = ({ flash }) => (
  <AuthLayout title="Entrar">
    <div class="login">
      <form class="card" method="post" action="/admin/login">
        <div class="brand">
          Torneos <em>Admin</em>
        </div>
        <FlashMessage flash={flash} />
        <label class="f">
          Usuario
          <input name="username" autocomplete="username" required autofocus />
        </label>
        <label class="f">
          Contraseña
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="btn pri" type="submit">
          Entrar
        </button>
      </form>
    </div>
  </AuthLayout>
);

export const TooManyAttemptsPage: FC = () => (
  <AuthLayout title="Demasiados intentos">
    <div class="login">
      <div class="card">
        <div class="brand">
          Torneos <em>Admin</em>
        </div>
        <div class="flash error" role="alert">
          Demasiados intentos fallidos. Espera un minuto e inténtalo de nuevo.
        </div>
        <a class="btn" href="/admin/login">
          Volver
        </a>
      </div>
    </div>
  </AuthLayout>
);

export const UsersView: FC<{ admins: Admin[]; currentId: number }> = ({ admins, currentId }) => (
  <>
    <div class="head">
      <div>
        <h1>Usuarios</h1>
        <p class="sub">Todos los administradores tienen el mismo rol y acceso completo.</p>
      </div>
    </div>
    <div class="card scroll-x">
      <table class="cards">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Creado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr>
              <td data-label="Usuario">
                <b>{a.username}</b>
                {a.id === currentId ? <span class="pill next">Tú</span> : null}
              </td>
              <td class="muted" data-label="Creado">{formatDateTime(a.createdAt)}</td>
              <td>
                {a.id === currentId ? null : (
                  <form method="post" action={`/admin/usuarios/${a.id}/eliminar`}>
                    <button class="btn sm danger" type="submit">
                      Eliminar
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <form class="card row-form" method="post" action="/admin/usuarios">
      <h2>Agregar usuario</h2>
      <label class="f">
        Usuario
        <input name="username" autocomplete="off" required minlength={3} maxlength={32} />
      </label>
      <label class="f">
        Contraseña (mínimo 8 caracteres)
        <input name="password" type="password" autocomplete="new-password" required minlength={8} />
      </label>
      <button class="btn pri" type="submit">
        Agregar
      </button>
    </form>
  </>
);
