/*
 * Rulebook editor (admin, Reglas). A contenteditable area with a toolbar; whatever it holds is cleaned down to the
 * set of tags the server accepts and written into the form's textarea (name="rules_html") and the live preview.
 * The server sanitizes again on save and on render: this cleaning is for the editor's comfort, not for security.
 * Without JavaScript the textarea (raw HTML) stays visible and works on its own.
 */
(function () {
  'use strict';

  var HIGHLIGHTS = { g: true, r: true, d: true };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1, TEXTAREA: 1, TITLE: 1, HEAD: 1, SELECT: 1, META: 1, LINK: 1, BASE: 1 };
  var KEEP = { P: 'p', H2: 'h2', H3: 'h3', UL: 'ul', OL: 'ol', LI: 'li', BR: 'br', HR: 'hr', B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's' };
  // Headings of other sizes (h1, h4-h6) become the closest ones we have.
  var HEADINGS = { H1: 'h2', H4: 'h3', H5: 'h3', H6: 'h3' };
  var BLOCKS = { P: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, HR: 1, DIV: 1, TABLE: 1, TR: 1, SECTION: 1, ARTICLE: 1, BLOCKQUOTE: 1, PRE: 1, H1: 1, H4: 1, H5: 1, H6: 1 };

  function safeHref(value) {
    var v = String(value || '').replace(/[\u0000-\u001f\u007f\s]+/g, '');
    return /^(https?:\/\/[^\s]|mailto:[^\s])/i.test(v) ? v : null;
  }

  // Word and WhatsApp mark bold/italic/underline with inline styles on spans and fonts: keep the meaning.
  function styleTags(el) {
    var style = (el.getAttribute('style') || '').toLowerCase();
    var tags = [];
    if (/font-weight:\s*(bold|[6-9]00)/.test(style)) tags.push('strong');
    if (/font-style:\s*italic/.test(style)) tags.push('em');
    if (/text-decoration[^;]*underline/.test(style)) tags.push('u');
    if (/text-decoration[^;]*line-through/.test(style)) tags.push('s');
    return tags;
  }

  function walk(node, out, doc) {
    var child;
    for (child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        out.appendChild(doc.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.tagName.toUpperCase();
      if (DROP[tag]) continue;
      var name = KEEP[tag] || HEADINGS[tag];
      var el = null;
      if (name === 'br' || name === 'hr') {
        out.appendChild(doc.createElement(name));
        continue;
      }
      if (name) {
        el = doc.createElement(name);
      } else if (tag === 'MARK') {
        var cls = (child.getAttribute('class') || '').trim();
        if (HIGHLIGHTS[cls]) {
          el = doc.createElement('mark');
          el.setAttribute('class', cls);
        }
      } else if (tag === 'DIV' && (child.getAttribute('class') || '').trim() === 'callout') {
        el = doc.createElement('div');
        el.setAttribute('class', 'callout');
      } else if (tag === 'A') {
        var href = safeHref(child.getAttribute('href'));
        if (href) {
          el = doc.createElement('a');
          el.setAttribute('href', href);
        }
      } else if (tag === 'SPAN' || tag === 'FONT') {
        var wrappers = styleTags(child);
        if (wrappers.length) {
          el = doc.createElement(wrappers[0]);
          var inner = el;
          wrappers.slice(1).forEach(function (w) {
            var next = doc.createElement(w);
            inner.appendChild(next);
            inner = next;
          });
          walk(child, inner, doc);
          out.appendChild(el);
          continue;
        }
      }
      if (el) {
        walk(child, el, doc);
        out.appendChild(el);
      } else {
        // Unknown element: keep its content; a block-level one (div, blockquote, table row...) becomes a paragraph.
        if (BLOCKS[tag] && !out.__inline) {
          var p = doc.createElement('p');
          walk(child, p, doc);
          if (p.childNodes.length) out.appendChild(p);
        } else {
          walk(child, out, doc);
        }
      }
    }
  }

  // Loose text and inline runs at the top level (or in a callout) are wrapped into paragraphs.
  function wrapLoose(root, doc) {
    var run = null;
    var nodes = Array.prototype.slice.call(root.childNodes);
    nodes.forEach(function (n) {
      var isBlock = n.nodeType === 1 && /^(P|H2|H3|UL|OL|HR|DIV)$/.test(n.tagName.toUpperCase());
      if (isBlock) {
        run = null;
      } else if (n.nodeType === 3 && !n.nodeValue.trim() && !run) {
        root.removeChild(n);
      } else {
        if (!run) {
          run = doc.createElement('p');
          root.insertBefore(run, n);
        }
        run.appendChild(n);
      }
    });
  }

  function clean(html) {
    var doc = document.implementation.createHTMLDocument('');
    var source = doc.createElement('div');
    // A template keeps scripts and handlers inert while the markup is read.
    var tpl = doc.createElement('template');
    tpl.innerHTML = String(html || '');
    source.appendChild(tpl.content);
    var out = doc.createElement('div');
    walk(source, out, doc);
    wrapLoose(out, doc);
    Array.prototype.forEach.call(out.querySelectorAll('div.callout'), function (c) { wrapLoose(c, doc); });
    // Browsers indent a list item by putting a list directly inside the list: move it into the previous item.
    Array.prototype.forEach.call(out.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol'), function (inner) {
      var prev = inner.previousElementSibling;
      if (prev && prev.tagName === 'LI') {
        prev.appendChild(inner);
      } else {
        var li = doc.createElement('li');
        inner.parentNode.insertBefore(li, inner);
        li.appendChild(inner);
      }
    });
    // Empty paragraphs and a lone <br> shell are noise.
    Array.prototype.forEach.call(out.querySelectorAll('p'), function (p) {
      if (!p.textContent.trim() && !p.querySelector('br,hr')) p.parentNode.removeChild(p);
    });
    return out.innerHTML;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function plainToHtml(text) {
    return text
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map(function (chunk) { return chunk.trim() ? '<p>' + escapeHtml(chunk.trim()).replace(/\n/g, '<br>') + '</p>' : ''; })
      .join('');
  }

  function init(root) {
    var toolbar = root.querySelector('[data-rb-toolbar]');
    var area = root.querySelector('[data-rb-area]');
    var source = root.querySelector('[data-rb-source]');
    var preview = root.querySelector('[data-rb-preview]');
    if (!toolbar || !area || !source || !preview) return;

    area.innerHTML = clean(source.value);
    source.hidden = true;
    area.hidden = false;
    toolbar.hidden = false;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browsers */ }

    var pending = false;
    function sync() {
      pending = false;
      var html = clean(area.innerHTML);
      source.value = html;
      preview.innerHTML = html;
    }
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(sync);
    }

    function selectionInside() {
      var sel = window.getSelection();
      return sel && sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel : null;
    }
    function closest(node, selector) {
      var el = node && node.nodeType === 3 ? node.parentNode : node;
      while (el && el !== area) {
        if (el.matches && el.matches(selector)) return el;
        el = el.parentNode;
      }
      return null;
    }
    function unwrap(el) {
      var parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }

    function highlight(kind) {
      var sel = selectionInside();
      if (!sel) return;
      var range = sel.getRangeAt(0);
      var existing = closest(range.commonAncestorContainer, 'mark');
      if (existing) {
        // Same colour again removes it; another colour switches it.
        if (existing.getAttribute('class') === kind) unwrap(existing);
        else existing.setAttribute('class', kind);
        return;
      }
      if (range.collapsed) return;
      var mark = document.createElement('mark');
      mark.setAttribute('class', kind);
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      sel.removeAllRanges();
      var after = document.createRange();
      after.selectNodeContents(mark);
      sel.addRange(after);
    }

    // A note is a box around whole blocks: the blocks the selection touches (or the one under the caret) move inside it.
    function callout() {
      var sel = selectionInside();
      if (!sel) return;
      var range = sel.getRangeAt(0);
      var existing = closest(range.commonAncestorContainer, 'div.callout');
      if (existing) {
        unwrap(existing);
        return;
      }
      function top(node) {
        var el = node.nodeType === 3 ? node.parentNode : node;
        while (el && el.parentNode !== area) el = el.parentNode;
        return el;
      }
      var first = top(range.startContainer);
      var last = top(range.endContainer);
      if (!first || !last) return;
      var box = document.createElement('div');
      box.setAttribute('class', 'callout');
      area.insertBefore(box, first);
      var node = first;
      while (node) {
        var next = node === last ? null : node.nextSibling;
        box.appendChild(node);
        node = next;
      }
      if (!box.textContent.trim()) {
        box.innerHTML = '<p>Escribe aquí la nota</p>';
      }
      var inside = document.createRange();
      inside.selectNodeContents(box.lastChild);
      sel.removeAllRanges();
      sel.addRange(inside);
    }

    function block(tag) {
      var sel = selectionInside();
      if (!sel) return;
      // Pressing the heading button again turns that one heading back into a paragraph; over several blocks it applies the heading.
      var range = sel.getRangeAt(0);
      var first = closest(range.startContainer, 'h2,h3');
      var last = closest(range.endContainer, 'h2,h3');
      var same = first && first === last && first.tagName.toLowerCase() === tag;
      document.execCommand('formatBlock', false, same ? 'p' : tag);
    }

    function link() {
      var sel = selectionInside();
      if (!sel) return;
      var existing = closest(sel.getRangeAt(0).commonAncestorContainer, 'a');
      if (existing) {
        unwrap(existing);
        return;
      }
      var url = window.prompt('Enlace (https://…)');
      if (!url) return;
      var href = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url : 'https://' + url.trim());
      if (!href) {
        window.alert('Solo se admiten enlaces http, https o mailto.');
        return;
      }
      document.execCommand('createLink', false, href);
    }

    toolbar.addEventListener('mousedown', function (event) {
      // Keep the selection in the editable area while a button is pressed.
      if (event.target.closest('button')) event.preventDefault();
    });
    toolbar.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      area.focus();
      var cmd = button.getAttribute('data-cmd');
      var arg = button.getAttribute('data-arg');
      if (cmd === 'block') block(arg);
      else if (cmd === 'mark') highlight(arg);
      else if (cmd === 'callout') callout();
      else if (cmd === 'link') link();
      else if (cmd === 'hr') document.execCommand('insertHorizontalRule');
      else if (cmd === 'removeFormat') {
        document.execCommand('removeFormat');
        var sel = selectionInside();
        if (sel) {
          var node = closest(sel.getRangeAt(0).commonAncestorContainer, 'mark');
          if (node) unwrap(node);
          ['h2', 'h3'].forEach(function (t) {
            var heading = closest(sel.getRangeAt(0).startContainer, t);
            if (heading) document.execCommand('formatBlock', false, 'p');
          });
        }
      } else document.execCommand(cmd);
      sync();
    });

    area.addEventListener('input', schedule);
    area.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var sel = selectionInside();
      if (sel && closest(sel.getRangeAt(0).startContainer, 'li')) {
        event.preventDefault();
        document.execCommand(event.shiftKey ? 'outdent' : 'indent');
        sync();
      }
    });
    area.addEventListener('paste', function (event) {
      var data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      var html = data.getData('text/html');
      var cleaned = html ? clean(html) : plainToHtml(data.getData('text/plain'));
      document.execCommand('insertHTML', false, cleaned);
      sync();
    });
    root.closest('form').addEventListener('submit', sync);
    sync();
  }

  window.RulebookEditor = { clean: clean };
  Array.prototype.forEach.call(document.querySelectorAll('[data-rb-editor]'), init);
})();
