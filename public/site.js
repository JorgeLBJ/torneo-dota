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
})();
