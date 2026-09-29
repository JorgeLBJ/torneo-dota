import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_STREAM_URL } from '../src/domain/stream.js';
import type { Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let url: string;

beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
  t.repo.setActiveTournament(tournament.id);
  url = `/admin/t/${tournament.id}/stream`;
});
afterEach(() => t.db.close());

const config = async () => (await t.get(`/admin/t/${tournament.id}/config`, cookie)).text();

describe('stream card in Configuración', () => {
  it('shows the card with the URL input and no clear button while nothing is set', async () => {
    const html = await config();
    expect(html).toContain('Transmisión en vivo');
    expect(html).toContain(`action="${url}"`);
    expect(html).toContain('name="stream_url"');
    expect(html).not.toContain('Quitar stream');
    expect(html).not.toContain('<iframe');
  });

  it('saves a valid link, reports the platform and previews the embed', async () => {
    const res = await t.post(url, { action: 'save', stream_url: ' https://kick.com/mychannel ' }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBe('https://kick.com/mychannel');
    expect(await flashText(t, res, cookie)).toContain('Transmisión guardada');
    const html = await config();
    expect(html).toContain('value="https://kick.com/mychannel"');
    expect(html).toMatch(/Plataforma detectada: <b>Kick<\/b>/);
    expect(html).toContain('<iframe');
    expect(html).toContain('src="https://player.kick.com/mychannel"');
    expect(html).toContain('Quitar stream');
  });

  it('gives the Twitch preview the request host and Google Sites as parents', async () => {
    await t.post(url, { action: 'save', stream_url: 'twitch.tv/some_channel' }, cookie);
    const html = await config();
    expect(html).toContain('src="https://player.twitch.tv/?channel=some_channel&amp;parent=localhost&amp;parent=sites.google.com&amp;muted=true"');
  });

  it('uses STREAM_PARENT_HOSTS when configured', async () => {
    const custom = await makeApp({ streamParentHosts: ['torneo.example.com', 'x.googleusercontent.com'] });
    const c = await custom.login();
    const tour = custom.repo.createTournament({ name: 'Cup', slug: 'cup' });
    custom.repo.updateTournament(tour.id, { streamUrl: 'twitch.tv/some_channel' });
    const html = await (await custom.get(`/admin/t/${tour.id}/config`, c)).text();
    expect(html).toContain('parent=torneo.example.com&amp;parent=x.googleusercontent.com&amp;muted=true');
    expect(html).not.toContain('parent=sites.google.com');
    custom.db.close();
  });

  it('rejects an unsupported link in Spanish and keeps the previous one', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/keepme' });
    for (const bad of ['https://vimeo.com/1', 'javascript:alert(1)', 'http://kick.com/x', '']) {
      const res = await t.post(url, { action: 'save', stream_url: bad }, cookie);
      expect(await flashText(t, res, cookie)).toMatch(/Kick.*Twitch.*YouTube/);
    }
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBe('https://kick.com/keepme');
  });

  it('clears the stream', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    const res = await t.post(url, { action: 'clear' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Transmisión quitada');
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBeNull();
  });

  it('confirms removal in the themed dialog before submitting', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    const html = await config();
    expect(html).toContain('<dialog id="streamClearDialog" class="confirm-modal"');
    expect(html).toContain('¿Quitar la transmisión?');
    expect(html).toMatch(/<button class="btn danger" type="submit" name="action" value="clear" data-confirm-open="streamClearDialog">/);
    expect(html).toMatch(/<button class="btn pri" type="submit" name="action" value="clear">\s*Quitar stream\s*<\/button>/);
  });

  it('tells the public page to refresh', async () => {
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await t.post(url, { action: 'save', stream_url: 'https://kick.com/mychannel' }, cookie);
    await t.post(url, { action: 'clear' }, cookie);
    expect(changes).toBe(2);
  });

  it('needs a login and a same-origin request', async () => {
    expect((await t.post(url, { action: 'clear' })).status).toBe(303);
    expect((await t.send('POST', url, { form: { action: 'clear' }, cookie, headers: { origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('lets the admin clear a stored link that no longer parses, with a warning instead of a preview', async () => {
    t.db.prepare("UPDATE tournaments SET stream_url = 'https://vimeo.com/999' WHERE id = ?").run(tournament.id);
    const html = await config();
    expect(html).toContain('El link guardado ya no es válido');
    expect(html).toContain('value="https://vimeo.com/999"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Quitar stream');
    expect(html).toContain('id="streamClearDialog"');
    const res = await t.post(url, { action: 'clear' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Transmisión quitada');
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBeNull();
  });

  it('does not warn when the stored link is fine, or when there is none', async () => {
    expect(await config()).not.toContain('El link guardado ya no es válido');
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    expect(await config()).not.toContain('El link guardado ya no es válido');
  });

  it('caps the link at 300 characters, in the form and on the server', async () => {
    expect(await config()).toContain(`maxlength="${MAX_STREAM_URL}"`);
    expect(MAX_STREAM_URL).toBe(300);
    const long = `https://kick.com/${'a'.repeat(300)}`;
    const res = await t.post(url, { action: 'save', stream_url: long }, cookie);
    expect(await flashText(t, res, cookie)).toContain('demasiado largo');
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBeNull();
    const edge = `https://kick.com/${'a'.repeat(25)}`;
    await t.post(url, { action: 'save', stream_url: edge }, cookie);
    expect(t.repo.getTournamentById(tournament.id)!.streamUrl).toBe(edge);
  });
});
