// "Ver detalle de la partida": a modal with the players, heroes and stats of the Dota matches imported for a match.
// The data comes as JSON from the server (see /t/:slug/partido/:id/detalle); everything is built with textContent.
(function () {
  var dialog = document.getElementById('matchDetail');
  var content = document.getElementById('mdContent');
  if (!dialog || !content || typeof dialog.showModal !== 'function') return;

  var HEROES = '/assets/heroes/';
  var current = { url: null, game: null, data: null };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function heroImg(slug, cls) {
    var img = el('img', cls);
    img.alt = '';
    if (slug) img.src = HEROES + slug + '.png';
    else img.className = (cls ? cls + ' ' : '') + 'unknown';
    return img;
  }

  function mmss(total) {
    var m = Math.floor(total / 60);
    var s = Math.floor(total % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function teamOf(data, id) {
    return data.teams[0].id === id ? data.teams[0] : data.teams[1];
  }

  function emblem(team) {
    var box = el('div', 'emb');
    var e = team.emblem;
    if (e.kind === 'tile') {
      box.appendChild(el('span', 'emb-code', team.code));
    } else {
      var img = el('img');
      img.alt = team.name;
      img.src = e.src;
      if (e.kind === 'image') img.srcset = e.src + ' 1x, ' + e.src2x + ' 2x';
      box.appendChild(img);
    }
    return box;
  }

  function teamBlock(team, side, won, right) {
    var block = el('div', 'team' + (right ? ' b' : ''));
    block.appendChild(emblem(team));
    var text = el('div');
    if (side) text.appendChild(el('span', 'side ' + (side === 'radiant' ? 'r' : 'd'), side === 'radiant' ? 'Radiant' : 'Dire'));
    text.appendChild(el('strong', null, team.name));
    if (won) text.appendChild(el('span', 'wtag', 'Victoria'));
    block.appendChild(text);
    return block;
  }

  function playerRow(p) {
    var tr = el('tr');
    var who = el('td', 'l');
    var pl = el('div', 'pl');
    pl.appendChild(heroImg(p.heroSlug));
    var names = el('div');
    names.appendChild(p.nick ? el('strong', null, p.nick) : el('strong', 'anon', 'Anónimo'));
    names.appendChild(el('small', null, p.heroName));
    pl.appendChild(names);
    who.appendChild(pl);
    tr.appendChild(who);
    var kda = el('td', 'kda');
    kda.appendChild(el('b', null, p.kills));
    kda.appendChild(document.createTextNode(' / '));
    kda.appendChild(el('span', 'd', p.deaths));
    kda.appendChild(document.createTextNode(' / '));
    kda.appendChild(el('span', 'a', p.assists));
    tr.appendChild(kda);
    tr.appendChild(el('td', 'opt', p.level));
    tr.appendChild(el('td', 'gold', p.gpm));
    tr.appendChild(el('td', 'opt', p.xpm));
    tr.appendChild(el('td', 'opt', p.lastHits + ' / ' + p.denies));
    tr.appendChild(el('td', null, p.heroDamage.toLocaleString('es')));
    return tr;
  }

  function table(team, side, won, players) {
    var box = el('div', 'tb ' + (side === 'radiant' ? 'r' : 'd'));
    var head = el('div', 'tb-head');
    head.appendChild(el('b', null, team.name + ' · ' + (side === 'radiant' ? 'Radiant' : 'Dire')));
    head.appendChild(el('span', 'tag', won ? 'Victoria' : 'Derrota'));
    box.appendChild(head);
    var wrap = el('div', 'tb-scroll');
    var t = el('table');
    var thead = el('thead');
    var hr = el('tr');
    [['Jugador', 'l'], ['K / D / A', ''], ['Nivel', 'opt'], ['Oro/min', ''], ['Exp/min', 'opt'], ['Farm', 'opt'], ['Daño', '']].forEach(function (col) {
      hr.appendChild(el('th', col[1], col[0]));
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tbody = el('tbody');
    players.forEach(function (p) { tbody.appendChild(playerRow(p)); });
    t.appendChild(tbody);
    wrap.appendChild(t);
    box.appendChild(wrap);
    return box;
  }

  function gameBody(data, game) {
    var body = el('div', 'd-body');
    var dota = game.dota;
    if (!dota) {
      var winner = teamOf(data, game.winnerId);
      body.appendChild(el('p', 'd-empty', 'Sin datos de Dota para este juego.'));
      body.appendChild(el('p', 'd-manual', 'Ganó ' + winner.name + ' · ' + data.teams[0].name + ' ' + game.kills[0] + ' kills – ' + game.kills[1] + ' kills ' + data.teams[1].name));
      return body;
    }
    var radiantTeam = teamOf(data, game.radiantTeamId === null ? data.teams[0].id : game.radiantTeamId);
    var direTeam = radiantTeam.id === data.teams[0].id ? data.teams[1] : data.teams[0];
    body.appendChild(table(radiantTeam, 'radiant', dota.radiantWin, dota.players.filter(function (p) { return p.side === 'radiant'; })));
    body.appendChild(table(direTeam, 'dire', !dota.radiantWin, dota.players.filter(function (p) { return p.side === 'dire'; })));
    if (dota.bans.length) {
      var bans = el('div');
      bans.appendChild(el('div', 'tag', 'Baneados'));
      var row = el('div', 'bans');
      dota.bans.forEach(function (slug) { row.appendChild(heroImg(slug)); });
      bans.appendChild(row);
      body.appendChild(bans);
    }
    var foot = el('div', 'd-foot');
    var id = el('span');
    id.appendChild(document.createTextNode('Match ID '));
    id.appendChild(el('b', null, dota.matchId));
    id.appendChild(document.createTextNode(' · datos de OpenDota'));
    foot.appendChild(id);
    var link = el('a', null, 'Ver en OpenDota ↗');
    link.href = 'https://www.opendota.com/matches/' + dota.matchId;
    link.target = '_blank';
    link.rel = 'noopener';
    foot.appendChild(link);
    body.appendChild(foot);
    return body;
  }

  function header(data, game) {
    var head = el('div', 'd-head');
    var line = el('div', 'scoreline');
    var dota = game.dota;
    if (dota) {
      var radiantTeam = teamOf(data, game.radiantTeamId === null ? data.teams[0].id : game.radiantTeamId);
      var direTeam = radiantTeam.id === data.teams[0].id ? data.teams[1] : data.teams[0];
      line.appendChild(teamBlock(radiantTeam, 'radiant', dota.radiantWin, false));
      var score = el('div', 'bigscore');
      var n = el('div', 'n');
      n.appendChild(el('span', dota.radiantWin ? 'w' : 'l', dota.radiantScore));
      n.appendChild(el('i', null, '–'));
      n.appendChild(el('span', dota.radiantWin ? 'l' : 'w', dota.direScore));
      score.appendChild(n);
      var facts = el('div', 'facts');
      var dur = el('span', null, 'Duración ');
      dur.appendChild(el('b', null, mmss(dota.durationSec)));
      facts.appendChild(dur);
      if (dota.firstBloodSec !== null) {
        var fb = el('span', null, '1.ª sangre ');
        fb.appendChild(el('b', null, mmss(dota.firstBloodSec)));
        facts.appendChild(fb);
      }
      score.appendChild(facts);
      line.appendChild(score);
      line.appendChild(teamBlock(direTeam, 'dire', !dota.radiantWin, true));
    } else {
      line.appendChild(teamBlock(data.teams[0], null, game.winnerId === data.teams[0].id, false));
      var plain = el('div', 'bigscore');
      plain.appendChild(el('div', 'facts', 'Juego ' + game.number));
      line.appendChild(plain);
      line.appendChild(teamBlock(data.teams[1], null, game.winnerId === data.teams[1].id, true));
    }
    head.appendChild(line);
    return head;
  }

  function render(data) {
    current.data = data;
    content.textContent = '';
    var selected = data.games.filter(function (g) { return g.number === current.game; })[0];
    if (!selected) selected = data.games.filter(function (g) { return g.dota; })[0] || data.games[0];
    current.game = selected.number;

    var top = el('div', 'd-top');
    var title = el('h2', 'd-title', data.title);
    title.id = 'mdTitle';
    top.appendChild(title);
    if (data.series) {
      var winner = data.series.winnerId === null ? null : teamOf(data, data.series.winnerId);
      top.appendChild(el('span', 'tag', 'Serie ' + data.series.wins[0] + ' – ' + data.series.wins[1] + (winner ? ' · gana ' + winner.name : ' · en juego')));
    }
    content.appendChild(top);

    if (data.games.length > 1 || data.series) {
      var tabs = el('div', 'd-tabs');
      tabs.setAttribute('role', 'tablist');
      data.games.forEach(function (g) {
        var tab = el('button', 'd-tab', 'Juego ' + g.number);
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', g.number === selected.number ? 'true' : 'false');
        tab.addEventListener('click', function () {
          current.game = g.number;
          render(data);
        });
        tabs.appendChild(tab);
      });
      content.appendChild(tabs);
    }
    content.appendChild(header(data, selected));
    content.appendChild(gameBody(data, selected));
  }

  function load(url, keepOpen) {
    return fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('missing');
        return res.json();
      })
      .then(function (data) {
        render(data);
        if (!keepOpen && !dialog.open) dialog.showModal();
      })
      .catch(function () {
        if (keepOpen) return;
        content.textContent = '';
        content.appendChild(el('p', 'd-empty', 'No se pudo cargar el detalle de la partida. Inténtalo de nuevo.'));
        if (!dialog.open) dialog.showModal();
      });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-detail-url]');
    if (!button) return;
    current.url = button.getAttribute('data-detail-url');
    current.game = null;
    load(current.url, false);
  });

  dialog.querySelector('[data-detail-close]').addEventListener('click', function () { dialog.close(); });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', function () {
    var url = current.url;
    current.url = null;
    var opener = url && document.querySelector('[data-detail-url="' + url + '"]');
    if (opener) opener.focus();
  });

  // The live page re-renders its cards; an open detail follows the new results too.
  window.MatchDetail = {
    refresh: function () {
      if (dialog.open && current.url) load(current.url, true);
    },
  };
})();
