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
    var replaceConfirm = replaceDialog.querySelector('[data-replace-confirm]');
    if (replaceConfirm) replaceConfirm.addEventListener('click', function () {
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
  var uploadUrl = null;
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
    saveButton.textContent = 'Guardar';
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

  function open(file, url, label) {
    cleanup();
    showError('');
    uploadUrl = url;
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
    saveButton.textContent = 'Guardando…';
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
