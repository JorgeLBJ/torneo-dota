import { describe, expect, it } from 'vitest';
import { GSI_CFG_FILENAME, buildGsiCfg } from '../src/gsi/cfg.js';
import { generateObserverToken, hashObserverToken } from '../src/auth/observer-token.js';

describe('buildGsiCfg', () => {
  it('writes the uri and the token into a Valve KeyValues file', () => {
    const cfg = buildGsiCfg('https://torneo.example.com', 'abc123');
    expect(cfg).toContain('"Torneo Dota"');
    expect(cfg).toContain('"uri"       "https://torneo.example.com/gsi"');
    expect(cfg).toContain('"token"   "abc123"');
    expect(cfg).toContain('"league"     "1"');
    expect(cfg).toContain('"draft"      "1"');
  });

  it('does not double the slash when the origin ends with one', () => {
    expect(buildGsiCfg('https://x.test/', 't')).toContain('"https://x.test/gsi"');
  });

  it('uses the expected file name', () => {
    expect(GSI_CFG_FILENAME).toBe('gamestate_integration_torneo.cfg');
  });
});

describe('observer tokens', () => {
  it('generates a random token with its sha-256 hash and a short prefix', () => {
    const a = generateObserverToken();
    const b = generateObserverToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashObserverToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.prefix).toBe(a.token.slice(0, 6));
  });
});
