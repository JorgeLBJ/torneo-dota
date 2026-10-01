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
  return normalizeLists(out.join(''));
}

// ---- Nested lists -----------------------------------------------------------------------------------------------
// Browsers indent a list item by putting a list directly inside the list (<ul><li>A</li><ul>..</ul></ul>), and the
// editor used to wrap such a list in an empty item or split the parent list. A sublist belongs INSIDE the item it
// hangs from, so the (already sanitized, well-formed) output is rewritten as a small tree:
//  - a list directly inside a list moves into the previous item (a new item only if there is none);
//  - an item that holds nothing but lists, right after another item, is merged into that item;
//  - a list whose items hold nothing but lists, right after another list, becomes sublists of that list's last item
//    (with no list before it, it simply becomes those lists): never an empty bullet, never a split parent list.

interface TreeNode {
  /** Lower-case tag name, or '' for a text run. */
  name: string;
  open: string;
  children: TreeNode[];
}

const isList = (node: TreeNode): boolean => node.name === 'ul' || node.name === 'ol';
const isBlank = (node: TreeNode): boolean => node.name === '' && node.open.trim() === '';
const listOnly = (li: TreeNode): boolean => {
  const kids = li.children.filter((c) => !isBlank(c));
  return kids.length > 0 && kids.every(isList);
};

function parseTree(html: string): TreeNode {
  const root: TreeNode = { name: 'root', open: '', children: [] };
  const stack: TreeNode[] = [root];
  for (const token of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*>|[^<]+/gi)) {
    const top = stack[stack.length - 1]!;
    if (token[2] === undefined) {
      top.children.push({ name: '', open: token[0], children: [] });
    } else if (token[1] === '/') {
      if (stack.length > 1) stack.pop();
    } else {
      const node: TreeNode = { name: token[2].toLowerCase(), open: token[0], children: [] };
      top.children.push(node);
      if (!VOID.has(node.name)) stack.push(node);
    }
  }
  return root;
}

function serialize(node: TreeNode): string {
  if (node.name === '') return node.open;
  const inner = node.children.map(serialize).join('');
  return node.name === 'root' ? inner : VOID.has(node.name) ? node.open : `${node.open}${inner}</${node.name}>`;
}

/** Two sublists of the same kind side by side in one item are one sublist. */
function mergeSublists(li: TreeNode): void {
  const merged: TreeNode[] = [];
  for (const child of li.children) {
    const last = merged[merged.length - 1];
    if (isList(child) && last && last.name === child.name) last.children.push(...child.children);
    else if (isBlank(child) && last && isList(last)) continue;
    else merged.push(child);
  }
  li.children = merged;
}

function fixLists(parent: TreeNode): void {
  for (const child of parent.children) fixLists(child);

  if (isList(parent)) {
    const fixed: TreeNode[] = [];
    let previous: TreeNode | null = null; // the last item kept
    for (const child of parent.children) {
      if (isList(child)) {
        if (previous) previous.children.push(child);
        else {
          previous = { name: 'li', open: '<li>', children: [child] };
          fixed.push(previous);
        }
      } else if (child.name === 'li') {
        if (previous && listOnly(child)) previous.children.push(...child.children.filter((c) => !isBlank(c)));
        else {
          fixed.push(child);
          previous = child;
        }
      } else fixed.push(child);
    }
    parent.children = fixed;
    for (const li of fixed) if (li.name === 'li') mergeSublists(li);
  }

  // Lists whose every item holds only lists: sublists of the previous list's last item, or plain lists.
  const result: TreeNode[] = [];
  let previousList: TreeNode | null = null;
  for (const child of parent.children) {
    if (!isList(child)) {
      if (!isBlank(child)) previousList = null;
      result.push(child);
      continue;
    }
    const items = child.children.filter((c) => !isBlank(c));
    const orphan = items.length > 0 && items.every((li) => li.name === 'li' && listOnly(li));
    if (!orphan) {
      result.push(child);
      previousList = child;
      continue;
    }
    const lists = items.flatMap((li) => li.children.filter((c) => !isBlank(c)));
    const host: TreeNode | undefined = previousList?.children.filter((c) => c.name === 'li').pop();
    if (host) {
      host.children.push(...lists);
      mergeSublists(host);
    }
    else {
      result.push(...lists);
      previousList = lists[lists.length - 1] ?? null;
    }
  }
  parent.children = result;
}

/** Rewrites sanitized, well-formed rulebook HTML so that every sublist hangs inside its parent item. */
function normalizeLists(html: string): string {
  if (!/<(ul|ol)>/.test(html)) return html;
  const root = parseTree(html);
  fixLists(root);
  return serialize(root);
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
