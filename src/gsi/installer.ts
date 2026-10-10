export const INSTALLER_FILENAME = 'instalar-observador-torneo.bat';

/** `instalar-observador-torneo-<slug>.bat`; plain name when the observer name has no usable characters. */
export function installerFilename(observerName: string): string {
  const slug = observerName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `instalar-observador-torneo-${slug}.bat` : INSTALLER_FILENAME;
}

// Batch prologue: hands the rest of this very file (after the marker) to PowerShell. The marker is split in the
// command line so the command itself never matches it. cmd stops at `exit /b`, so it never parses the PowerShell part.
const PROLOGUE = String.raw`@echo off
setlocal
title Instalador de observador - Torneo Dota
set "TORNEO_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:TORNEO_BAT); $i=$t.LastIndexOf('#'+'PS-START'); Invoke-Expression $t.Substring($i)"
set "RC=%ERRORLEVEL%"
echo.
if not "%TORNEO_NO_PROMPT%"=="1" pause
exit /b %RC%
`;

// PowerShell part. Contains a single placeholder line, __CFG__, replaced with the cfg inside a here-string.
const POWERSHELL = String.raw`#PS-START
# Instalador de observador - Torneo Dota.
# Hace tres cosas, sin permisos de administrador y sin descargar nada:
#   1. Copia gamestate_integration_torneo.cfg a la carpeta de Dota 2.
#   2. Crea el acceso directo "Dota 2 (Torneo)" en el escritorio (Steam con -gamestateintegration).
#   3. Si lo pides, abre Dota 2.
# No modifica la configuración de Steam.
#
# Solo para pruebas locales (variables de entorno opcionales):
#   TORNEO_STEAM_ROOT   carpeta de Steam a usar en lugar de leer el registro
#   TORNEO_SHORTCUT_DIR carpeta donde crear el acceso directo en lugar del escritorio
#   TORNEO_NO_PROMPT=1  no hace la pregunta final ni la pausa
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Fail($message) {
  Write-Host ''
  Write-Host ('[X] ' + $message) -ForegroundColor Red
  Write-Host '    Puedes instalarlo a mano: usa la sección "Instalación manual" de la página del organizador.'
  exit 1
}

Write-Host 'Instalador de observador - Torneo Dota'
Write-Host ''

# 1. Steam
$steam = $env:TORNEO_STEAM_ROOT
if (-not $steam) {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
}
if (-not $steam) {
  $steam = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath
}
if (-not $steam -or -not (Test-Path -LiteralPath $steam)) {
  Fail 'No encontré Steam en este equipo. Instala Steam y Dota 2, o usa la instalacion manual.'
}
$steam = (Resolve-Path -LiteralPath $steam).Path
Write-Host ('[OK] Steam encontrado: ' + $steam)

# 2. Biblioteca que contiene Dota 2 (app 570)
$libraries = @($steam)
$vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
if (Test-Path -LiteralPath $vdf) {
  foreach ($m in [regex]::Matches([IO.File]::ReadAllText($vdf), '"path"\s+"([^"]+)"')) {
    $libraries += $m.Groups[1].Value.Replace('\\', '\')
  }
}
$dota = $null
foreach ($lib in $libraries) {
  $candidate = Join-Path $lib 'steamapps\common\dota 2 beta'
  if (Test-Path -LiteralPath $candidate) { $dota = $candidate; break }
}
if (-not $dota) {
  Fail 'Steam está instalado, pero no encontré Dota 2 en ninguna de tus bibliotecas. Instálalo desde Steam y vuelve a ejecutar este archivo.'
}
Write-Host ('[OK] Dota 2 encontrado: ' + $dota)

# 3. Archivo de configuración
$cfgDir = Join-Path $dota 'game\dota\cfg\gamestate_integration'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfgPath = Join-Path $cfgDir 'gamestate_integration_torneo.cfg'
$replaced = Test-Path -LiteralPath $cfgPath
$cfgText = @'
__CFG__
'@
[IO.File]::WriteAllText($cfgPath, $cfgText + [Environment]::NewLine,(New-Object System.Text.UTF8Encoding($false)))
if ($replaced) {
  Write-Host '[OK] Configuración actualizada (se reemplazó la anterior).'
} else {
  Write-Host '[OK] Configuración instalada.'
}

# 4. Acceso directo en el escritorio
$steamExe = Join-Path $steam 'steam.exe'
$shortcutDir = $env:TORNEO_SHORTCUT_DIR
if (-not $shortcutDir) { $shortcutDir = [Environment]::GetFolderPath('Desktop') }
New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null
$shortcutPath = Join-Path $shortcutDir 'Dota 2 (Torneo).lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = $steamExe
$link.Arguments = '-applaunch 570 -gamestateintegration'
$link.WorkingDirectory = $steam
$dotaExe = Join-Path $dota 'game\bin\win64\dota2.exe'
if (Test-Path -LiteralPath $dotaExe) { $link.IconLocation = $dotaExe + ',0' }
$link.Description = 'Dota 2 con integración de estado de juego para el torneo'
$link.Save()
Write-Host ('[OK] Acceso directo creado: ' + $shortcutPath)

Write-Host ''
Write-Host 'Listo. Abre Dota 2 siempre desde el acceso directo "Dota 2 (Torneo)" durante el torneo.'

# 5. Abrir Dota ahora
if ($env:TORNEO_NO_PROMPT -ne '1') {
  $answer = Read-Host '¿Quieres abrir Dota 2 ahora? (S/N)'
  if ($answer -match '^\s*[sSyY]') {
    Start-Process -FilePath $steamExe -ArgumentList '-applaunch 570 -gamestateintegration'
    Write-Host '[OK] Abriendo Dota 2...'
  }
}
exit 0
`;

/**
 * One-click Windows installer for an observer: a .bat (CRLF) whose embedded PowerShell finds Steam and Dota 2, drops
 * the given GSI cfg in place and creates a Desktop shortcut that launches Dota with `-gamestateintegration`.
 * The cfg is embedded in a single-quoted here-string, so it is taken literally (it only cannot contain a line that
 * starts with `'@`).
 */
export function buildInstallerBat(cfgText: string): string {
  if (/^'@/m.test(cfgText)) throw new Error('cfg text cannot contain a here-string terminator');
  const cfg = cfgText.replace(/\r?\n$/, '');
  const text = PROLOGUE + POWERSHELL.replace('__CFG__', () => cfg);
  return text.replace(/\r?\n/g, '\r\n');
}
