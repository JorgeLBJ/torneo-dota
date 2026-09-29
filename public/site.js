// Public tournament page: tabs (kept in the URL hash), team filter, and live updates.
// The server renders everything; this file only switches views and applies state.
(function () {
  'use strict';
  var app = document.getElementById('app');
  if (!app) return;

  var TABS = ['partidos', 'posiciones', 'playoffs', 'reglas'];
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
  // regrouped by the visitor's calendar day. Without JavaScript the server's (tournament zone) text stays.
  function localize() {
    var core = window.SiteCore;
    if (!core || !window.Intl) return;
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;

    each('.day-head', function (head) {
      head.parentNode.removeChild(head);
    });
    var rounds = Array.prototype.slice.call(app.querySelectorAll('.days > .round'));
    core.groupDays(rounds.map(function (r) { return r.getAttribute('data-start'); }), tz).forEach(function (group) {
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

    each('.match .time[data-start]', function (el) {
      el.textContent = core.formatTime(el.getAttribute('data-start'), tz);
    });
    each('.when[data-start]', function (el) {
      var end = el.getAttribute('data-end');
      var start = core.formatTime(el.getAttribute('data-start'), tz);
      el.textContent = end ? start + ' – ' + core.formatTime(end, tz) : start;
    });
    each('[data-format="short"][data-start]', function (el) {
      el.textContent = core.formatShort(el.getAttribute('data-start'), tz);
    });
    each('[data-tz-note]', function (el) {
      el.textContent = 'Horarios en tu hora local (' + tz + ')';
    });
  }

  function apply() {
    localize();
    applyTabs();
    applyFilter();
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

  // ---- Live updates -------------------------------------------------------------------------
  // The server pushes a bare "change" event; we re-fetch the rendered fragment and swap it in,
  // then re-apply localization, tab and filter so the view the visitor chose stays put.
  // The connection logic lives in site-core.js (unit-tested); this only wires it to the page.
  var eventsUrl = app.getAttribute('data-events');
  var partialUrl = app.getAttribute('data-partial');

  function swap(html) {
    var x = window.scrollX;
    var y = window.scrollY;
    app.innerHTML = html;
    apply();
    var heading = app.querySelector('h1');
    if (heading) document.title = heading.textContent;
    window.scrollTo(x, y);
  }

  if (eventsUrl && partialUrl && window.EventSource && window.SiteCore) {
    window.SiteCore.createLive({
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
    }).open();
  }
})();
