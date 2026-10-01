import { describe, expect, it } from 'vitest';
import { legacyRulebookToHtml, MAX_RULEBOOK_HTML, rulebookHtmlOf, sanitizeRulebookHtml as clean } from '../src/rulebook.js';

describe('sanitizeRulebookHtml: what is kept', () => {
  it('keeps the allowed formatting as it is', () => {
    const html =
      '<h2>Título</h2><h3>Sub</h3><p>Hola <strong>fuerte</strong> <b>b</b> <em>e</em> <i>i</i> <u>u</u> <s>s</s><br></p>' +
      '<ul><li>uno<ul><li>anidado</li></ul></li></ul><ol><li>dos</li></ol><hr>';
    expect(clean(html)).toBe(html);
  });

  it('keeps the highlight classes g, r and d and the callout block', () => {
    expect(clean('<mark class="g">a</mark><mark class="r">b</mark><mark class="d">c</mark>')).toBe(
      '<mark class="g">a</mark><mark class="r">b</mark><mark class="d">c</mark>',
    );
    expect(clean('<div class="callout">Nota</div>')).toBe('<div class="callout">Nota</div>');
  });

  it('keeps http, https and mailto links and forces rel and target', () => {
    expect(clean('<a href="https://example.com/a?b=1&c=2">x</a>')).toBe(
      '<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(clean('<a href="http://example.com">x</a>')).toContain('href="http://example.com"');
    expect(clean('<a href="mailto:a@b.co">x</a>')).toContain('href="mailto:a@b.co"');
  });

  it('is case-insensitive about tags and leaves plain text, accents and ampersands alone', () => {
    expect(clean('<P>Árbol &amp; flor <STRONG>ñ</STRONG></P>')).toBe('<p>Árbol &amp; flor <strong>ñ</strong></p>');
  });

  it('is idempotent', () => {
    const dirty = '<p onclick="x">a<script>b</script><a href="javascript:1">c</a><mark class="zzz">d</mark></p>';
    expect(clean(clean(dirty))).toBe(clean(dirty));
  });
});

describe('sanitizeRulebookHtml: XSS', () => {
  const never = (html: string) => {
    const out = clean(html).toLowerCase();
    for (const bad of ['<script', '<img', '<svg', '<iframe', '<style', '<object', '<embed', '<math', 'onerror', 'onload', 'onclick', 'javascript:', 'style=', 'srcdoc']) {
      expect(out, `${bad} survived in ${out}`).not.toContain(bad);
    }
    return out;
  };

  it('removes script elements with their content', () => {
    expect(never('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(never('<SCRIPT SRC=//evil.example/x.js></SCRIPT>')).toBe('');
    expect(never('<script>alert(1)')).toBe('');
  });

  it('removes images with event handlers', () => {
    expect(never('<img src=x onerror=alert(1)>')).toBe('');
    expect(never('<img src="x" onerror="alert(1)">text')).toBe('text');
    expect(never('<p><img/src/onerror=alert(1)>a</p>')).toBe('<p>a</p>');
  });

  it('refuses javascript:, data: and vbscript: links, including disguised ones', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'jav&#x61;script:alert(1)',
      'jav&#97;script:alert(1)',
      '&#106;avascript:alert(1)',
      'javascript&colon;alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      '//evil.example',
      '/relative',
      'ftp://example.com',
    ]) {
      const out = clean(`<a href="${href}">x</a>`);
      expect(out, href).toBe('x');
    }
  });

  it('drops the link attributes it does not allow (onclick, target, style, id)', () => {
    const out = clean('<a href="https://example.com" onclick="x()" style="color:red" id="a" target="_self" rel="opener">x</a>');
    expect(out).toBe('<a href="https://example.com" rel="noopener noreferrer" target="_blank">x</a>');
  });

  it('removes svg, math, iframe, object, embed, style and template with their content', () => {
    expect(never('<svg onload=alert(1)><script>alert(2)</script></svg>')).toBe('');
    expect(never('<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>ok')).toBe('ok');
    expect(never('<math><mi xlink:href="javascript:alert(1)">x</mi></math>y')).toBe('y');
    expect(never('<iframe src="javascript:alert(1)"></iframe><iframe srcdoc="<script>alert(1)</script>">z</iframe>')).toBe('');
    expect(never('<object data="x"></object><embed src="x">')).toBe('');
    expect(never('<style>body{display:none}</style><p>a</p>')).toBe('<p>a</p>');
    expect(never('<template><script>alert(1)</script></template>t')).toBe('t');
  });

  it('removes style and event attributes from allowed tags', () => {
    expect(never('<p style="x:expression(alert(1))" onmouseover="alert(1)" class="evil">a</p>')).toBe('<p>a</p>');
    expect(never('<h2 onclick=alert(1)>a</h2>')).toBe('<h2>a</h2>');
    expect(never('<mark class="g" onclick="x" style="y">a</mark>')).toBe('<mark class="g">a</mark>');
  });

  it('refuses other class values on mark and div', () => {
    expect(clean('<mark class="x">a</mark>')).toBe('a');
    expect(clean('<mark class="g x">a</mark>')).toBe('a');
    expect(clean('<div class="callout evil">a</div>')).toBe('a');
    expect(clean('<div>a</div>')).toBe('a');
  });

  it('handles malformed and nested tags without leaking', () => {
    expect(never('<<script>script>alert(1)<</script>/script>')).not.toContain('<script');
    expect(never('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toContain('<script');
    expect(never('<p<img src=x onerror=alert(1)>>a')).not.toContain('<img');
    expect(never('<a href="https://ok.example"<script>alert(1)</script>>x</a>')).not.toContain('<script');
    expect(never('<img src="x>" onerror="alert(1)">y')).toBe('y');
    expect(never('<p/onclick=alert(1)>a')).toBe('<p>a</p>');
    expect(never('<b><i>cruzado</b></i>')).toBe('<b><i>cruzado</i></b>');
  });

  it('keeps tags balanced: unclosed ones are closed, stray closers are ignored', () => {
    expect(clean('<ul><li>a<li>b')).toBe('<ul><li>a<li>b</li></li></ul>');
    expect(clean('a</p></div></b>b')).toBe('ab');
    expect(clean('<div class="callout"><b>x')).toBe('<div class="callout"><b>x</b></div>');
  });

  it('escapes entity tricks so they stay text', () => {
    expect(clean('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(clean('&#60;script&#62;alert(1)')).toBe('&#60;script&#62;alert(1)');
    expect(clean('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
    expect(clean('<p>1 < 2</p>')).toBe('<p>1 &lt; 2</p>');
    expect(clean('x <')).toBe('x &lt;');
  });

  it('removes comments, doctype, CDATA and processing instructions', () => {
    expect(never('<!--<script>alert(1)</script>-->a')).toBe('a');
    expect(never('<!-- x --><!DOCTYPE html><![CDATA[<script>alert(1)</script>]]><?php echo 1 ?>b')).not.toContain('<script');
    expect(never('<!--[if IE]><script>alert(1)</script><![endif]-->c')).toBe('c');
  });

  it('removes form controls, base, meta, link and body-level wrappers but keeps their text', () => {
    expect(never('<form action="https://evil.example"><input name=x><button>go</button>texto</form>')).toBe('gotexto');
    expect(clean('<base href="https://evil.example"><meta http-equiv="refresh" content="0;url=x"><link rel="stylesheet" href="x">hola')).toBe('hola');
    expect(clean('<html><body><span style="color:red">a</span><font color=red>b</font></body></html>')).toBe('ab');
  });

  it('normalizes non-string input to an empty rulebook', () => {
    expect(clean(undefined as unknown as string)).toBe('');
    expect(clean(null as unknown as string)).toBe('');
  });
});

describe('legacy rulebook text', () => {
  it('converts "## " headings, "- " lists and paragraphs to HTML, escaping the text', () => {
    expect(legacyRulebookToHtml('## Formato\nTodos contra todos <b>\n\n- uno & dos\n- tres')).toBe(
      '<h2>Formato</h2><p>Todos contra todos &lt;b&gt;</p><ul><li>uno &amp; dos</li><li>tres</li></ul>',
    );
    expect(legacyRulebookToHtml('')).toBe('');
  });

  it('is used while there is no HTML yet, and the HTML wins afterwards', () => {
    expect(rulebookHtmlOf({ rulesHtml: null, rulesText: '## A\n- b' })).toBe('<h2>A</h2><ul><li>b</li></ul>');
    expect(rulebookHtmlOf({ rulesHtml: '<p>Nuevo</p>', rulesText: '## A' })).toBe('<p>Nuevo</p>');
    expect(rulebookHtmlOf({ rulesHtml: '', rulesText: '## A' })).toBe('');
  });

  it('sanitizes the stored HTML again on the way out', () => {
    expect(rulebookHtmlOf({ rulesHtml: '<p>a</p><script>x</script>', rulesText: '' })).toBe('<p>a</p>');
  });
});

describe('cap', () => {
  it('has a maximum length', () => {
    expect(MAX_RULEBOOK_HTML).toBeGreaterThanOrEqual(20000);
    expect(MAX_RULEBOOK_HTML).toBeLessThanOrEqual(200000);
  });
});

describe('output invariant', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '"><script>alert(1)</script>', "'><img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)" onmouseover="alert(1)">x</a>', '<body onload=alert(1)>', '<input autofocus onfocus=alert(1)>',
    '<details open ontoggle=alert(1)>', '<video><source onerror=alert(1)>', '<p style="background:url(javascript:alert(1))">',
    '<a href=" javascript:alert(1)">', '<div class="callout" onclick="x"><mark class="g" id="y">z</mark></div>', '<![CDATA[x]]>',
    '<<<>>><//>< /p>', '<a href="https://x.example" href="javascript:alert(1)">y</a>', '<A HREF=JAVASCRIPT:alert(1)>', '<p\u0000onclick=1>',
  ];
  it('every tag in the output is on the allowlist and carries only allowed attributes', () => {
    const tag = /<\/?([a-z0-9]+)([^>]*)>/g;
    const allowed = /^(p|br|h2|h3|b|strong|i|em|u|s|ul|ol|li|hr|mark|div|a)$/;
    for (const payload of payloads) {
      const out = clean(`ok ${payload} ${payload.toUpperCase()} end`);
      for (const match of out.matchAll(tag)) {
        expect(match[1], `${payload} -> ${out}`).toMatch(allowed);
        const attrs = match[2]!.trim();
        expect(attrs, `${payload} -> ${out}`).toMatch(/^$|^class="(g|r|d|callout)"$|^href="(https?:\/\/|mailto:)[^"<>]*" rel="noopener noreferrer" target="_blank"$/i);
      }
      expect(out).not.toMatch(/<[^a-z/]/);
    }
  });
});

describe('nested lists are normalised, never split or left with an empty bullet', () => {
  it('rewrites the real production HTML into one list with the sublist under its parent item', () => {
    const prod =
      '<h2>CREDITOS</h2><ul><li>Web auspiciada por Kendeclise Corp.</li><li>Agradecimientos especiales:</li></ul><ul><li><ul><li>Por el apoyo de tesoreros: wiba, orochi.</li><li>Por el aporte de jugadores nuevos y amigos : wiba, shanks, kairos.</li></ul></li></ul><ul><li>Mi vida Por la Horda!</li></ul>';
    const out = clean(prod);
    expect(out).toBe(
      '<h2>CREDITOS</h2><ul><li>Web auspiciada por Kendeclise Corp.</li><li>Agradecimientos especiales:<ul><li>Por el apoyo de tesoreros: wiba, orochi.</li><li>Por el aporte de jugadores nuevos y amigos : wiba, shanks, kairos.</li></ul></li></ul><ul><li>Mi vida Por la Horda!</li></ul>',
    );
    expect(out).not.toContain('<li></li>');
    expect(out).not.toMatch(/<li><ul>/);
    expect(clean(out)).toBe(out);
  });

  it('puts a list that sits directly inside a list into the previous item (what Chrome indent produces)', () => {
    expect(clean('<ul><li>A</li><ul><li>x</li><li>y</li><li>z</li></ul></ul>')).toBe('<ul><li>A<ul><li>x</li><li>y</li><li>z</li></ul></li></ul>');
    expect(clean('<ol><li>1</li><ol><li>2</li><ol><li>3</li></ol></ol><li>4</li></ol>')).toBe('<ol><li>1<ol><li>2<ol><li>3</li></ol></li></ol></li><li>4</li></ol>');
  });

  it('merges an item that holds only a list into the item before it, keeping the rest of the list whole', () => {
    expect(clean('<ul><li>A</li><li><ul><li>x</li></ul></li><li>B</li></ul>')).toBe('<ul><li>A<ul><li>x</li></ul></li><li>B</li></ul>');
  });

  it('a list-only list after another list joins that list last item; with nothing before it, it just becomes a list', () => {
    expect(clean('<ul><li>A</li></ul><ul><li><ul><li>x</li></ul></li></ul>')).toBe('<ul><li>A<ul><li>x</li></ul></li></ul>');
    expect(clean('<ul><ul><li>x</li></ul></ul>')).toBe('<ul><li>x</li></ul>');
    expect(clean('<ul><li><ul><li>x</li></ul></li></ul>')).toBe('<ul><li>x</li></ul>');
  });

  it('leaves well-formed nesting and items with text plus a sublist alone', () => {
    const ok = '<ul><li>A<ul><li>x</li></ul>tail</li><li>B</li></ul>';
    expect(clean(ok)).toBe(ok);
  });
});

describe('sublists of one item', () => {
  it('two sublists of the same kind side by side in one item become one', () => {
    expect(clean('<ul><li>A<ul><li>x</li></ul><ul><li>y</li></ul></li></ul>')).toBe('<ul><li>A<ul><li>x</li><li>y</li></ul></li></ul>');
    expect(clean('<ul><li>A<ul><li>x</li></ul><ol><li>y</li></ol></li></ul>')).toBe('<ul><li>A<ul><li>x</li></ul><ol><li>y</li></ol></li></ul>');
  });
  it('separate top-level lists stay separate', () => {
    expect(clean('<ul><li>A</li></ul><ul><li>B</li></ul>')).toBe('<ul><li>A</li></ul><ul><li>B</li></ul>');
  });
});

describe('sublists added next to an existing sublist', () => {
  it('a list placed after an item that already has a sublist joins that sublist', () => {
    expect(clean('<ul><li>A<ul><li>x</li></ul></li><ul><li>B</li></ul></ul>')).toBe('<ul><li>A<ul><li>x</li><li>B</li></ul></li></ul>');
    expect(clean('<ul><li>A<ul><li>x</li></ul></li><li><ul><li>B</li></ul></li></ul>')).toBe('<ul><li>A<ul><li>x</li><li>B</li></ul></li></ul>');
  });
});
