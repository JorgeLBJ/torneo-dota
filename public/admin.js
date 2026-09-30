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

  var replaceDialog = document.getElementById('replaceImageDialog');
  var replacing = null;

  function apply(target, hero) {
    target.input.value = hero.slug;
    var thumb = target.cell.querySelector('[data-emblem-thumb]');
    thumb.textContent = '';
    var img = document.createElement('img');
    img.alt = '';
    img.src = '/assets/heroes/' + hero.slug + '.png';
    thumb.appendChild(img);
    var label = target.cell.querySelector('[data-emblem-label]');
    label.textContent = hero.name;
    label.title = hero.name;
  }

  function choose(hero) {
    var target = current;
    modal.close();
    // A custom image outranks the hero everywhere, so picking a hero means giving the image up.
    if (target.cell.getAttribute('data-has-image') === '1' && replaceDialog && typeof replaceDialog.showModal === 'function') {
      replacing = { target: target, hero: hero };
      replaceDialog.showModal();
      return;
    }
    apply(target, hero);
  }

  if (replaceDialog) {
    var confirm = replaceDialog.querySelector('[data-replace-confirm]');
    if (confirm) confirm.addEventListener('click', function () {
      if (replacing) {
        var cell = replacing.target.cell;
        apply(replacing.target, replacing.hero);
        cell.querySelector('[data-clear-image]').value = '1';
        cell.setAttribute('data-has-image', '0');
        var remove = cell.querySelector('form[data-remove-image]');
        if (remove) remove.hidden = true;
      }
      replacing = null;
      replaceDialog.close();
    });
  }

  document.querySelectorAll('[data-hero-pick]').forEach(function (button) {
    button.addEventListener('click', function () {
      var cell = button.closest('[data-emblem-cell]');
      current = { cell: cell, input: cell.querySelector('[data-hero-input]') };
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

// Custom team image: pick a file, crop it to 16:9 with Cropper.js, upload the result.
(function () {
  var modal = document.getElementById('imageModal');
  if (!modal || typeof modal.showModal !== 'function') return;

  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var WRONG = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';
  var OUT = { width: 1024, height: 576 };

  var image = document.getElementById('cropImage');
  var editor = document.getElementById('imageEditor');
  var errorBox = document.getElementById('imageError');
  var teamLabel = document.getElementById('imageTeam');
  var zoom = document.getElementById('cropZoom');
  var saveButton = document.getElementById('cropSave');
  var cancelButton = document.getElementById('cropCancel');
  var rotateButton = document.getElementById('cropRotate');
  var cropper = null;
  var objectUrl = null;
  var uploadUrl = null;
  var baseRatio = 1;
  var saving = false;

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function idle() {
    saving = false;
    saveButton.disabled = false;
    cancelButton.disabled = false;
    saveButton.textContent = 'Guardar';
    modal.classList.remove('busy');
  }

  function cleanup() {
    if (cropper) { cropper.destroy(); cropper = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    image.removeAttribute('src');
    idle();
  }

  function setZoomFromSlider() {
    if (!cropper) return;
    cropper.zoomTo(baseRatio * (1 + (Number(zoom.value) / 100) * 4));
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
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      background: false,
      guides: false,
      center: false,
      highlight: false,
      responsive: true,
      preview: modal.querySelectorAll('.im-preview'),
      ready: function () {
        var data = cropper.getImageData();
        baseRatio = data.width / data.naturalWidth;
        zoom.value = 0;
      },
      zoom: function (event) {
        if (!baseRatio) return;
        var value = ((event.detail.ratio / baseRatio) - 1) / 4 * 100;
        zoom.value = Math.max(0, Math.min(100, value));
      },
    });
  }

  function open(file, url, label) {
    cleanup();
    showError('');
    uploadUrl = url;
    teamLabel.textContent = label;
    editor.hidden = false;
    objectUrl = URL.createObjectURL(file);
    image.addEventListener('load', startCropper, { once: true });
    // A file that only has an image extension: the browser cannot decode it, so there is nothing to crop.
    image.addEventListener('error', function () {
      if (!objectUrl) return;
      editor.hidden = true;
      saveButton.disabled = true;
      showError(WRONG);
    }, { once: true });
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
    var label = button.getAttribute('data-team-label') || '';
    button.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var type = file.type;
      var size = file.size;
      input.value = '';
      if (TYPES.indexOf(type) === -1 || size > MAX_BYTES) return openError(WRONG, label);
      open(file, button.getAttribute('data-upload-url'), label);
    });
  });

  zoom.addEventListener('input', setZoomFromSlider);
  rotateButton.addEventListener('click', function () {
    if (cropper) cropper.rotate(90);
  });

  cancelButton.addEventListener('click', function () {
    if (!saving) modal.close();
  });
  modal.addEventListener('cancel', function (event) { if (saving) event.preventDefault(); });
  modal.addEventListener('close', cleanup);

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
    saveButton.textContent = 'Guardando…';
    modal.classList.add('busy');
    var failed = function (message) {
      idle();
      showError(message);
    };
    var canvas = cropper.getCroppedCanvas({ width: OUT.width, height: OUT.height, imageSmoothingQuality: 'high' });
    if (!canvas) return failed('No se pudo recortar la imagen.');
    toBlob(canvas).then(function (blob) {
      if (!blob) return failed('No se pudo preparar la imagen.');
      if (blob.size > MAX_BYTES) return failed(WRONG);
      var form = new FormData();
      form.append('image', blob, blob.type === 'image/webp' ? 'equipo.webp' : 'equipo.png');
      return fetch(uploadUrl, { method: 'POST', body: form, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (res.ok) { window.location.reload(); return; }
            failed(body.error || 'No se pudo guardar la imagen. Inténtalo de nuevo.');
          });
        });
    }).catch(function () {
      failed('No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.');
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
    var left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
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

  // Removal asks first; without JavaScript the form simply submits.
  var removeDialog = document.getElementById('removeImageDialog');
  if (removeDialog && typeof removeDialog.showModal === 'function') {
    var pending = null;
    document.querySelectorAll('form[data-remove-image]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        pending = form;
        removeDialog.querySelector('[data-remove-team]').textContent = form.getAttribute('data-team-label') || 'El equipo';
        removeDialog.showModal();
      });
    });
    removeDialog.querySelector('[data-remove-confirm]').addEventListener('click', function () {
      if (pending) HTMLFormElement.prototype.submit.call(pending);
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
