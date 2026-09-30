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
  window.teamRows = window.teamRows || {};
  var grid = document.getElementById('heroGrid');
  var search = document.getElementById('heroSearch');
  var label = document.getElementById('heroTeam');
  var attr = 'any';
  var current = null;

  function render() {
    var query = search.value.trim().toLowerCase();
    var own = current.input.value;
    // Taken = in use by ANOTHER row as the page will be after saving (a hero a row is moving away from is free).
    var taken = window.teamRows.takenBy(current.cell);
    grid.textContent = '';
    heroes.forEach(function (hero) {
      if (attr !== 'any' && hero.attr !== attr) return;
      if (query && hero.name.toLowerCase().indexOf(query) === -1) return;
      var isTaken = Object.prototype.hasOwnProperty.call(taken, hero.slug);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'hero' + (hero.slug === own ? ' sel' : '') + (isTaken ? ' taken' : '');
      button.disabled = isTaken;
      button.title = isTaken ? 'Ya lo usa ' + taken[hero.slug] : hero.name;
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
    var cell = current.cell;
    modal.close();
    // The emblem change is staged in its row (see "Team rows"): nothing is saved until that row's Guardar.
    window.teamRows.pickHero(cell, hero);
  }

  document.querySelectorAll('[data-hero-pick]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (window.teamRows.busy) return;
      var cell = button.closest('[data-emblem-cell]');
      current = { cell: cell, input: cell.querySelector('[data-hero-input]') };
      label.textContent = window.teamRows.nameOf(cell);
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

// Confirmation dialogs. Without JavaScript the trigger simply submits its form.
(function () {
  function wire(trigger, dialogId) {
    var dialog = document.getElementById(dialogId);
    if (!dialog || !trigger || typeof dialog.showModal !== 'function') return;
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      dialog.showModal();
    });
    var cancel = dialog.querySelector('[data-logout-cancel], [data-confirm-cancel]');
    if (cancel) cancel.addEventListener('click', function () { dialog.close(); });
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
  }
  wire(document.querySelector('[data-logout-open]'), 'logoutDialog');
  document.querySelectorAll('[data-confirm-open]').forEach(function (button) {
    wire(button, button.getAttribute('data-confirm-open'));
  });
})();

// Team rows (Equipos): every change (fields, hero, uploaded image, removal) is STAGED in its row. Nothing is saved
// until "Guardar cambios", which sends ONE batch for all changed rows; the server validates the final state of the
// whole tournament, so heroes and codes can move between teams in the same save. Each team has a hero OR its own
// image, never both. The new-team row is a separate plain form ("+ Agregar equipo"): it creates a team and reloads.
(function () {
  var cells = Array.prototype.slice.call(document.querySelectorAll('[data-emblem-cell]'));
  if (!cells.length) return;

  var HEROES = '/assets/heroes/';
  var states = [];
  var bar = document.querySelector('[data-save-bar]');
  var replaceDialog = document.getElementById('replaceImageDialog');
  var discardDialog = document.getElementById('discardAllDialog');
  var replacing = null;
  var saving = false;
  var api = window.teamRows || {};
  window.teamRows = api;

  function formIdOf(cell) {
    return cell.querySelector('[data-hero-input]').getAttribute('form');
  }

  function fieldsOf(state) {
    return Array.prototype.slice.call(document.querySelectorAll('[form="' + state.formId + '"]'))
      .filter(function (el) { return el !== state.heroInput; });
  }

  function savedFrom(cell, heroInput) {
    return {
      hasImage: cell.getAttribute('data-has-image') === '1',
      src: cell.getAttribute('data-saved-src') || '',
      src2x: cell.getAttribute('data-saved-src2x') || '',
      hero: heroInput.defaultValue,
      heroName: cell.getAttribute('data-hero-name') || '',
      code: cell.getAttribute('data-code') || '',
    };
  }

  cells.forEach(function (cell) {
    var heroInput = cell.querySelector('[data-hero-input]');
    var state = {
      cell: cell,
      formId: formIdOf(cell),
      row: cell.closest('[data-team-row]'),
      heroInput: heroInput,
      thumb: cell.querySelector('[data-emblem-thumb]'),
      label: cell.querySelector('[data-emblem-label]'),
      marker: cell.querySelector('[data-unsaved]'),
      removeItem: cell.querySelector('[data-remove-image]'),
      saved: savedFrom(cell, heroInput),
      blob: null,
      blobUrl: null,
      removeImage: false,
      hero: heroInput.defaultValue,
      heroName: cell.getAttribute('data-hero-name') || '',
    };
    cell.teamRowState = state;
    states.push(state);
  });
  var rowStates = states.filter(function (state) { return state.row; });

  function dropBlob(state) {
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = null;
    state.blobUrl = null;
  }

  /** The hero the team will have once saved: none while a custom image is staged (the emblem is exclusive). */
  function finalHero(state) {
    return state.blob ? '' : state.hero;
  }

  function isDirty(state) {
    if (state.blob || state.removeImage) return true;
    // A hidden input's value IS its default value (the same attribute), so the staged hero is compared directly.
    if (state.hero !== state.saved.hero) return true;
    return fieldsOf(state).some(function (el) { return el.value !== el.defaultValue; });
  }

  function message(state, text, kind) {
    if (!state.row) return;
    var next = state.row.nextElementSibling;
    var exists = next && next.classList.contains('row-msg');
    if (!text) {
      if (exists) next.remove();
      return;
    }
    if (!exists) {
      next = document.createElement('tr');
      next.className = 'row-msg';
      next.appendChild(document.createElement('td')).setAttribute('colspan', '5');
      state.row.parentNode.insertBefore(next, state.row.nextSibling);
    }
    var cell = next.firstChild;
    cell.textContent = '';
    var p = document.createElement('p');
    p.className = 'flash ' + kind;
    p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    p.textContent = text;
    cell.appendChild(p);
  }

  // ---------- The action bar ----------

  var barText = bar && bar.querySelector('[data-save-text]');
  var barMessage = bar && bar.querySelector('[data-save-message]');
  var saveButton = bar && bar.querySelector('[data-save-all]');
  var saveCount = bar && bar.querySelector('[data-save-count]');
  var discardButton = bar && bar.querySelector('[data-discard-all]');
  var barTimer = null;

  function dirtyStates() {
    return rowStates.filter(isDirty);
  }

  function refreshBar() {
    if (!bar) return;
    var count = dirtyStates().length;
    saveCount.textContent = String(count);
    barText.textContent = count === 1 ? '1 equipo con cambios sin guardar' : count + ' equipos con cambios sin guardar';
    // The bar also shows the result of a save for a few seconds.
    bar.hidden = count === 0 && !barMessage.textContent;
    barText.hidden = count === 0;
    saveButton.hidden = count === 0;
    discardButton.hidden = count === 0;
  }

  function barNote(text, kind) {
    if (!bar) return;
    clearTimeout(barTimer);
    barMessage.textContent = text || '';
    barMessage.className = 'save-message' + (text ? ' ' + kind : '');
    barMessage.hidden = !text;
    refreshBar();
    if (text && kind === 'ok') {
      barTimer = setTimeout(function () { barNote('', ''); }, 6000);
    }
  }

  function refreshDirty(state) {
    if (state.row) {
      var dirty = isDirty(state);
      state.marker.hidden = !dirty;
      state.row.classList.toggle('dirty', dirty);
      var undo = state.row.querySelector('[data-undo]');
      if (undo) undo.hidden = !dirty;
    }
    refreshBar();
  }

  // ---------- Drawing a row ----------

  /** Draws the row's emblem from its state: staged image, saved image, hero, or the code tile. */
  function render(state) {
    var kind = state.blob ? 'staged' : state.saved.hasImage && !state.removeImage ? 'saved' : '';
    var thumb = state.thumb;
    thumb.textContent = '';
    var full = '';
    var fallback = '';
    var source = '';
    if (kind) {
      var img = document.createElement('img');
      img.alt = '';
      if (kind === 'staged') {
        img.src = state.blobUrl;
        full = state.blobUrl;
      } else {
        img.src = state.saved.src;
        img.srcset = state.saved.src + ' 1x, ' + state.saved.src2x + ' 2x';
        full = state.saved.src2x;
        fallback = state.saved.src;
      }
      source = 'Imagen propia';
      thumb.appendChild(img);
    } else if (state.hero) {
      var portrait = document.createElement('img');
      portrait.alt = '';
      portrait.src = HEROES + state.hero + '.png';
      thumb.appendChild(portrait);
      full = portrait.getAttribute('src');
      source = state.heroName;
    } else {
      var tile = document.createElement('span');
      tile.className = 'emblem-code';
      var color = state.cell.getAttribute('data-color');
      if (color) tile.style.setProperty('--tc', color);
      tile.textContent = state.saved.code || '?';
      thumb.appendChild(tile);
    }
    var name = state.row ? api.nameOf(state.cell) : '';
    thumb.disabled = !full;
    ['data-full', 'data-fallback', 'data-source', 'aria-label'].forEach(function (attr) { thumb.removeAttribute(attr); });
    if (full) {
      thumb.setAttribute('data-full', full);
      if (fallback) thumb.setAttribute('data-fallback', fallback);
      thumb.setAttribute('data-source', source);
      thumb.setAttribute('aria-label', 'Ver emblema' + (name ? ' de ' + name : ''));
    }
    thumb.setAttribute('data-name', name);
    var text = kind ? 'Imagen propia' : state.hero ? state.heroName : 'Sin emblema';
    state.label.textContent = text;
    state.label.parentNode.title = text;
    state.cell.setAttribute('data-has-image', kind ? '1' : '0');
    state.heroInput.value = state.hero;
    if (state.removeItem) state.removeItem.hidden = !kind;
    refreshDirty(state);
  }

  function stateOf(cell) {
    return cell.teamRowState;
  }

  /** The team's name as currently typed in its row (the saved name when that field is empty). */
  api.nameOf = function (cell) {
    var input = document.querySelector('[form="' + formIdOf(cell) + '"][name="name"]');
    var typed = input ? input.value.trim() : '';
    return typed || cell.getAttribute('data-team-name') || 'el equipo';
  };

  /** Labels built from the name follow what is typed. */
  function refreshNames(state) {
    var name = api.nameOf(state.cell);
    state.thumb.setAttribute('data-name', state.row ? name : '');
    if (state.thumb.getAttribute('aria-label')) state.thumb.setAttribute('aria-label', 'Ver emblema de ' + name);
    var file = state.cell.querySelector('[data-image-file]');
    if (file) file.setAttribute('aria-label', 'Imagen del equipo ' + name);
  }

  /**
   * Heroes in use right now by the OTHER rows, as the page will be after saving: a hero another row is moving away
   * from (or replacing by an image) is free; one it is about to take is taken. Value: the team's name.
   */
  api.takenBy = function (cell) {
    var taken = {};
    rowStates.forEach(function (state) {
      if (state.cell === cell) return;
      var hero = finalHero(state);
      if (hero) taken[hero] = api.nameOf(state.cell);
    });
    return taken;
  };

  // ---------- Staging ----------

  api.stageImage = function (cell, blob) {
    var state = stateOf(cell);
    dropBlob(state);
    state.blob = blob;
    state.blobUrl = URL.createObjectURL(blob);
    state.removeImage = false;
    message(state, '');
    render(state);
  };

  /** "Quitar imagen": drops a staged image (back to what the row had) or removes the saved one. */
  api.stageRemoval = function (cell) {
    var state = stateOf(cell);
    if (state.blob) dropBlob(state);
    else state.removeImage = state.saved.hasImage;
    message(state, '');
    render(state);
  };

  function applyHero(state, hero) {
    dropBlob(state);
    state.removeImage = state.saved.hasImage;
    state.hero = hero.slug;
    state.heroName = hero.name;
    message(state, '');
    render(state);
  }

  /** Picking a hero while an image shows means giving the image up, so it asks first (the change is still staged). */
  api.pickHero = function (cell, hero) {
    var state = stateOf(cell);
    var showsImage = state.blob || (state.saved.hasImage && !state.removeImage);
    if (showsImage && replaceDialog && typeof replaceDialog.showModal === 'function') {
      replacing = { state: state, hero: hero };
      replaceDialog.showModal();
      return;
    }
    applyHero(state, hero);
  };

  if (replaceDialog) {
    var confirmReplace = replaceDialog.querySelector('[data-replace-confirm]');
    if (confirmReplace) {
      confirmReplace.addEventListener('click', function () {
        if (replacing) applyHero(replacing.state, replacing.hero);
        replacing = null;
        replaceDialog.close();
      });
    }
    replaceDialog.addEventListener('close', function () { replacing = null; });
  }

  function undo(state) {
    dropBlob(state);
    state.removeImage = false;
    state.hero = state.saved.hero;
    state.heroName = state.saved.heroName;
    fieldsOf(state).forEach(function (el) { el.value = el.defaultValue; });
    message(state, '');
    render(state);
  }

  // ---------- Saving everything at once ----------

  /** Redraws one row from the server's JSON. */
  function applySaved(state, team) {
    var values = { code: team.code, name: team.name, captain: team.captain || '' };
    fieldsOf(state).forEach(function (el) {
      if (Object.prototype.hasOwnProperty.call(values, el.name)) el.value = values[el.name];
    });
    dropBlob(state);
    state.removeImage = false;
    state.hero = team.hero || '';
    state.heroName = team.heroName || '';
    var image = team.emblem.kind === 'image';
    state.saved = {
      hasImage: image,
      src: image ? team.emblem.src : '',
      src2x: image ? team.emblem.src2x : '',
      hero: state.hero,
      heroName: state.heroName,
      code: team.code,
    };
    state.cell.setAttribute('data-code', team.code);
    state.cell.setAttribute('data-team-name', team.name);
    state.heroInput.value = state.hero;
    state.heroInput.defaultValue = state.hero;
    fieldsOf(state).forEach(function (el) { el.defaultValue = el.value; });
    message(state, '');
    render(state);
  }

  function rowPayload(state) {
    var value = function (name) {
      var el = document.querySelector('[form="' + state.formId + '"][name="' + name + '"]');
      return el ? el.value : '';
    };
    var emblem = 'keep';
    if (state.blob) emblem = 'image';
    else if (state.removeImage || state.hero !== state.saved.hero) emblem = state.hero ? 'hero' : 'none';
    var payload = {
      id: Number(state.row.getAttribute('data-team-id')),
      code: value('code'),
      name: value('name'),
      captain: value('captain'),
      hero: emblem === 'hero' ? state.hero : null,
      emblem: emblem,
    };
    if (emblem === 'image') payload.imageField = 'image_' + payload.id;
    return payload;
  }

  var region = document.querySelector('[data-busy-region]');
  var overlay = region && region.querySelector('[data-busy]');
  var busyText = overlay && overlay.querySelector('[data-busy-text]');
  var progress = overlay && overlay.querySelector('[data-busy-progress]');
  var progressFill = overlay && overlay.querySelector('[data-busy-fill]');
  var frozen = [];

  /** While saving, nothing on the table can be touched; the sidebar and the page stay usable. */
  function setSaving(on) {
    saving = on;
    api.busy = on;
    saveButton.disabled = on;
    discardButton.disabled = on;
    saveButton.classList.toggle('is-busy', on);
    saveButton.querySelector('[data-save-label]').textContent = on ? 'Guardando…' : 'Guardar cambios';
    if (!region) return;
    var table = region.querySelector('table');
    region.classList.toggle('is-saving', on);
    overlay.hidden = !on;
    if (on) {
      region.setAttribute('aria-busy', 'true');
      if (table) table.setAttribute('aria-busy', 'true');
    } else {
      region.removeAttribute('aria-busy');
      if (table) table.removeAttribute('aria-busy');
    }
    if ('inert' in region) {
      region.querySelector('.card').inert = on;
    } else if (on) {
      // No inert support: disable every control that is still enabled, and restore exactly those afterwards.
      frozen = Array.prototype.filter.call(region.querySelectorAll('input, button, select, textarea, summary'), function (el) { return !el.disabled; });
      frozen.forEach(function (el) { el.disabled = true; });
    } else {
      frozen.forEach(function (el) { el.disabled = false; });
      frozen = [];
    }
  }

  function showProgress(images) {
    progress.hidden = images === 0;
    progressFill.style.width = '0%';
    busyText.textContent = images > 0 ? 'Subiendo ' + images + (images === 1 ? ' imagen…' : ' imágenes…') : 'Guardando cambios…';
  }

  function handleSaved(status, body, redirected) {
    setSaving(false);
    if (status >= 200 && status < 300 && body.teams) {
      body.teams.forEach(function (team) {
        var row = document.querySelector('[data-team-row][data-team-id="' + team.id + '"]');
        if (row) applySaved(stateOf(row.querySelector('[data-emblem-cell]')), team);
      });
      barNote(body.message || 'Cambios guardados.', 'ok');
    } else if (body.errors) {
      var first = null;
      Object.keys(body.errors).forEach(function (id) {
        var row = document.querySelector('[data-team-row][data-team-id="' + id + '"]');
        if (!row) return;
        message(stateOf(row.querySelector('[data-emblem-cell]')), body.errors[id], 'error');
        if (!first) first = row;
      });
      barNote('No se guardó nada: corrige las filas marcadas y vuelve a guardar. Tus cambios siguen aquí.', 'error');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (status === 401 || status === 403 || redirected) {
      barNote('La sesión caducó. Recarga la página e inicia sesión de nuevo; tus cambios siguen aquí hasta entonces.', 'error');
    } else {
      barNote(body.error || 'No se pudieron guardar los cambios. Inténtalo de nuevo.', 'error');
    }
  }

  function saveAll() {
    if (saving) return;
    var dirty = dirtyStates();
    if (!dirty.length) return;
    rowStates.forEach(function (state) { message(state, ''); });
    barNote('', '');
    var data = new FormData();
    data.set('rows', JSON.stringify(dirty.map(rowPayload)));
    var images = 0;
    dirty.forEach(function (state) {
      if (state.blob) {
        images++;
        var id = state.row.getAttribute('data-team-id');
        data.set('image_' + id, state.blob, state.blob.type === 'image/png' ? 'equipo.png' : 'equipo.webp');
      }
    });
    setSaving(true);
    showProgress(images);
    // XMLHttpRequest, not fetch: it reports how much of the upload has been sent.
    var url = bar.getAttribute('data-batch-url');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = function (event) {
      if (!images || !event.lengthComputable) return;
      var percent = Math.round(100 * event.loaded / event.total);
      progressFill.style.width = percent + '%';
      busyText.textContent = 'Subiendo ' + images + (images === 1 ? ' imagen… ' : ' imágenes… ') + percent + '%';
    };
    xhr.upload.onload = function () {
      progress.hidden = true;
      busyText.textContent = 'Guardando cambios…';
    };
    xhr.onload = function () {
      var body = {};
      try { body = JSON.parse(xhr.responseText); } catch (error) { body = {}; }
      handleSaved(xhr.status, body, Boolean(xhr.responseURL) && xhr.responseURL.indexOf(url) === -1);
    };
    xhr.onerror = xhr.ontimeout = function () {
      setSaving(false);
      barNote('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.', 'error');
    };
    xhr.send(data);
  }

  function discardAll() {
    rowStates.forEach(function (state) { if (isDirty(state)) undo(state); });
    barNote('', '');
  }

  if (saveButton) saveButton.addEventListener('click', saveAll);
  if (discardButton) {
    discardButton.addEventListener('click', function () {
      if (discardDialog && typeof discardDialog.showModal === 'function') discardDialog.showModal();
      else discardAll();
    });
  }
  if (discardDialog) {
    var confirmDiscard = discardDialog.querySelector('[data-discard-confirm]');
    if (confirmDiscard) {
      confirmDiscard.addEventListener('click', function () {
        discardAll();
        discardDialog.close();
      });
    }
  }

  states.forEach(function (state) {
    render(state);
    if (!state.row) return;
    var undoButton = state.row.querySelector('[data-undo]');
    if (undoButton) undoButton.addEventListener('click', function () { undo(state); });
  });
  refreshBar();

  // Typing in any field of a row marks that row as unsaved.
  document.addEventListener('input', function (event) {
    var formId = event.target && event.target.getAttribute && event.target.getAttribute('form');
    if (!formId) return;
    states.forEach(function (state) {
      if (state.formId !== formId) return;
      if (state.row) message(state, '');
      if (event.target.name === 'name') refreshNames(state);
      refreshDirty(state);
    });
  });

  // Leaving with unsaved edits asks first. Only "+ Agregar equipo" with nothing else pending goes through silently.
  var leaving = false;
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (saving) {
      event.preventDefault();
      return;
    }
    if (form && form.matches && form.matches('#team-new') && !dirtyStates().length) {
      leaving = true;
      setTimeout(function () { leaving = false; }, 0);
    }
  }, true);
  window.addEventListener('beforeunload', function (event) {
    if (leaving || !states.some(isDirty)) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();

// Custom team image: pick a file, crop it to 16:9 with Cropper.js, upload the result.
(function () {
  var modal = document.getElementById('imageModal');
  if (!modal || typeof modal.showModal !== 'function') return;

  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var WRONG = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';
  var OUT = { width: 1024, height: 576 };
  var DARK = '#0f1114'; // the public site's panel colour
  var BLUR_PX = 24; // at 1024 px wide; scaled for smaller renders
  var MIN_OVERLAP = 0.02; // less of the frame than this covered by the picture would upload a blank image
  var SOURCE_MAX = 1600; // longest side of the copy used for the blurred backdrop

  var image = document.getElementById('cropImage');
  var editor = document.getElementById('imageEditor');
  var errorBox = document.getElementById('imageError');
  var teamLabel = document.getElementById('imageTeam');
  var zoom = document.getElementById('cropZoom');
  var fillBox = document.getElementById('cropFill');
  var saveButton = document.getElementById('cropSave');
  var cancelButton = document.getElementById('cropCancel');
  var rotateButton = document.getElementById('cropRotate');
  var fitButton = document.getElementById('cropFit');
  var cropper = null;
  var objectUrl = null;
  var targetCell = null;
  var saving = false;
  var loadToken = 0;
  var rotation = 0;
  var sources = {};
  var lastFit = 'cover';
  var bgMode = 'blur';

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function idle() {
    saving = false;
    saveButton.disabled = false;
    cancelButton.disabled = false;
    saveButton.textContent = 'Usar imagen';
    modal.classList.remove('busy');
  }

  function cleanup() {
    loadToken++;
    image.onload = null;
    image.onerror = null;
    if (cropper) { cropper.destroy(); cropper = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    image.removeAttribute('src');
    sources = {};
    rotation = 0;
    lastFit = 'cover';
    fillBox.hidden = true;
    modal.style.removeProperty('--fill');
    idle();
  }

  // ---------- Background fill (the area of the 16:9 frame the picture does not cover) ----------

  /** The picture with the chosen rotation, capped in size; used for the blurred backdrop. */
  function rotatedSource() {
    if (sources[rotation]) return sources[rotation];
    var nw = image.naturalWidth;
    var nh = image.naturalHeight;
    var scale = Math.min(1, SOURCE_MAX / Math.max(nw, nh));
    var w = Math.max(1, Math.round(nw * scale));
    var h = Math.max(1, Math.round(nh * scale));
    var odd = rotation % 180 !== 0;
    var canvas = document.createElement('canvas');
    canvas.width = odd ? h : w;
    canvas.height = odd ? w : h;
    var ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    sources[rotation] = canvas;
    return canvas;
  }

  /** The same picture scaled to COVER the frame, blurred and slightly darkened. */
  function drawBackdrop(ctx, width, height) {
    var src = rotatedSource();
    var blur = BLUR_PX * width / OUT.width;
    var margin = blur * 2.5; // draw past the edges so the blur does not fade into transparency there
    var scale = Math.max((width + margin * 2) / src.width, (height + margin * 2) / src.height);
    var dw = src.width * scale;
    var dh = src.height * scale;
    var dx = (width - dw) / 2;
    var dy = (height - dh) / 2;
    if ('filter' in ctx) {
      ctx.filter = 'blur(' + blur + 'px)';
      ctx.drawImage(src, dx, dy, dw, dh);
      ctx.filter = 'none';
    } else {
      // No canvas filter (older Safari): shrink a lot, then stretch back smoothly.
      var tiny = document.createElement('canvas');
      tiny.width = 48;
      tiny.height = Math.round(48 * height / width);
      var tctx = tiny.getContext('2d');
      tctx.drawImage(src, (dx / width) * tiny.width, (dy / height) * tiny.height, (dw / width) * tiny.width, (dh / height) * tiny.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, width, height);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, width, height);
  }

  /** Shows the chosen fill behind the crop frame and in the three previews. */
  function applyFill() {
    modal.setAttribute('data-bg', bgMode);
    if (bgMode !== 'blur' || !image.naturalWidth) {
      modal.style.removeProperty('--fill');
      return;
    }
    var canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    drawBackdrop(canvas.getContext('2d'), canvas.width, canvas.height);
    modal.style.setProperty('--fill', 'url("' + canvas.toDataURL('image/jpeg', 0.7) + '")');
  }

  /** The fill layer follows the crop frame. */
  function placeFill() {
    if (!cropper) return;
    var box = cropper.getCropBoxData();
    fillBox.style.left = box.left + 'px';
    fillBox.style.top = box.top + 'px';
    fillBox.style.width = box.width + 'px';
    fillBox.style.height = box.height + 'px';
    fillBox.hidden = false;
  }

  modal.querySelectorAll('input[name="cropBg"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (!radio.checked) return;
      bgMode = radio.value;
      applyFill();
    });
  });

  // ---------- Zoom, fit, rotate ----------

  /** Zoom ratios (canvas width / natural width): from half of "whole image fits" up to a few times "covers". */
  function limits() {
    var box = cropper.getCropBoxData();
    var canvas = cropper.getCanvasData();
    var contain = Math.min(box.width / canvas.naturalWidth, box.height / canvas.naturalHeight);
    var cover = Math.max(box.width / canvas.naturalWidth, box.height / canvas.naturalHeight);
    return { contain: contain, cover: cover, min: contain * 0.5, max: Math.max(cover * 5, contain * 2) };
  }

  function sliderToRatio(value) {
    var l = limits();
    return l.min * Math.pow(l.max / l.min, value / 100);
  }

  function syncSlider(ratio) {
    var l = limits();
    var value = 100 * Math.log(ratio / l.min) / Math.log(l.max / l.min);
    zoom.value = Math.max(0, Math.min(100, value));
  }

  /** 'contain': the whole picture inside the frame. 'cover': the frame filled. Either way, centred. */
  function fit(kind) {
    if (!cropper) return;
    lastFit = kind;
    var l = limits();
    var box = cropper.getCropBoxData();
    cropper.zoomTo(kind === 'contain' ? l.contain : l.cover);
    var canvas = cropper.getCanvasData();
    cropper.setCanvasData({
      left: box.left + (box.width - canvas.width) / 2,
      top: box.top + (box.height - canvas.height) / 2,
    });
    syncSlider(kind === 'contain' ? l.contain : l.cover);
  }

  /** The frame is the largest 16:9 area of the stage, fixed; the picture moves and scales inside it. */
  function sizeFrame() {
    var c = cropper.getContainerData();
    var width = Math.min(c.width - 16, (c.height - 16) * 16 / 9);
    var height = width * 9 / 16;
    cropper.setCropBoxData({ left: (c.width - width) / 2, top: (c.height - height) / 2, width: width, height: height });
    placeFill();
  }

  function startCropper() {
    if (typeof window.Cropper !== 'function') {
      showError('No se pudo cargar el recortador. Recarga la página e inténtalo de nuevo.');
      editor.hidden = true;
      saveButton.disabled = true;
      return;
    }
    cropper = new window.Cropper(image, {
      aspectRatio: 16 / 9,
      viewMode: 0, // the picture may be smaller than the frame
      dragMode: 'move',
      autoCropArea: 1,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      modal: false, // the area outside the frame is dimmed by CSS, so the fill stays visible inside it
      background: false,
      guides: false,
      center: false,
      highlight: false,
      responsive: true,
      preview: modal.querySelectorAll('.im-preview'),
      ready: function () {
        sizeFrame();
        fit('cover');
        applyFill();
      },
      zoom: function (event) {
        var l = limits();
        var ratio = event.detail.ratio;
        if (ratio < l.min - 1e-6 || ratio > l.max + 1e-6) {
          event.preventDefault();
          return;
        }
        syncSlider(ratio);
      },
      cropmove: function () { lastFit = null; },
    });
  }

  function open(file, cell, label) {
    cleanup();
    showError('');
    targetCell = cell;
    teamLabel.textContent = label;
    editor.hidden = false;
    objectUrl = URL.createObjectURL(file);
    // Only the latest file may start the cropper: a slower earlier load is ignored (and its handlers replaced).
    var token = ++loadToken;
    image.onload = function () { if (token === loadToken) startCropper(); };
    // A file that only has an image extension: the browser cannot decode it, so there is nothing to crop.
    image.onerror = function () {
      if (token !== loadToken) return;
      editor.hidden = true;
      saveButton.disabled = true;
      showError(WRONG);
    };
    image.src = objectUrl;
    modal.showModal();
  }

  function openError(message, label) {
    cleanup();
    teamLabel.textContent = label;
    editor.hidden = true;
    saveButton.disabled = true;
    showError(message);
    modal.showModal();
  }

  document.querySelectorAll('[data-image-pick]').forEach(function (button) {
    var input = button.parentElement.querySelector('[data-image-file]');
    button.addEventListener('click', function () {
      if (window.teamRows.busy) return;
      input.click();
    });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var type = file.type;
      var size = file.size;
      input.value = '';
      // The dialog names the team as it is typed in the row right now, not as it was last saved.
      var cell = button.closest('[data-emblem-cell]');
      var label = window.teamRows.nameOf(cell);
      if (TYPES.indexOf(type) === -1 || size > MAX_BYTES) return openError(WRONG, label);
      open(file, cell, label);
    });
  });

  zoom.addEventListener('input', function () {
    if (!cropper) return;
    lastFit = null;
    cropper.zoomTo(sliderToRatio(Number(zoom.value)));
  });
  fitButton.addEventListener('click', function () { fit('contain'); });
  rotateButton.addEventListener('click', function () {
    if (!cropper) return;
    rotation = (rotation + 90) % 360;
    cropper.rotate(90);
    fit(lastFit || 'cover');
    applyFill();
  });
  window.addEventListener('resize', function () {
    if (cropper) setTimeout(placeFill, 80);
  });

  cancelButton.addEventListener('click', function () {
    if (!saving) modal.close();
  });
  modal.addEventListener('cancel', function (event) { if (saving) event.preventDefault(); });
  modal.addEventListener('close', cleanup);

  /** Share of the 16:9 frame that the picture covers (0 when it was dragged completely outside). */
  function overlapShare() {
    var picture = cropper.getCanvasData();
    var frame = cropper.getCropBoxData();
    var width = Math.min(picture.left + picture.width, frame.left + frame.width) - Math.max(picture.left, frame.left);
    var height = Math.min(picture.top + picture.height, frame.top + frame.height) - Math.max(picture.top, frame.top);
    if (width <= 0 || height <= 0) return 0;
    return (width * height) / (frame.width * frame.height);
  }

  /** 1024x576: the fill underneath, the framed picture on top. Null when nothing of the picture is inside the frame. */
  function renderOutput() {
    var crop = cropper.getCroppedCanvas({
      width: OUT.width,
      height: OUT.height,
      fillColor: bgMode === 'dark' ? DARK : 'transparent',
      imageSmoothingQuality: 'high',
    });
    if (!crop) return null;
    if (bgMode !== 'blur') return crop;
    var out = document.createElement('canvas');
    out.width = OUT.width;
    out.height = OUT.height;
    var ctx = out.getContext('2d');
    drawBackdrop(ctx, OUT.width, OUT.height);
    ctx.drawImage(crop, 0, 0);
    return out;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (webp) {
        if (webp && webp.type === 'image/webp') return resolve(webp);
        canvas.toBlob(function (png) { resolve(png); }, 'image/png');
      }, 'image/webp', 0.92);
    });
  }

  saveButton.addEventListener('click', function () {
    if (!cropper || saving) return;
    saving = true;
    showError('');
    saveButton.disabled = true;
    cancelButton.disabled = true;
    saveButton.textContent = 'Procesando…';
    modal.classList.add('busy');
    var failed = function (message) {
      idle();
      showError(message);
    };
    if (overlapShare() < MIN_OVERLAP) return failed('Mueve la imagen dentro del recuadro antes de guardar.');
    var canvas = renderOutput();
    if (!canvas) return failed('La imagen quedó fuera del recuadro. Acércala o pulsa «Ajustar completa».');
    toBlob(canvas).then(function (blob) {
      if (!blob) return failed('No se pudo preparar la imagen.');
      if (blob.size > MAX_BYTES) return failed(WRONG);
      // Staged in the row: nothing is uploaded until that row's Guardar.
      window.teamRows.stageImage(targetCell, blob);
      idle();
      modal.close();
    }).catch(function () {
      failed('No se pudo preparar la imagen. Inténtalo de nuevo.');
    });
  });
})();

