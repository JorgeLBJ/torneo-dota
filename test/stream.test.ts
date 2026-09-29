import { describe, expect, it } from 'vitest';
import { embedUrl, parentHostsFor, parseStream } from '../src/domain/stream.js';

const stream = (input: string) => {
  const r = parseStream(input);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const error = (input: string) => {
  const r = parseStream(input);
  if (r.ok) throw new Error(`accepted: ${input}`);
  return r.error;
};

describe('parseStream: Kick', () => {
  it('accepts a channel URL', () => {
    expect(stream('https://kick.com/mychannel')).toMatchObject({ platform: 'kick', label: 'Kick', openUrl: 'https://kick.com/mychannel' });
    expect(stream('https://www.kick.com/My_Channel/')).toMatchObject({ platform: 'kick', openUrl: 'https://kick.com/My_Channel' });
  });
  it('embeds through player.kick.com', () => {
    expect(embedUrl(stream('https://kick.com/mychannel'), [])).toBe('https://player.kick.com/mychannel');
  });
  it('rejects a Kick URL that is not a channel', () => {
    expect(error('https://kick.com/')).toContain('Kick');
    expect(error('https://kick.com/a/b/c')).toContain('Kick');
  });
});

describe('parseStream: Twitch', () => {
  it('accepts channel URLs with or without scheme and www', () => {
    for (const input of ['https://www.twitch.tv/some_channel', 'https://twitch.tv/some_channel', 'twitch.tv/some_channel', 'www.twitch.tv/Some_Channel/']) {
      expect(stream(input)).toMatchObject({ platform: 'twitch', label: 'Twitch', openUrl: 'https://www.twitch.tv/some_channel' });
    }
  });
  it('embeds with every parent host and muted', () => {
    expect(embedUrl(stream('twitch.tv/some_channel'), ['example.com', 'sites.google.com'])).toBe(
      'https://player.twitch.tv/?channel=some_channel&parent=example.com&parent=sites.google.com&muted=true',
    );
  });
  it('supports videos, which the player addresses as v<id>', () => {
    const video = stream('https://www.twitch.tv/videos/123456789');
    expect(video.openUrl).toBe('https://www.twitch.tv/videos/123456789');
    expect(embedUrl(video, ['example.com'])).toBe('https://player.twitch.tv/?video=v123456789&parent=example.com&muted=true');
  });
  it('rejects other Twitch pages', () => {
    expect(error('https://www.twitch.tv/directory')).toContain('Twitch');
    expect(error('https://www.twitch.tv/videos/abc')).toContain('Twitch');
    expect(error('https://www.twitch.tv/')).toContain('Twitch');
  });
});

describe('parseStream: YouTube', () => {
  const ID = 'dQw4w9WgXcQ';
  it('accepts the video URL shapes', () => {
    for (const input of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
    ]) {
      expect(stream(input)).toMatchObject({ platform: 'youtube', label: 'YouTube', openUrl: `https://www.youtube.com/watch?v=${ID}` });
    }
  });
  it('embeds through youtube-nocookie', () => {
    expect(embedUrl(stream(`https://youtu.be/${ID}`), [])).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
  });
  it('supports a channel live URL by channel id', () => {
    const channel = 'UC' + 'a'.repeat(22);
    const s = stream(`https://www.youtube.com/channel/${channel}/live`);
    expect(s.openUrl).toBe(`https://www.youtube.com/channel/${channel}/live`);
    expect(embedUrl(s, [])).toBe(`https://www.youtube-nocookie.com/embed/live_stream?channel=${channel}`);
  });
  it('explains that @handle links cannot be embedded', () => {
    expect(error('https://www.youtube.com/@somebody/live')).toMatch(/@|canal/);
    expect(error('https://www.youtube.com/@somebody/live')).toContain('/channel/');
  });
  it('rejects bad ids', () => {
    expect(error('https://www.youtube.com/watch?v=short')).toContain('YouTube');
    expect(error('https://www.youtube.com/watch?v=' + 'x'.repeat(40))).toContain('YouTube');
    expect(error('https://www.youtube.com/')).toContain('YouTube');
  });
});

describe('parseStream: safety', () => {
  it('rejects other hosts, schemes, credentials and look-alike domains, listing what works', () => {
    for (const input of [
      '',
      '   ',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://kick.com/mychannel',
      'ftp://kick.com/mychannel',
      'https://evil.example/kick.com/mychannel',
      'https://kick.com.evil.example/mychannel',
      'https://notkick.com/mychannel',
      'https://user:pass@kick.com/mychannel',
      'https://kick.com:8443/mychannel',
      'https://vimeo.com/12345',
      '//kick.com/mychannel',
      'not a url',
    ]) {
      const message = error(input);
      expect(message).toMatch(/Kick|Twitch|YouTube/);
    }
  });

  it('never carries the raw input into the embed URL', () => {
    const s = stream('https://kick.com/mychannel?evil="><script>');
    expect(embedUrl(s, [])).toBe('https://player.kick.com/mychannel');
    expect(JSON.stringify(s)).not.toContain('script');
  });

  it('only allows plain host names as Twitch parents', () => {
    expect(embedUrl(stream('twitch.tv/some_channel'), ['ok.example', 'bad host', 'a/b', 'x&parent=evil.com', ''])).toBe(
      'https://player.twitch.tv/?channel=some_channel&parent=ok.example&muted=true',
    );
  });
});

describe('parentHostsFor', () => {
  it('defaults to the request host plus Google Sites', () => {
    expect(parentHostsFor('torneo.example.com:443')).toEqual(['torneo.example.com', 'sites.google.com']);
    expect(parentHostsFor('localhost:3000')).toEqual(['localhost', 'sites.google.com']);
  });
  it('uses the configured list when there is one', () => {
    expect(parentHostsFor('ignored.example', ['a.example', 'b.example'])).toEqual(['a.example', 'b.example']);
  });
  it('drops invalid hosts and duplicates', () => {
    expect(parentHostsFor('a.example', ['a.example', 'a.example', 'bad host', ''])).toEqual(['a.example']);
    expect(parentHostsFor('', undefined)).toEqual(['sites.google.com']);
  });
});
