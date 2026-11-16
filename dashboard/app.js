// Token Launch Radar: the board page. Reads window.RADAR_DATA (written by main.ts as data.js beside
// this file), renders the ranked board, and wires the filters, the sorting and the detail view.
// No fetch, no framework, no network: the page works from its own folder.
//
// Deep links: #p=<slug> opens that protocol's detail on load, #cat=<category> applies the category
// filter on load; the two combine as #cat=Dexs&p=<slug>.

(function () {
  'use strict';
  var data = window.RADAR_DATA;
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var detailEl = document.getElementById('detail');
  if (!data || !rowsEl) {
    if (countEl) countEl.textContent = 'The radar data did not load: run the entry program first.';
    return;
  }
  var rows = data.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { q: '', cat: '', chain: '', watch: false, key: 'rank', dir: 1, slug: null };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtChange(v) {
    if (v === null || v === undefined) return '<span class="flat">no report</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'not recorded';
    if (days < 60) return days + ' days';
    if (days < 730) return Math.round(days / 30.4) + ' months';
    return (days / 365.25).toFixed(1) + ' years';
  }

  // The summary strip, straight from the model's own stats.
  var s = data.stats;
  var stats = [
    ['Protocols ranked', s.ranked],
    ['Watchlist covered', s.watchlist_ranked + ' of ' + s.watchlist_size],
    ['Tokenized, set aside', s.tokenized_excluded],
    ['TVL on the board', fmtUsd(s.board_tvl_usd)],
    ['Implied value, all rows', fmtUsd(s.board_implied_usd)],
    ['Snapshot date', s.as_of],
  ];
  document.getElementById('stats').innerHTML = stats
    .map(function (pair) { return '<div><dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd></div>'; })
    .join('');

  // Filter options, from the board itself, in the order a reader scans them.
  function fillSelect(id, values) {
    var el = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  fillSelect('cat', cats);
  fillSelect('chain', chains);

  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = state.key;
    var dir = state.dir;
    list.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
    return list;
  }

  function render() {
    var list = visible();
    countEl.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols';
    emptyEl.hidden = list.length > 0;
    rowsEl.innerHTML = list
      .map(function (r) {
        var chainText = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
        return (
          '<tr data-slug="' + esc(r.slug) + '">' +
          '<td class="num">' + r.rank + '</td>' +
          '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
          '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
          '<td class="chains">' + esc(chainText || 'not recorded') + '</td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num">' + fmtChange(r.change_7d) + '</td>' +
          '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td>' +
          '<td class="num">' + r.ratio.toFixed(2) + 'x</td>' +
          '<td>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge off">Below floor</span>') + '</td>' +
          '</tr>'
        );
      })
      .join('');
    document.querySelectorAll('#board th.sortable').forEach(function (th) {
      var arrow = th.getAttribute('data-key') === state.key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
      var label = th.getAttribute('data-label') || th.textContent.replace(/ [▲▼]$/, '');
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (arrow ? '<span class="arrow">' + arrow + '</span>' : '');
    });
  }

  function showDetail(r) {
    state.slug = r.slug;
    var facts = [
      ['Rank', '#' + r.rank + ' of ' + rows.length],
      ['Implied value', fmtUsd(r.implied_value_usd)],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['7d TVL change', r.change_7d === null ? 'no report' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'],
      ['Category', r.category || 'Uncategorised'],
      ['Chains', r.chains.join(', ') || 'not recorded'],
      ['Listed since', r.listed_at || 'not recorded'],
      ['Running with no token', fmtAge(r.age_days)],
    ];
    detailEl.innerHTML =
      '<div class="detail-in">' +
      '<div class="detail-head"><span class="rank">#' + r.rank + '</span><h2>' + esc(r.name) + '</h2>' +
      (r.watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge off">Below the $50M floor</span>') +
      '<button class="close" id="closeDetail" type="button">Close</button></div>' +
      '<dl class="detail-grid">' +
      facts.map(function (pair) { return '<div><dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd></div>'; }).join('') +
      '</dl>' +
      '<p class="breakdown">How the model prices it: TVL <strong>' + fmtUsd(r.tvl_usd) + '</strong> &times; category multiple ' +
      '<span class="factor">' + r.multiple.toFixed(2) + '</span> &times; momentum <span class="factor">' + r.momentum.toFixed(2) +
      '</span> &times; seasoning <span class="factor">' + r.seasoning.toFixed(2) + '</span> = implied value <strong>' +
      fmtUsd(r.implied_value_usd) + '</strong>, or ' + r.ratio.toFixed(2) + 'x its TVL.</p>' +
      '<h3 class="farm-title">Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') +
      '</ol></div>';
    detailEl.hidden = false;
    document.getElementById('closeDetail').addEventListener('click', function () {
      detailEl.hidden = true;
      state.slug = null;
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    });
    detailEl.scrollIntoView({ block: 'start' });
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    var r = bySlug[tr.getAttribute('data-slug')];
    if (!r) return;
    showDetail(r);
    if (window.history && history.replaceState) {
      history.replaceState(null, '', '#p=' + encodeURIComponent(r.slug));
    }
  });

  document.querySelectorAll('#board th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-key');
      if (state.key === key) {
        state.dir = -state.dir;
      } else {
        state.key = key;
        state.dir = key === 'name' || key === 'category' ? 1 : -1;
        if (key === 'rank') state.dir = 1;
      }
      render();
    });
  });

  document.getElementById('q').addEventListener('input', function (ev) { state.q = ev.target.value; render(); });
  document.getElementById('cat').addEventListener('change', function (ev) { state.cat = ev.target.value; render(); });
  document.getElementById('chain').addEventListener('change', function (ev) { state.chain = ev.target.value; render(); });
  document.getElementById('watch').addEventListener('change', function (ev) { state.watch = ev.target.checked; render(); });

  // Deep links, read once on load: #cat=<category> filters, #p=<slug> opens the detail.
  function applyHash() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    hash.split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 0) return;
      var key = pair.slice(0, at);
      var value = decodeURIComponent(pair.slice(at + 1));
      if (key === 'cat' && cats.indexOf(value) >= 0) {
        state.cat = value;
        document.getElementById('cat').value = value;
      }
      if (key === 'p' && bySlug[value]) {
        showDetail(bySlug[value]);
      }
    });
    render(); // the category link changes the filter state, so the board must be drawn again
  }

  render();
  applyHash();
})();