// Emblem menu ("Cambiar"): a popover menu, removal and hero-over-image confirmations.
(function () {
  var menus = Array.prototype.slice.call(document.querySelectorAll('[data-emblem-menu]'));
  if (!menus.length) return;

  function closeMenus(except) {
    menus.forEach(function (menu) { if (menu !== except) menu.open = false; });
  }
  window.closeEmblemMenus = closeMenus;

  // The table sits in a scrolling card, so the popover is positioned against the viewport.
  function place(menu) {
    var pop = menu.querySelector('.emblem-pop');
    var anchor = menu.querySelector('summary').getBoundingClientRect();
    pop.style.top = '0px';
    pop.style.left = '0px';
    var box = pop.getBoundingClientRect();
    var left = Math.max(8, Math.min(anchor.left, document.documentElement.clientWidth - box.width - 8));
    var top = anchor.bottom + 4;
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, anchor.top - box.height - 4);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  menus.forEach(function (menu) {
    menu.addEventListener('toggle', function () {
      if (!menu.open) return;
      closeMenus(menu);
      place(menu);
      var first = menu.querySelector('.emblem-pop button');
      if (first) first.focus();
    });
    // Choosing anything closes the menu.
    menu.querySelector('.emblem-pop').addEventListener('click', function (event) {
      if (event.target.closest('button')) menu.open = false;
    });
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-emblem-menu]')) closeMenus();
  });
  window.addEventListener('resize', function () { closeMenus(); });
  window.addEventListener('scroll', function () { closeMenus(); }, true);

  // Removal asks first, then is staged in the row like every other emblem change.
  var removeDialog = document.getElementById('removeImageDialog');
  if (removeDialog && typeof removeDialog.showModal === 'function') {
    var pendingCell = null;
    document.querySelectorAll('[data-remove-image]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (window.teamRows.busy) return;
        pendingCell = button.closest('[data-emblem-cell]');
        removeDialog.querySelector('[data-remove-team]').textContent = window.teamRows.nameOf(pendingCell);
        removeDialog.showModal();
      });
    });
    removeDialog.querySelector('[data-remove-confirm]').addEventListener('click', function () {
      if (pendingCell) window.teamRows.stageRemoval(pendingCell);
      pendingCell = null;
      removeDialog.close();
    });
  }

  document.querySelectorAll('dialog').forEach(function (dialog) {
    var cancel = dialog.querySelector('[data-dialog-cancel]');
    if (cancel) cancel.addEventListener('click', function () { dialog.close(); });
    if (dialog.id === 'removeImageDialog' || dialog.id === 'replaceImageDialog') {
      dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    }
  });
})();

