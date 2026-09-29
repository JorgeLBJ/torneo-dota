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

export const SetupPage: FC<{ flash?: Flash }> = ({ flash }) => (
  <AuthLayout title="Configuración inicial">
    <div class="login">
      <form class="card" method="post" action="/admin/setup">
        <div class="brand">
          Torneos <em>Admin</em>
        </div>
        <p class="muted" style="margin:0;font-size:13px">
          Crea el primer administrador. El código de setup aparece en los registros del servidor.
        </p>
        <FlashMessage flash={flash} />
        <label class="f">
          Usuario
          <input name="username" autocomplete="username" required minlength={3} maxlength={32} autofocus />
        </label>
        <label class="f">
          Contraseña (mínimo 8 caracteres)
          <input name="password" type="password" autocomplete="new-password" required minlength={8} maxlength={200} />
        </label>
        <label class="f">
          Confirmar contraseña
          <input name="confirm" type="password" autocomplete="new-password" required minlength={8} maxlength={200} />
        </label>
        <label class="f">
          Código de setup
          <input name="code" autocomplete="off" spellcheck={false} required />
        </label>
        <button class="btn pri" type="submit">
          Crear administrador
        </button>
      </form>
    </div>
  </AuthLayout>
);

export const AccountView: FC = () => (
  <>
    <div class="head">
      <div>
        <h1>Cambiar contraseña</h1>
        <p class="sub">Al cambiarla se cierran tus otras sesiones abiertas. Esta sigue activa.</p>
      </div>
    </div>
    <form class="card stack narrow" method="post" action="/admin/cuenta">
      <label class="f">
        Contraseña actual
        <input name="current" type="password" autocomplete="current-password" required />
      </label>
      <label class="f">
        Nueva contraseña (mínimo 8 caracteres)
        <input name="next" type="password" autocomplete="new-password" required minlength={8} maxlength={200} />
      </label>
      <label class="f">
        Confirmar contraseña
        <input name="confirm" type="password" autocomplete="new-password" required minlength={8} maxlength={200} />
      </label>
      <button class="btn pri" type="submit">
        Cambiar contraseña
      </button>
    </form>
  </>
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
