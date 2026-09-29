export type RulebookBlock =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string };

/**
 * Parses the simple rulebook syntax: `## Heading`, `- list item`, and plain paragraphs.
 * Returns plain-text blocks only; escaping is the renderer's job (JSX escapes by default).
 */
export function renderRulebook(source: string): RulebookBlock[] {
  const blocks: RulebookBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) blocks.push({ type: 'list', items: list });
    list = [];
  };

  for (const rawLine of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    const item = /^-\s+(.+)$/.exec(line);
    if (line === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1]!.trim() });
    } else if (item) {
      flushParagraph();
      list.push(item[1]!.trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