// Emblem viewer: a lightbox with the thumbnail's picture at real size.
(function () {
  var dialog = document.getElementById('emblemViewer');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var picture = document.getElementById('emblemViewerImage');
  var caption = document.getElementById('emblemViewerCaption');
  var opener = null;

  document.addEventListener('click', function (event) {
    var thumb = event.target.closest('[data-emblem-view]');
    if (!thumb || thumb.disabled || !thumb.getAttribute('data-full')) return;
    if (window.teamRows && window.teamRows.busy) return;
    opener = thumb;
    var fallback = thumb.getAttribute('data-fallback');
    picture.onerror = fallback && picture.src !== fallback ? function () { picture.onerror = null; picture.src = fallback; } : null;
    picture.src = thumb.getAttribute('data-full');
    var viewerCell = thumb.closest('[data-emblem-cell]');
    var name = viewerCell ? window.teamRows.nameOf(viewerCell) : thumb.getAttribute('data-name') || '';
    var source = thumb.getAttribute('data-source') || '';
    picture.alt = name;
    caption.textContent = source ? name + ' · ' + source : name;
    dialog.showModal();
  });

  dialog.querySelector('[data-viewer-close]').addEventListener('click', function () { dialog.close(); });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', function () {
    picture.onerror = null;
    picture.removeAttribute('src');
    if (opener) opener.focus();
    opener = null;
  });
})();

