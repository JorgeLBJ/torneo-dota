import { fail, ok, type Checked } from '../checked.js';

// Live stream links. The admin pastes a normal page URL; only the parts we validated (platform + ids)
// are used to build the embed URL. The raw input is never put into an iframe.

export type StreamPlatform = 'kick' | 'twitch' | 'youtube';

export type StreamTarget =
  | { kind: 'kick-channel'; channel: string }
  | { kind: 'twitch-channel'; channel: string }
  | { kind: 'twitch-video'; id: string }
  | { kind: 'youtube-video'; id: string }
  | { kind: 'youtube-channel-live'; channel: string };

export interface Stream {
  platform: StreamPlatform;
  /** Display name: Kick, Twitch, YouTube. */
  label: string;
  target: StreamTarget;
  /** Canonical page URL, rebuilt from the validated parts, for the "Abrir en ..." link. */
  openUrl: string;
}

const LABELS: Record<StreamPlatform, string> = { kick: 'Kick', twitch: 'Twitch', youtube: 'YouTube' };

const SUPPORTED =
  'Usa un enlace de Kick (kick.com/canal), Twitch (twitch.tv/canal o twitch.tv/videos/123456789) ' +
  'o YouTube (youtube.com/watch?v=…, youtu.be/…, youtube.com/live/… o youtube.com/channel/UC…/live).';

const invalid = (what: string) => fail(`${what} ${SUPPORTED}`);

const KICK_CHANNEL = /^[A-Za-z0-9_-]{1,25}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const RESERVED = new Set([
  'directory', 'videos', 'downloads', 'jobs', 'turbo', 'settings', 'store', 'subs', 'friends', 'wallet',
  'drops', 'prime', 'login', 'signup', 'search', 'categories', 'category', 'browse', 'following', 'clips',
]);

/** Turns what was typed into a URL, or null. A bare "twitch.tv/x" gets https://; other schemes are kept and rejected later. */
function toUrl(input: string): URL | null {
  const text = input.trim();
  if (text === '' || text.startsWith('//')) return null;
  const candidate = text.includes('://') ? text : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text) ? `https://${text}` : null;
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

const segments = (url: URL) => url.pathname.split('/').filter(Boolean);

export function parseStream(input: string): Checked<Stream> {
  const url = toUrl(input);
  if (!url) return invalid('El enlace no es válido.');
  if (url.protocol !== 'https:') return invalid('El enlace debe empezar con https://.');
  if (url.username !== '' || url.password !== '' || url.port !== '') return invalid('El enlace no es válido.');

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = segments(url);

  if (host === 'kick.com') {
    const [channel] = parts;
    if (parts.length !== 1 || !channel || !KICK_CHANNEL.test(channel) || RESERVED.has(channel.toLowerCase())) {
      return invalid('El enlace de Kick debe ser el de un canal.');
    }
    return ok({ platform: 'kick', label: LABELS.kick, target: { kind: 'kick-channel', channel }, openUrl: `https://kick.com/${channel}` });
  }

  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' && parts.length === 2) {
      const id = parts[1]!;
      if (!/^\d{1,12}$/.test(id)) return invalid('El enlace de Twitch no es un video válido.');
      return ok({ platform: 'twitch', label: LABELS.twitch, target: { kind: 'twitch-video', id }, openUrl: `https://www.twitch.tv/videos/${id}` });
    }
    const [name] = parts;
    if (parts.length !== 1 || !name || !TWITCH_CHANNEL.test(name) || RESERVED.has(name.toLowerCase())) {
      return invalid('El enlace de Twitch debe ser el de un canal o un video.');
    }
    const channel = name.toLowerCase();
    return ok({ platform: 'twitch', label: LABELS.twitch, target: { kind: 'twitch-channel', channel }, openUrl: `https://www.twitch.tv/${channel}` });
  }

  if (host === 'youtu.be' || host === 'youtube.com') {
    const video = (id: string | null | undefined): Checked<Stream> => {
      if (!id || !YOUTUBE_ID.test(id)) return invalid('El enlace de YouTube no tiene un identificador de video válido.');
      return ok({ platform: 'youtube', label: LABELS.youtube, target: { kind: 'youtube-video', id }, openUrl: `https://www.youtube.com/watch?v=${id}` });
    };
    if (host === 'youtu.be') return parts.length === 1 ? video(parts[0]) : invalid('El enlace de YouTube no es válido.');
    if (parts[0] === 'watch' && parts.length === 1) return video(url.searchParams.get('v'));
    if ((parts[0] === 'live' || parts[0] === 'embed') && parts.length === 2) return video(parts[1]);
    if (parts[0] === 'channel' && parts[2] === 'live' && parts.length === 3) {
      const channel = parts[1]!;
      if (!YOUTUBE_CHANNEL.test(channel)) return invalid('El identificador de canal de YouTube no es válido.');
      return ok({ platform: 'youtube', label: LABELS.youtube, target: { kind: 'youtube-channel-live', channel }, openUrl: `https://www.youtube.com/channel/${channel}/live` });
    }
    if (parts[0]?.startsWith('@')) {
      return invalid('Los enlaces con @nombre no se pueden incrustar (YouTube no permite resolverlos): usa el enlace del canal /channel/UC…/live o el de un video.');
    }
    return invalid('El enlace de YouTube no es de un video ni de un canal en vivo.');
  }

  return invalid('Esa plataforma no es compatible.');
}

/** Whether a string is a plain host name (no port, path, spaces or query). */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

/** The iframe `src`, built only from validated parts. Twitch needs every ancestor host as a `parent`. */
export function embedUrl(stream: Stream, parentHosts: readonly string[]): string {
  const t = stream.target;
  const parents = parentHosts.filter((h) => HOST.test(h)).map((h) => `&parent=${encodeURIComponent(h)}`).join('');
  switch (t.kind) {
    case 'kick-channel':
      return `https://player.kick.com/${t.channel}`;
    case 'twitch-channel':
      return `https://player.twitch.tv/?channel=${t.channel}${parents}&muted=true`;
    case 'twitch-video':
      return `https://player.twitch.tv/?video=v${t.id}${parents}&muted=true`;
    case 'youtube-video':
      return `https://www.youtube-nocookie.com/embed/${t.id}`;
    case 'youtube-channel-live':
      return `https://www.youtube-nocookie.com/embed/live_stream?channel=${t.channel}`;
  }
}

/**
 * Ancestor hosts for Twitch: the configured list (STREAM_PARENT_HOSTS), or by default the host serving
 * the page plus sites.google.com (Google Sites embeds this site). Invalid entries are dropped.
 */
export function parentHostsFor(requestHost: string, configured?: readonly string[]): string[] {
  const clean = (hosts: readonly string[]) => [...new Set(hosts.map((h) => h.trim().toLowerCase()).filter((h) => HOST.test(h)))];
  const explicit = clean(configured ?? []);
  if (explicit.length > 0) return explicit;
  const host = requestHost.replace(/:\d+$/, '');
  return clean([host, 'sites.google.com']);
}
