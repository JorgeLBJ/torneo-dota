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
    each('.day', function (day) {
      day.hidden = !day.querySelector('.round:not([hidden])') && state.filter !== '';
    });
  }

  function apply() {
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
  // then re-apply the tab and filter so the view the visitor chose stays put.
  var eventsUrl = app.getAttribute('data-events');
  var partialUrl = app.getAttribute('data-partial');
  var root = document.documentElement;
  var timer = null;
  var fetching = false;
  var again = false;

  function setLive(on) {
    root.setAttribute('data-live', on ? 'on' : 'off');
  }

  function swap(html) {
    var x = window.scrollX;
    var y = window.scrollY;
    app.innerHTML = html;
    apply();
    var heading = app.querySelector('h1');
    if (heading) document.title = heading.textContent;
    window.scrollTo(x, y);
  }

  function refresh() {
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    fetch(partialUrl, { cache: 'no-store', headers: { Accept: 'text/html' } })
      .then(function (res) {
        return res.ok ? res.text() : null;
      })
      .then(function (html) {
        if (html) swap(html);
      })
      .catch(function () {
        /* offline or server restarting: the next event (or reconnect) retries */
      })
      .then(function () {
        fetching = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  }

  // Several changes in a burst (e.g. a whole round saved) cost a single fetch.
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  }

  if (eventsUrl && partialUrl && window.EventSource) {
    var connectedBefore = false;
    var source = new EventSource(eventsUrl);
    source.addEventListener('hello', function () {
      setLive(true);
      // A reconnect may have missed changes while the connection was down.
      if (connectedBefore) schedule();
      connectedBefore = true;
    });
    source.addEventListener('change', schedule);
    // EventSource reconnects on its own; the pill just tracks whether we are connected.
    source.onerror = function () {
      setLive(false);
    };
  }
})();
