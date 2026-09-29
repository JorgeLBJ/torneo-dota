import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');

/** Body of the first top-level rule whose selector is exactly `selector` (empty when absent). */
const rule = (selector: string): string => {
  for (const line of css.split('\n')) {
    if (line.startsWith(`${selector}{`)) return line.slice(selector.length + 1, line.lastIndexOf('}'));
  }
  return '';
};

describe('admin stylesheet', () => {
  it('defines one control height for inputs, selects and buttons', () => {
    expect(css).toContain('--control-h:40px');
    expect(css).toContain('--control-h-sm:32px');
    expect(rule('select,input')).toContain('height:var(--control-h)');
    expect(rule('.btn')).toContain('height:var(--control-h)');
    expect(rule('.btn.sm')).toContain('height:var(--control-h-sm)');
    expect(rule('.hero-slot')).toContain('height:var(--control-h)');
  });

  it('lets the main area use the full width', () => {
    expect(rule('main')).not.toBe('');
    expect(rule('main')).not.toMatch(/max-width/);
  });

  it('centers every table cell vertically', () => {
    expect(rule('td')).toContain('vertical-align:middle');
    expect(rule('th')).toContain('vertical-align:middle');
  });

  it('uses a single focus ring: an outline, with the border hidden instead of doubled', () => {
    expect(rule(':focus-visible')).toContain('outline:2px solid var(--gold)');
    expect(css).toMatch(/input:focus-visible[^{]*\{[^}]*border-color:transparent/);
    expect(css).not.toMatch(/:focus[^-][^{]*\{[^}]*box-shadow/);
  });

  it('spaces a chip from the text before it', () => {
    expect(rule('.pill:not(:first-child)')).toMatch(/margin-left:\s*8px/);
  });

  it('styles every select: one custom chevron, room for the text, themed list where supported', () => {
    const select = css.split(String.fromCharCode(10)).find((line) => line.startsWith('select{appearance:none')) ?? '';
    expect(select).toContain('padding-right:36px');
    expect(select).toContain('background-position:right 12px center');
    expect(select).toContain('text-overflow:ellipsis');
    expect(css).toMatch(/@supports \(appearance: base-select\)\{[\s\S]*::picker\(select\)\{[^}]*border-radius:10px/);
    // One chevron only: with base-select the SVG background is dropped and the picker icon is the chevron,
    // on the same centred line as the text.
    expect(css).toMatch(/@supports \(appearance: base-select\)\{[\s\S]*select\{display:inline-flex;align-items:center;[^}]*height:var\(--control-h\)[^}]*background-image:none\}/);
    expect(css).toMatch(/select::picker-icon\{display:block;[^}]*margin-left:auto/);
    expect(css).not.toContain('select::picker-icon{display:none}');
  });
});
