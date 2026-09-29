import { Hono } from 'hono';
import { hashPassword } from '../../auth/password.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { checkNewPassword, checkUsername } from '../validate.js';
import { UsersView } from '../views/auth.js';

export function userRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/usuarios', (c) =>
    renderPage(
      c,
      deps,
      { title: 'Usuarios', active: 'usuarios', tournament: repo.getActiveTournament() },
      <UsersView admins={repo.listAdmins()} currentId={c.get('admin').id} />,
    ),
  );

  app.post('/usuarios', async (c) => {
    const body = await readBody(c);
    const checkedName = checkUsername(str(body, 'username'));
    const password = typeof body.password === 'string' ? body.password : '';
    const fail = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect('/admin/usuarios', 303);
    };
    if (!checkedName.ok) return fail(checkedName.error);
    const username = checkedName.value;
    const checkedPassword = checkNewPassword(password);
    if (!checkedPassword.ok) return fail(checkedPassword.error);
    if (repo.getAdminByUsername(username)) return fail(`Ya existe un usuario "${username}".`);
    repo.createAdmin(username, await hashPassword(password));
    setFlash(c, 'ok', `Usuario "${username}" agregado.`);
    return c.redirect('/admin/usuarios', 303);
  });

  app.post('/usuarios/:id/eliminar', (c) => {
    const id = Number(c.req.param('id'));
    const target = Number.isInteger(id) ? repo.getAdminById(id) : undefined;
    const fail = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect('/admin/usuarios', 303);
    };
    if (!target) return fail('El usuario no existe.');
    if (target.id === c.get('admin').id) return fail('No puedes eliminar tu propio usuario.');
    if (repo.countAdmins() <= 1) return fail('No se puede eliminar al último administrador.');
    repo.deleteAdmin(target.id);
    setFlash(c, 'ok', `Usuario "${target.username}" eliminado.`);
    return c.redirect('/admin/usuarios', 303);
  });

  return app;
}
