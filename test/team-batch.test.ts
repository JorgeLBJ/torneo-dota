import { describe, expect, it } from 'vitest';
import type { Team } from '../src/db/repository.js';
import { planTeamBatch, type BatchRow } from '../src/domain/team-batch.js';

const team = (id: number, code: string, extra: Partial<Team> = {}): Team => ({
  id,
  tournamentId: 1,
  code,
  name: `Equipo ${code}`,
  captain: null,
  hero: null,
  imageKey: null,
  ...extra,
});
const row = (t: Team, extra: Partial<BatchRow> = {}): BatchRow => ({
  id: t.id,
  code: t.code,
  name: t.name,
  captain: t.captain ?? '',
  hero: t.hero,
  emblem: 'keep',
  ...extra,
});
const errorsOf = (result: ReturnType<typeof planTeamBatch>) => (result.ok ? null : result.errors);

describe('the emblem is exclusive', () => {
  const a = team(1, 'A', { hero: 'axe' });
  const b = team(2, 'B', { imageKey: 'teams/1/2-bb.webp' });

  it('keep leaves the emblem as stored and only updates the fields', () => {
    const result = planTeamBatch([a, b], [row(a, { name: 'Nuevo' }), row(b)], new Set());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.changes[0]).toEqual({ id: 1, fields: { code: 'A', name: 'Nuevo', captain: null, hero: 'axe' }, image: 'keep' });
    expect(result.changes[1]).toEqual({ id: 2, fields: { code: 'B', name: 'Equipo B', captain: null, hero: null }, image: 'keep' });
  });

  it('a hero clears the image', () => {
    const result = planTeamBatch([a, b], [row(b, { emblem: 'hero', hero: 'lina' })], new Set());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.changes[0]).toEqual({ id: 2, fields: { code: 'B', name: 'Equipo B', captain: null, hero: 'lina' }, image: 'clear' });
  });

  it('an image clears the hero, even if the row still carries one', () => {
    const result = planTeamBatch([a, b], [row(a, { emblem: 'image', hero: 'axe', imageField: 'image_1' })], new Set(['image_1']));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.changes[0]).toEqual({ id: 1, fields: { code: 'A', name: 'Equipo A', captain: null, hero: null }, image: 'set', imageField: 'image_1' });
  });

  it('none clears both', () => {
    const result = planTeamBatch([a, b], [row(a, { emblem: 'none' }), row(b, { emblem: 'none' })], new Set());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.changes.map((c) => [c.fields.hero, c.image])).toEqual([
      [null, 'clear'],
      [null, 'clear'],
    ]);
  });

  it('an image row without its file part is an error on that row', () => {
    expect(errorsOf(planTeamBatch([a], [row(a, { emblem: 'image', imageField: 'image_1' })], new Set()))).toEqual({
      1: 'Falta el archivo de la imagen.',
    });
  });

  it('a hero row needs a valid hero', () => {
    expect(errorsOf(planTeamBatch([a], [row(a, { emblem: 'hero', hero: null })], new Set()))).toEqual({ 1: 'Elige un héroe válido de la lista.' });
    expect(errorsOf(planTeamBatch([a], [row(a, { emblem: 'hero', hero: 'nope' })], new Set()))).toEqual({ 1: 'Elige un héroe válido de la lista.' });
  });
});

describe('uniqueness is checked on the FINAL state', () => {
  const f = team(6, 'F', { hero: 'chaos_knight' });
  const c = team(3, 'C');

  it('moves a hero from one team to another in one batch (the old holder gives it up)', () => {
    const toCustom = row(f, { emblem: 'image', imageField: 'image_6' });
    const result = planTeamBatch([c, f], [row(c, { emblem: 'hero', hero: 'chaos_knight' }), toCustom], new Set(['image_6']));
    expect(result).toMatchObject({ ok: true });
  });

  it('swaps two heroes between two teams', () => {
    const a = team(1, 'A', { hero: 'axe' });
    const b = team(2, 'B', { hero: 'lina' });
    const result = planTeamBatch([a, b], [row(a, { emblem: 'hero', hero: 'lina' }), row(b, { emblem: 'hero', hero: 'axe' })], new Set());
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a hero still held by a team that is not leaving it', () => {
    expect(errorsOf(planTeamBatch([c, f], [row(c, { emblem: 'hero', hero: 'chaos_knight' })], new Set()))).toEqual({
      3: 'El héroe Chaos Knight ya lo usa el equipo F.',
    });
  });

  it('two rows claiming the same hero both get an error naming the other', () => {
    const a = team(1, 'A');
    const b = team(2, 'B');
    expect(errorsOf(planTeamBatch([a, b], [row(a, { emblem: 'hero', hero: 'axe' }), row(b, { emblem: 'hero', hero: 'axe' })], new Set()))).toEqual({
      1: 'El héroe Axe ya lo usa el equipo B.',
      2: 'El héroe Axe ya lo usa el equipo A.',
    });
  });

  it('codes are unique in the final state too: swapping codes works, duplicating fails', () => {
    const a = team(1, 'A');
    const b = team(2, 'B');
    expect(planTeamBatch([a, b], [row(a, { code: 'b' }), row(b, { code: 'a' })], new Set())).toMatchObject({ ok: true });
    expect(errorsOf(planTeamBatch([a, b], [row(a, { code: 'B' })], new Set()))).toEqual({ 1: 'Ya existe un equipo con el código "B".' });
    expect(errorsOf(planTeamBatch([a, b], [row(a, { code: 'Z' }), row(b, { code: 'z' })], new Set()))).toEqual({
      1: 'Ya existe un equipo con el código "Z".',
      2: 'Ya existe un equipo con el código "Z".',
    });
  });
});

describe('field validation and the whole-batch rule', () => {
  const a = team(1, 'A');
  const b = team(2, 'B');

  it('uses the same Spanish messages as before, per row', () => {
    const result = planTeamBatch([a, b], [row(a, { code: 'TOOLONG' }), row(b, { name: '' })], new Set());
    expect(errorsOf(result)).toEqual({
      1: 'El código debe tener de 1 a 4 letras o números.',
      2: 'El nombre del equipo es obligatorio (máximo 40 caracteres).',
    });
    expect(errorsOf(planTeamBatch([a], [row(a, { captain: 'x'.repeat(41) })], new Set()))).toEqual({
      1: 'El nombre del capitán admite hasta 40 caracteres.',
    });
  });

  it('one invalid row makes the whole batch invalid (no changes are planned)', () => {
    const result = planTeamBatch([a, b], [row(a, { name: 'Bien' }), row(b, { code: '!' })], new Set());
    expect(result.ok).toBe(false);
    expect('changes' in result).toBe(false);
  });

  it('unknown teams and repeated rows are errors', () => {
    expect(errorsOf(planTeamBatch([a], [{ ...row(a), id: 99 }], new Set()))).toEqual({ 99: 'Equipo no encontrado.' });
    expect(errorsOf(planTeamBatch([a], [row(a), row(a)], new Set()))).toEqual({ 1: 'El equipo aparece dos veces en los cambios.' });
  });

  it('trims and upper-cases, and stores a blank captain as null', () => {
    const result = planTeamBatch([a], [row(a, { code: ' ab ', name: '  Nuevo  ', captain: '   ' })], new Set());
    if (!result.ok) throw new Error('expected ok');
    expect(result.changes[0]!.fields).toEqual({ code: 'AB', name: 'Nuevo', captain: null, hero: null });
  });
});
