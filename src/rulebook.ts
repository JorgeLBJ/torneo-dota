import { renderRulebook } from './markdown.js';

// The rulebook is rich text written by an admin in a browser editor and shown to every visitor, so it is a
// stored-XSS surface. It is therefore never trusted: the HTML is rebuilt from a strict allowlist when it is saved
// and again when it is rendered. Nothing is "removed" from the input; the output is assembled only from
// recognised tokens, so whatever the parser does not understand cannot survive.
//
// Allowed: p, br, h2, h3, b, strong, i, em, u, s, ul, ol, li, hr, mark[class=g|r|d], div[class=callout] and
// a[href=http(s)|mailto] (always rel="noopener noreferrer" target="_blank"). No other attribute is ever copied.

/** Longest rulebook HTML accepted (characters); longer input is refused on save and cut when rendering. */
export const MAX_RULEBOOK_HTML = 60000;

const VOID = new Set(['br', 'hr']);
const PLAIN = new Set(['p', 'h2', 'h3', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li']);
// Elements whose content must not leak out as text (scripts, styles, embedded documents).
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'title',
  'xmp', 'plaintext', 'noembed', 'noframes', 'applet', 'head', 'select',
]);
const ALIASES: Record<string, string> = { strike: 's', del: 's' };

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ', sol: '/' };

/** Decodes the character references a URL could be disguised with (named subset, decimal and hex). */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

const escapeText = (text: string): string => text.replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Null unless the (decoded) value is an http, https or mailto address. */
function safeHref(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const value = decodeEntities(raw).replace(/[\u0000-\u001f\u007f \s]+/g, '').trim();
  if (value === '' || value.length > 2000) return null;
  return /^(https?:\/\/[^\s]|mailto:[^\s])/i.test(value) ? value : null;
}

interface RawTag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  /** Index just after the closing `>`. */
  end: number;
}

/** Reads the tag starting at `start` (`<` followed by a letter or `/`). Quoted attribute values may contain `>`. */
function readTag(html: string, start: number): RawTag {
  let i = start + 1;
  const closing = html[i] === '/';
  if (closing) i += 1;
  const nameStart = i;
  while (i < html.length && !/[\s/>]/.test(html[i]!)) i += 1;
  const name = html.slice(nameStart, i).toLowerCase();
  const attrs = new Map<string, string>();
  while (i < html.length && html[i] !== '>') {
    while (i < html.length && /[\s/]/.test(html[i]!)) i += 1;
    if (i >= html.length || html[i] === '>') break;
    const attrStart = i;
    while (i < html.length && !/[\s/>=]/.test(html[i]!)) i += 1;
    const attr = html.slice(attrStart, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i]!)) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < html.length && /\s/.test(html[i]!)) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? html.length : close;
        value = html.slice(i + 1, stop);
        i = close === -1 ? html.length : close + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !/[\s>]/.test(html[i]!)) i += 1;
        value = html.slice(valueStart, i);
      }
    }
    if (attr !== '' && !attrs.has(attr)) attrs.set(attr, value);
    if (i === attrStart) i += 1; // never stall on garbage
  }
  return { name, closing, attrs, end: Math.min(i + 1, html.length) };
}

interface Open {
  tag: string;
  emitted: boolean;
}

/** Rebuilds the HTML keeping only the allowlist. Always returns balanced, attribute-controlled markup. */
export function sanitizeRulebookHtml(input: string): string {
  if (typeof input !== 'string' || input === '') return '';
  const html = input.length > MAX_RULEBOOK_HTML ? input.slice(0, MAX_RULEBOOK_HTML) : input;
  const out: string[] = [];
  const stack: Open[] = [];
  let i = 0;
  let text = '';
  const flush = () => {
    if (text !== '') out.push(escapeText(text));
    text = '';
  };

  while (i < html.length) {
    const ch = html[i]!;
    if (ch !== '<') {
      text += ch;
      i += 1;
      continue;
    }
    const next = html[i + 1];
    if (next === '!' || next === '?') {
      // Comment, doctype, CDATA or processing instruction: dropped up to the end it declares.
      flush();
      const end = html.startsWith('<!--', i) ? html.indexOf('-->', i + 4) : html.indexOf('>', i + 2);
      i = end === -1 ? html.length : end + (html.startsWith('<!--', i) ? 3 : 1);
      continue;
    }
    if (next === undefined || !/[a-zA-Z/]/.test(next) || (next === '/' && !/[a-zA-Z]/.test(html[i + 2] ?? ''))) {
      text += '<'; // a lone "<" is text (escaped on output)
      i += 1;
      continue;
    }
    flush();
    const tag = readTag(html, i);
    i = tag.end;
    const name = ALIASES[tag.name] ?? tag.name;

    if (tag.closing) {
      const at = stack.map((entry) => entry.tag).lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) {
        const entry = stack.pop()!;
        if (entry.emitted) out.push(`</${entry.tag}>`);
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag.name)) {
      const close = html.toLowerCase().indexOf(`</${tag.name}`, i);
      if (close === -1) {
        i = html.length;
      } else {
        const end = html.indexOf('>', close);
        i = end === -1 ? html.length : end + 1;
      }
      continue;
    }

    if (VOID.has(name)) {
      out.push(`<${name}>`);
    } else if (PLAIN.has(name)) {
      out.push(`<${name}>`);
      stack.push({ tag: name, emitted: true });
    } else if (name === 'mark') {
      const cls = tag.attrs.get('class')?.trim();
      if (cls === 'g' || cls === 'r' || cls === 'd') {
        out.push(`<mark class="${cls}">`);
        stack.push({ tag: 'mark', emitted: true });
      } else stack.push({ tag: 'mark', emitted: false });
    } else if (name === 'div') {
      if (tag.attrs.get('class')?.trim() === 'callout') {
        out.push('<div class="callout">');
        stack.push({ tag: 'div', emitted: true });
      } else stack.push({ tag: 'div', emitted: false });
    } else if (name === 'a') {
      const href = safeHref(tag.attrs.get('href') ?? '');
      if (href) {
        out.push(`<a href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank">`);
        stack.push({ tag: 'a', emitted: true });
      } else stack.push({ tag: 'a', emitted: false });
    }
    // Any other element is unwrapped: its tags vanish, its text stays.
  }
  flush();
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.emitted) out.push(`</${entry.tag}>`);
  }
  return out.join('');
}

const escapeLegacy = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The old `## Heading` / `- item` rulebook text as HTML, so nothing written before the editor is lost. */
export function legacyRulebookToHtml(source: string): string {
  return renderRulebook(source)
    .map((block) => {
      if (block.type === 'heading') return `<h2>${escapeLegacy(block.text)}</h2>`;
      if (block.type === 'list') return `<ul>${block.items.map((item) => `<li>${escapeLegacy(item)}</li>`).join('')}</ul>`;
      return `<p>${escapeLegacy(block.text)}</p>`;
    })
    .join('');
}

/** The HTML to show for a tournament: its saved rich rulebook (sanitized again), or the converted old text. */
export function rulebookHtmlOf(tournament: { rulesHtml: string | null; rulesText: string }): string {
  return sanitizeRulebookHtml(tournament.rulesHtml ?? legacyRulebookToHtml(tournament.rulesText));
}
