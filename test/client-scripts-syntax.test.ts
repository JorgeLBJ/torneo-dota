import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The client scripts are served as-is (no build), so a syntax error only shows up in the browser.
// Compiling them here (without running) keeps a broken file from shipping.
const scripts = readdirSync('public').filter((name) => name.endsWith('.js'));

describe('client scripts', () => {
  it.each(scripts)('%s parses', (name) => {
    const source = readFileSync(`public/${name}`, 'utf8');
    expect(() => new Script(source, { filename: name })).not.toThrow();
  });
});
