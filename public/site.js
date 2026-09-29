// Public tournament page: tabs (kept in the URL hash), team filter, and live updates.
// The server renders everything; this file only switches views and applies state.
(function () {
  'use strict';
  var app = document.getElementById('app');
  if (!app) return;

  var TABS = ['partidos', 'envivo', 'posiciones', 'playoffs', 'reglas'];
  var state = { tab: tabFromHash() || TABS[0], filter: '' };

  function tabFromHash() {
    var key = location.hash.replace(/^#/, '');
    return TABS.indexOf(key) >= 0 ? key : null;
  }

  function each(selector, fn) {
    Array.prototype.forEach.call(app.querySelectorAll(selector), fn);
  }

  function applyTabs() {
    each('.tab', function (tab) {
      tab.setAttribute('aria-selected', String(tab.getAttribute('data-tab') === state.tab));
    });
    each('.panel', function (panel) {
      panel.classList.toggle('on', panel.getAttribute('data-panel') === state.tab);
    });
  }

  // The team filter hides matches client-side, so it survives a live refresh untouched.
  function applyFilter() {
    var known = false;
    each('.chip', function (chip) {
      var value = chip.getAttribute('data-filter') || '';
      if (value === state.filter) known = true;
      chip.setAttribute('aria-pressed', String(value === state.filter));
    });
    if (!known) state.filter = '';
    each('.match', function (match) {
      var ids = (match.getAttribute('data-teams') || '').split(' ');
      match.hidden = state.filter !== '' && ids.indexOf(state.filter) < 0;
    });
    each('.round', function (round) {
      var shows = state.filter === '' || round.getAttribute('data-bye') === state.filter || !!round.querySelector('.match:not([hidden])');
      round.hidden = !shows;
    });
    // A day heading stays only while at least one round after it (up to the next heading) is visible.
    each('.day-head', function (head) {
      var visible = false;
      for (var el = head.nextElementSibling; el && !el.classList.contains('day-head'); el = el.nextElementSibling) {
        if (el.classList.contains('round') && !el.hidden) visible = true;
      }
      head.hidden = state.filter !== '' && !visible;
    });
  }

  // Times come from the server as UTC instants and are shown in the visitor's own time zone; days are
  // regrouped by the visitor's calendar day. Whatever cannot be computed (no Intl, unknown zone, a bad
  // instant) is left as the server rendered it, in the tournament's zone.
  function localize() {
    var core = window.SiteCore;
    if (!core || !window.Intl) return;
    var tz;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
      return;
    }
    if (!tz || core.formatTime('2000-01-01T00:00:00Z', tz) === null) return;

    var rounds = Array.prototype.slice.call(app.querySelectorAll('.days > .round'));
    var isos = rounds.map(function (r) { return r.getAttribute('data-start'); });
    // Regroup only when every scheduled round has a usable instant; otherwise the server headings stay.
    var regroup = rounds.length > 0 && isos.every(function (iso) { return iso === null || core.isInstant(iso); });
    if (regroup) {
      each('.day-head', function (head) {
        head.parentNode.removeChild(head);
      });
      core.groupDays(isos, tz).forEach(function (group) {
        var head = document.createElement('div');
        head.className = 'sec day-head';
        var title = document.createElement('h2');
        title.textContent = group.label;
        var sub = document.createElement('span');
        sub.textContent = 'Fase de grupos';
        head.appendChild(title);
        head.appendChild(sub);
        rounds[group.index].parentNode.insertBefore(head, rounds[group.index]);
      });
    }

    function setText(el, text) {
      if (text !== null) el.textContent = text;
    }
    each('.match .time[data-start]', function (el) {
      setText(el, core.formatTime(el.getAttribute('data-start'), tz));
    });
    each('.when[data-start]', function (el) {
      var start = core.formatTime(el.getAttribute('data-start'), tz);
      var endIso = el.getAttribute('data-end');
      var end = endIso ? core.formatTime(endIso, tz) : null;
      if (start !== null) el.textContent = end !== null ? start + ' – ' + end : start;
    });
    each('[data-format="short"][data-start]', function (el) {
      setText(el, core.formatShort(el.getAttribute('data-start'), tz));
    });
    each('[data-tz-note]', function (el) {
      el.textContent = 'Horarios en tu hora local (' + tz + ')';
    });
  }

  function apply() {
    try {
      localize();
    } catch (error) {
      /* keep what the server rendered */
    }
    applyTabs();
    applyFilter();
    scheduleBoundary();
  }

  app.addEventListener('click', function (event) {
    var tab = event.target.closest && event.target.closest('.tab');
    if (tab) {
      state.tab = tab.getAttribute('data-tab');
      history.replaceState(null, '', '#' + state.tab);
      applyTabs();
      return;
    }
    var chip = event.target.closest && event.target.closest('.chip');
    if (chip) {
      state.filter = chip.getAttribute('data-filter') || '';
      applyFilter();
    }
  });

  window.addEventListener('hashchange', function () {
    state.tab = tabFromHash() || state.tab;
    applyTabs();
  });

  apply();

  // "En juego" and "Siguiente" depend on the clock: refresh the fragment when the next slot starts or ends.
  var live = null;
  var boundaryTimer = null;
  var MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
  function scheduleBoundary() {
    clearTimeout(boundaryTimer);
    if (!live || !window.SiteCore) return;
    var instants = [];
    each('.days > .round .when', function (el) {
      instants.push(el.getAttribute('data-start'), el.getAttribute('data-end'));
    });
    // Compare against the server's clock: a visitor whose own clock is off would otherwise flip the tags at the wrong time.
    var stamp = app.querySelector('[data-server-now]');
    var offset = window.SiteCore.clockOffset(stamp && stamp.getAttribute('data-server-now'), Date.now());
    var wait = window.SiteCore.msUntilNextBoundary(instants, Date.now() + offset);
    if (wait === null) return;
    boundaryTimer = setTimeout(function () {
      live.refreshSoon();
    }, Math.min(wait + 1000, MAX_TIMEOUT_MS));
  }

  // ---- Live updates -------------------------------------------------------------------------
  // The server pushes a bare "change" event; we re-fetch the rendered fragment and swap it in,
  // then re-apply localization, tab and filter so the view the visitor chose stays put.
  // The connection logic lives in site-core.js (unit-tested); this only wires it to the page.
  var eventsUrl = app.getAttribute('data-events');
  var partialUrl = app.getAttribute('data-partial');

  function panelShape(panel) {
    if (!panel) return null;
    var frames = panel.querySelectorAll('[data-stream-frame]');
    var frame = frames[0];
    return {
      frames: frames.length,
      frameIsDirectChild: !!frame && frame.parentNode === panel,
      embed: frame ? frame.getAttribute('data-embed') : null,
    };
  }

  function pageShape(root) {
    return {
      main: !!root.querySelector('main'),
      hero: !!root.querySelector('.hero'),
      tabsBar: !!root.querySelector('.tabs-bar'),
      serverNow: !!root.querySelector('[data-server-now]'),
      panels: Array.prototype.map.call(root.querySelectorAll('main .panel'), function (p) { return p.getAttribute('data-panel'); }),
    };
  }

  // Regions are replaced one by one. The stream panel is only patched around its player when the stream is
  // unchanged (moving or re-creating an iframe would restart the video); if the stream changed or the
  // structure is not the expected one, just that panel is replaced. If the page skeleton itself differs
  // (for example "Próximamente" becoming a tournament), everything is replaced.
  function patchRegions(html) {
    var next = document.createElement('div');
    next.innerHTML = html;
    var oldMain = app.querySelector('main');
    var newMain = next.querySelector('main');
    var oldHero = app.querySelector('.hero');
    var newHero = next.querySelector('.hero');
    var oldBar = app.querySelector('.tabs-bar');
    var newBar = next.querySelector('.tabs-bar');
    var oldStamp = app.querySelector('[data-server-now]');
    var newStamp = next.querySelector('[data-server-now]');
    // Do not patch unless the new fragment is a complete page: otherwise replace everything.
    if (!window.SiteCore.canPatchRegions(pageShape(app), pageShape(next))) return false;

    // The server-time stamp comes with every fragment and is read fresh (scheduleBoundary) after each swap.
    oldStamp.parentNode.replaceChild(newStamp, oldStamp);
    oldHero.parentNode.replaceChild(newHero, oldHero);
    oldBar.parentNode.replaceChild(newBar, oldBar);
    Array.prototype.slice.call(newMain.querySelectorAll('.panel')).forEach(function (panel) {
      var key = panel.getAttribute('data-panel');
      var current = oldMain.querySelector('.panel[data-panel="' + key + '"]');
      if (key === 'envivo' && window.SiteCore.streamPatchMode(panelShape(current), panelShape(panel)) === 'keep') {
        keepPlayer(current, panel);
      } else {
        current.parentNode.replaceChild(panel, current);
      }
    });
    return true;
  }

  // Replaces everything in the panel except the player node, which stays exactly where it is.
  function keepPlayer(oldPanel, newPanel) {
    var oldFrame = oldPanel.querySelector('[data-stream-frame]');
    var around = Array.prototype.slice.call(newPanel.children);
    var at = around.indexOf(newPanel.querySelector('[data-stream-frame]'));
    Array.prototype.slice.call(oldPanel.children).forEach(function (child) {
      if (child !== oldFrame) oldPanel.removeChild(child);
    });
    around.forEach(function (child, i) {
      if (i < at) oldPanel.insertBefore(child, oldFrame);
      else if (i > at) oldPanel.appendChild(child);
    });
  }

  function swap(html) {
    var x = window.scrollX;
    var y = window.scrollY;
    if (!(window.SiteCore && patchRegions(html))) app.innerHTML = html;
    apply();
    window.scrollTo(x, y);
  }

  if (eventsUrl && partialUrl && window.EventSource && window.SiteCore) {
    live = window.SiteCore.createLive({
      eventsUrl: eventsUrl,
      connect: function (url) {
        return new EventSource(url);
      },
      fetchFragment: function () {
        return fetch(partialUrl, { cache: 'no-store', headers: { Accept: 'text/html' } }).then(function (res) {
          return res.ok ? res.text() : null;
        });
      },
      swap: swap,
      setLive: function (on) {
        document.documentElement.setAttribute('data-live', on ? 'on' : 'off');
      },
      setTimeout: function (fn, ms) {
        return window.setTimeout(fn, ms);
      },
      clearTimeout: function (id) {
        window.clearTimeout(id);
      },
      random: Math.random,
    });
    live.open();
    scheduleBoundary();
  }
})();
