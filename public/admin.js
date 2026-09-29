// Small progressive enhancements for the backoffice. Every page works without JavaScript.
(function () {
  // Tournament selector in the sidebar navigates to the same section of the chosen tournament.
  document.querySelectorAll('[data-nav-select]').forEach(function (select) {
    select.addEventListener('change', function () {
      window.location.href = select.value;
    });
  });
  // Selects marked data-autosubmit submit their form when changed.
  document.querySelectorAll('select[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      select.form && select.form.submit();
    });
  });
})();

// Hero picker dialog (Equipos screen).
(function () {
  var dataEl = document.getElementById('heroes-data');
  var modal = document.getElementById('heroModal');
  if (!dataEl || !modal || typeof modal.showModal !== 'function') return;

  var data = JSON.parse(dataEl.textContent);
  var heroes = data.heroes;
  var taken = data.taken;
  var grid = document.getElementById('heroGrid');
  var search = document.getElementById('heroSearch');
  var label = document.getElementById('heroTeam');
  var attr = 'any';
  var current = null;

  function render() {
    var query = search.value.trim().toLowerCase();
    var own = current.input.value;
    grid.textContent = '';
    heroes.forEach(function (hero) {
      if (attr !== 'any' && hero.attr !== attr) return;
      if (query && hero.name.toLowerCase().indexOf(query) === -1) return;
      var isTaken = Object.prototype.hasOwnProperty.call(taken, hero.slug) && hero.slug !== own;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'hero' + (hero.slug === own ? ' sel' : '') + (isTaken ? ' taken' : '');
      button.disabled = isTaken;
      button.title = isTaken ? 'Ya lo usa el equipo ' + taken[hero.slug] : hero.name;
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = '/assets/heroes/' + hero.slug + '.png';
      var name = document.createElement('span');
      name.textContent = hero.name;
      button.appendChild(img);
      button.appendChild(name);
      button.addEventListener('click', function () {
        choose(hero);
      });
      grid.appendChild(button);
    });
  }

  function choose(hero) {
    current.input.value = hero.slug;
    current.button.textContent = '';
    var img = document.createElement('img');
    img.alt = '';
    img.src = '/assets/heroes/' + hero.slug + '.png';
    current.button.appendChild(img);
    current.button.classList.add('filled');
    if (current.nameEl) current.nameEl.textContent = hero.name;
    modal.close();
  }

  document.querySelectorAll('[data-hero-pick]').forEach(function (button) {
    button.addEventListener('click', function () {
      var cell = button.parentElement;
      current = {
        button: button,
        input: cell.querySelector('[data-hero-input]'),
        nameEl: cell.querySelector('[data-hero-name]'),
      };
      label.textContent = button.getAttribute('data-team-label') || '';
      search.value = '';
      render();
      modal.showModal();
      search.focus();
    });
  });

  search.addEventListener('input', function () {
    if (current) render();
  });
  document.querySelectorAll('[data-attr]').forEach(function (button) {
    button.addEventListener('click', function () {
      attr = button.getAttribute('data-attr');
      document.querySelectorAll('[data-attr]').forEach(function (b) {
        b.classList.toggle('on', b === button);
      });
      if (current) render();
    });
  });
  var close = modal.querySelector('[data-hero-close]');
  if (close) close.addEventListener('click', function () { modal.close(); });
})();

// Logout confirmation. Without JavaScript the button simply submits the form.
(function () {
  var dialog = document.getElementById('logoutDialog');
  var open = document.querySelector('[data-logout-open]');
  if (!dialog || !open || typeof dialog.showModal !== 'function') return;
  open.addEventListener('click', function (event) {
    event.preventDefault();
    dialog.showModal();
  });
  var cancel = dialog.querySelector('[data-logout-cancel]');
  if (cancel) cancel.addEventListener('click', function () { dialog.close(); });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
