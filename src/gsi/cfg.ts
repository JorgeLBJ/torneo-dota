export const GSI_CFG_FILENAME = 'gamestate_integration_torneo.cfg';

/**
 * Valve KeyValues file the observer drops into `dota 2 beta/game/dota/cfg/gamestate_integration/`.
 * `origin` is the public origin of this app (no trailing slash needed).
 */
export function buildGsiCfg(origin: string, token: string): string {
  const uri = `${origin.replace(/\/+$/, '')}/gsi`;
  return `"Torneo Dota"
{
  "uri"       "${uri}"
  "timeout"   "5.0"
  "buffer"    "0.5"
  "throttle"  "1.0"
  "heartbeat" "10.0"
  "auth"
  {
    "token"   "${token}"
  }
  "data"
  {
    "provider"   "1"
    "map"        "1"
    "player"     "1"
    "hero"       "1"
    "abilities"  "1"
    "items"      "1"
    "draft"      "1"
    "buildings"  "1"
    "league"     "1"
  }
}
`;
}