// Result forms: optional import of a game from a Dota match id. The lookups run on the server (never from the browser).
(function () {
  var forms = document.querySelectorAll('[data-game-form]');
  if (!forms.length) return;
  var base = location.pathname.replace(/\/(resultados|playoffs)(\/.*)?$/, '');

  function post(path, data) {
    return fetch(base + path, {
      method: 'POST',
      body: new URLSearchParams(data),
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    });
  }

  forms.forEach(function (form) {
    var idInput = form.querySelector('[name="dota_match_id"]');
    var statusEl = form.querySelector('[data-dota-status]');
    var radiantBox = form.querySelector('[data-dota-radiant]');
    var radiantSelect = form.querySelector('[name="dota_radiant"]');
    var search = form.querySelector('[data-dota-search]');
    var fill = form.querySelector('[data-dota-fill]');
    if (!idInput || !search || !fill) return;
    var original = idInput.value;

    function say(text, kind) {
      statusEl.textContent = text || '';
      statusEl.className = 'dota-status ' + (kind || 'muted');
    }

    function busy(button, on, label) {
      button.disabled = on;
      button.dataset.label = button.dataset.label || button.textContent;
      button.textContent = on ? label : button.dataset.label;
    }

    function doSearch() {
      var id = idInput.value.trim();
      if (!id) { say('Escribe el Match ID de Dota.', 'error'); return; }
      busy(search, true, 'Buscando…');
      say('Consultando OpenDota…', 'muted');
      post('/dota/buscar', { dota_match_id: id }).then(function (res) {
        busy(search, false);
        if (res.ok && res.body.ok) {
          say('✓ ' + res.body.summary, 'ok');
          radiantBox.hidden = false;
        } else {
          say(res.body.error || 'No se pudo consultar la partida.', 'error');
          radiantBox.hidden = true;
        }
      }).catch(function () {
        busy(search, false);
        say('No se pudo consultar la partida. Revisa tu conexión.', 'error');
      });
    }

    function setValue(name, value) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input) input.value = String(value);
    }

    function doFill() {
      if (!radiantSelect.value) { say('Elige qué equipo jugó de Radiant.', 'error'); return; }
      busy(fill, true, 'Cargando…');
      post('/dota/autocompletar', {
        dota_match_id: idInput.value.trim(),
        radiant: radiantSelect.value,
        team1_id: form.getAttribute('data-team1'),
        team2_id: form.getAttribute('data-team2'),
      }).then(function (res) {
        busy(fill, false);
        if (!(res.ok && res.body.ok)) { say(res.body.error || 'No se pudo autocompletar.', 'error'); return; }
        var winner = form.querySelector('input[name="winner"][value="' + res.body.winnerId + '"]');
        if (winner) winner.checked = true;
        setValue('t1_kills', res.body.team1Kills);
        setValue('t1_deaths', res.body.team1Deaths);
        setValue('t2_kills', res.body.team2Kills);
        setValue('t2_deaths', res.body.team2Deaths);
        say('✓ ' + res.body.summary + ' · Datos cargados: revisa y guarda.', 'ok');
      }).catch(function () {
        busy(fill, false);
        say('No se pudo autocompletar. Revisa tu conexión.', 'error');
      });
    }

    search.addEventListener('click', doSearch);
    fill.addEventListener('click', doFill);
    // Enter in the Match ID searches instead of saving the game.
    idInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); doSearch(); }
    });
    // A different id is a different match: look it up again before using it.
    idInput.addEventListener('input', function () {
      if (idInput.value.trim() !== original) {
        radiantBox.hidden = true;
        say('', 'muted');
      }
    });
  });
})();
