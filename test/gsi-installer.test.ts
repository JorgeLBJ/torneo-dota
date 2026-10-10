import { describe, expect, it } from 'vitest';
import { buildGsiCfg } from '../src/gsi/cfg.js';
import { INSTALLER_FILENAME, buildInstallerBat, installerFilename } from '../src/gsi/installer.js';

const cfg = buildGsiCfg('https://torneo.example.com', 'ab12cd34');

describe('buildInstallerBat', () => {
  it('uses CRLF line endings everywhere', () => {
    const bat = buildInstallerBat(cfg);
    expect(bat).toContain('\r\n');
    expect(bat.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('embeds the cfg verbatim (modulo CRLF) and runs PowerShell without profile or admin', () => {
    const bat = buildInstallerBat(cfg);
    expect(bat.replace(/\r\n/g, '\n')).toContain(cfg);
    expect(bat).toContain('powershell -NoProfile -ExecutionPolicy Bypass');
    expect(bat).toContain('%~f0');
    expect(bat).toContain('pause');
  });

  it('creates the shortcut with the GSI launch options', () => {
    expect(buildInstallerBat(cfg)).toContain('-applaunch 570 -gamestateintegration');
    expect(buildInstallerBat(cfg)).toContain('Dota 2 (Torneo).lnk');
  });

  it('never touches Steam localconfig.vdf and downloads nothing', () => {
    const bat = buildInstallerBat(cfg).toLowerCase();
    expect(bat).not.toContain('localconfig');
    expect(bat).not.toMatch(/invoke-webrequest|downloadfile|curl|bitsadmin/);
  });

  it('documents the local-testing overrides', () => {
    const bat = buildInstallerBat(cfg);
    for (const name of ['TORNEO_STEAM_ROOT', 'TORNEO_SHORTCUT_DIR', 'TORNEO_NO_PROMPT']) expect(bat).toContain(name);
  });

  it('rejects a cfg that would end the here-string', () => {
    expect(() => buildInstallerBat(`"a"\n'@\n"b"`)).toThrow();
    expect(() => buildInstallerBat(`"a"\r\n'@`)).toThrow();
  });
});

describe('installerFilename', () => {
  it('uses a filename-safe slug of the observer name', () => {
    expect(installerFilename('Juan Pérez')).toBe('instalar-observador-torneo-juan-perez.bat');
    expect(installerFilename('../..\\x:*?')).toBe('instalar-observador-torneo-x.bat');
  });
  it('falls back to the plain name', () => {
    expect(installerFilename('###')).toBe(INSTALLER_FILENAME);
    expect(INSTALLER_FILENAME).toBe('instalar-observador-torneo.bat');
  });
});
