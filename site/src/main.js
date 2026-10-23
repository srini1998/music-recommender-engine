import './style.css';
import { prepare, recommend, listMetrics, DEFAULTS } from './engine.js';

const $ = (id) => document.getElementById(id);
const fmt = (x, d = 3) => Number(x).toFixed(d);
const pct = (x) => `${Math.round(x * 100)}%`;
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CRATES = [
  { name: 'Trip-hop night', seeds: ['portishead', 'massive attack', 'björk'] },
  { name: 'Shoegaze haze', seeds: ['my bloody valentine', 'slowdive', 'cocteau twins'] },
  { name: 'Rap canon', seeds: ['kendrick lamar', 'mf doom', 'a tribe called quest'] },
  { name: 'K-pop', seeds: ['newjeans', 'twice', 'stray kids'] },
  { name: 'Emo revival', seeds: ['my chemical romance', 'paramore', 'fall out boy'] },
  { name: 'Spiral jazz', seeds: ['miles davis', 'john coltrane'] },
  { name: 'Quiet folk', seeds: ['nick drake', 'elliott smith', 'joni mitchell'] },
];

const state = { seeds: [], alpha: DEFAULTS.alpha, lambda: DEFAULTS.lambda, beta: DEFAULTS.beta };
let m, metrics, searchIndex;

async function init() {
  const [catalog, met] = await Promise.all([
    fetch('/data/catalog.json').then((r) => r.json()),
    fetch('/data/metrics.json').then((r) => r.json()),
  ]);
  m = prepare(catalog);
  metrics = met;
  searchIndex = catalog.items.map((it, i) => ({ i, key: fold(it.n) }));
  const meta = catalog.meta;
  $('facts').textContent = `${meta.listensRead.toLocaleString('en-US')} listens read · ${meta.catalogArtists.toLocaleString('en-US')} artists · ${meta.trainUsers.toLocaleString('en-US')} listeners train the co-listening graph · ${meta.testUsers.toLocaleString('en-US')} held out for scoring`;
  $('prov').textContent = `${meta.source}. ${meta.metadata} Similarity: ${meta.simFormula}.`;
  $('protocol').textContent = metrics.protocol;

  for (const key of ['alpha', 'lambda', 'beta']) {
    const el = $(key);
    el.value = state[key];
    el.addEventListener('input', () => { state[key] = Number(el.value); render(); });
  }
  for (const c of CRATES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'crate';
    b.textContent = c.name;
    b.addEventListener('click', () => { state.seeds = c.seeds.map((n) => m.byName.get(n)).filter((i) => i !== undefined); render(); });
    $('crates').append(b);
  }
  $('search').addEventListener('input', renderSearch);
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('results').querySelector('button'); if (first) { e.preventDefault(); first.click(); } }
    if (e.key === 'ArrowDown') { const first = $('results').querySelector('button'); if (first) { e.preventDefault(); first.focus(); } }
  });
  $('results').addEventListener('keydown', (e) => {
    const btns = [...$('results').querySelectorAll('button')];
    const at = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && at < btns.length - 1) { e.preventDefault(); btns[at + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (at > 0 ? btns[at - 1] : $('search')).focus(); }
  });
  state.seeds = CRATES[0].seeds.map((n) => m.byName.get(n));
  renderSignals();
  render();
}

function addSeed(i) {
  if (!state.seeds.includes(i) && state.seeds.length < 12) state.seeds.push(i);
  $('search').value = '';
  renderSearch();
  render();
  $('search').focus();
}

function renderSearch() {
  const q = fold($('search').value.trim());
  const ul = $('results');
  ul.replaceChildren();
  if (!q) return;
  const hits = searchIndex.filter((x) => x.key.includes(q) && !state.seeds.includes(x.i))
    .sort((a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || m.catalog.items[b.i].r - m.catalog.items[a.i].r).slice(0, 6);
  if (!hits.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'Not in this crate — only the 1,500 most-listened artists with a MusicBrainz id are included.'; ul.append(li); return; }
  for (const h of hits) {
    const it = m.catalog.items[h.i];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${esc(it.n)}</span><small>${esc(genres(h.i, 2))}</small>`;
    b.addEventListener('click', () => addSeed(h.i));
    li.append(b);
    ul.append(li);
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const genres = (i, n = 3) => m.catalog.items[i].g.slice(0, n).map(([t]) => m.catalog.tags[t]).join(' · ');
const origin = (it) => [it.a, it.y].filter(Boolean).join(', ');

function render() {
  $('alpha-out').textContent = `${pct(state.alpha)} co-listening`;
  $('lambda-out').textContent = fmt(state.lambda, 2);
  $('beta-out').textContent = fmt(state.beta, 2);
  for (const key of ['alpha', 'lambda', 'beta']) $(key).style.setProperty('--fill', `${(state[key] / Number($(key).max)) * 100}%`);

  const seedsOl = $('seeds');
  seedsOl.replaceChildren();
  state.seeds.forEach((i, n) => {
    const it = m.catalog.items[i];
    const li = document.createElement('li');
    li.innerHTML = `<span class="no">A${n + 1}</span><span class="t"><b>${esc(it.n)}</b><small>${esc(genres(i))}</small></span>`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'remove';
    x.setAttribute('aria-label', `Remove ${it.n}`);
    x.textContent = '×';
    x.addEventListener('click', () => { state.seeds = state.seeds.filter((s) => s !== i); render(); });
    li.append(x);
    seedsOl.append(li);
  });
  $('seed-hint').textContent = state.seeds.length >= 12 ? 'Twelve seeds max.' : `${state.seeds.length} seed${state.seeds.length === 1 ? '' : 's'}. Add up to 12.`;

  const recs = recommend(m, state.seeds, { alpha: state.alpha, lambda: state.lambda, beta: state.beta, k: 10 });
  const ol = $('recs');
  ol.replaceChildren();
  $('recs-empty').hidden = recs.length > 0;
  recs.forEach((r, n) => {
    const it = m.catalog.items[r.i];
    const why = [];
    if (r.because && r.cf > 0.05) why.push(`${r.because.co.toLocaleString('en-US')} listeners also played ${esc(m.catalog.items[r.because.seed].n)}`);
    if (r.shared.length) why.push(`shares ${r.shared.map(esc).join(', ')}`);
    const total = r.cf * state.alpha + r.content * (1 - state.alpha) || 1;
    const cfShare = (r.cf * state.alpha) / total;
    const li = document.createElement('li');
    li.style.setProperty('--i', n);
    li.innerHTML = `<span class="no">B${n + 1}</span>
      <span class="t"><a href="https://musicbrainz.org/artist/${it.mbid}" target="_blank" rel="noopener"><b>${esc(it.n)}</b></a>
      <small class="origin">${esc(origin(it) || 'origin unknown')} · ${it.r.toLocaleString('en-US')} listeners</small>
      <small class="why">${why.join(' · ') || 'genre profile match'}</small></span>
      <span class="mix" title="Share of this pick's relevance from co-listening (orange) vs genre match (olive)"><span style="--cf:${(cfShare * 100).toFixed(0)}%"></span><em>${pct(cfShare)} co-listen</em></span>`;
    ol.append(li);
  });
  if (recs.length) {
    const lm = listMetrics(m, recs);
    const meanReach = recs.reduce((s, r) => s + m.catalog.items[r.i].r, 0) / recs.length;
    $('list-stats').innerHTML = `<span><b>${fmt(lm.ild, 2)}</b> list diversity</span><span><b>${fmt(lm.novelty, 1)}</b> bits novelty</span><span><b>${Math.round(meanReach)}</b> avg listeners</span>`;
  } else $('list-stats').replaceChildren();
  renderOffline();
}

function nearest(axis, v) { return metrics.axes[axis].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)); }
const cell = (a, l, b) => metrics.grid.find((g) => g.alpha === a && g.lambda === l && g.beta === b);

function renderOffline() {
  const a = nearest('alpha', state.alpha), l = nearest('lambda', state.lambda), b = nearest('beta', state.beta);
  const cur = cell(a, l, b);
  const base = metrics.baselines.popularity;
  const rows = [
    ['Recall@10', cur.recall, base.recall, 3, 'share of hidden artists recovered'],
    ['Coverage', cur.coverage, base.coverage, 2, 'of catalog ever recommended'],
    ['List diversity', cur.ild, base.ild, 2, '1 − mean genre similarity'],
    ['Novelty', cur.novelty, base.novelty, 2, 'bits; higher = less mainstream'],
  ];
  $('scorecard').innerHTML = `<p class="mini">Nearest measured setting: blend ${a}, diversity ${l}, novelty ${b} · ${metrics.cases.toLocaleString('en-US')} held-out listeners</p>` + rows.map(([k, v, bv, d, note]) =>
    `<div class="score"><span class="k">${k}</span><span class="v">${fmt(v, d)}</span><span class="vs">most-popular baseline ${fmt(bv, d)}</span><span class="note">${note}</span></div>`).join('');

  // Trade-off chart: recall vs list diversity, one line per blend, points = diversity steps.
  const W = 600, H = 340, P = { l: 52, r: 96, t: 18, b: 44 };
  const pts = metrics.grid.filter((g) => g.beta === b);
  const xs = pts.map((g) => g.ild).concat(base.ild), ys = pts.map((g) => g.recall).concat(base.recall);
  const x0 = Math.min(...xs) - 0.02, x1 = Math.max(...xs) + 0.02, y1 = Math.max(...ys) * 1.1;
  const X = (v) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - (v / y1) * (H - P.t - P.b);
  let svg = '';
  for (let t = 0; t <= 4; t++) { const v = (y1 / 4) * t; svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${P.l - 8}" y="${Y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(2)}</text>`; }
  for (let t = 0; t <= 4; t++) { const v = x0 + ((x1 - x0) / 4) * t; svg += `<text x="${X(v)}" y="${H - P.b + 18}" class="tick" text-anchor="middle">${v.toFixed(2)}</text>`; }
  svg += `<text x="${(W + P.l) / 2}" y="${H - 6}" class="axis" text-anchor="middle">list diversity →</text><text x="14" y="${(H - P.b + P.t) / 2}" class="axis" text-anchor="middle" transform="rotate(-90 14 ${(H - P.b + P.t) / 2})">recall@10 →</text>`;
  const labels = [];
  for (const alpha of metrics.axes.alpha) {
    const line = metrics.axes.lambda.map((lam) => cell(alpha, lam, b));
    const on = alpha === a;
    svg += `<polyline class="curve ${on ? 'on' : ''}" points="${line.map((g) => `${X(g.ild)},${Y(g.recall)}`).join(' ')}"/>`;
    const last = line[line.length - 1];
    labels.push({ on, x: X(last.ild) + 6, y: Y(last.recall) + 4, text: alpha === 0 ? 'genre only' : alpha === 1 ? 'co-listen only' : `blend ${alpha}` });
    if (on) for (const g of line) svg += `<circle class="pt ${g.lambda === l ? 'cur' : ''}" cx="${X(g.ild)}" cy="${Y(g.recall)}" r="${g.lambda === l ? 9 : 4}"/>`;
  }
  // Stack end labels so they never overlap.
  labels.sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const t of labels) svg += `<text class="clabel ${t.on ? 'on' : ''}" x="${t.x}" y="${t.y}">${t.text}</text>`;
  svg += `<rect class="base" x="${X(base.ild) - 6}" y="${Y(base.recall) - 6}" width="12" height="12"/><text class="clabel" x="${X(base.ild) - 10}" y="${Y(base.recall) - 10}" text-anchor="end">most popular</text>`;
  const chart = $('chart');
  chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
  chart.innerHTML = svg;
  $('chart-cap').textContent = `Accuracy vs. diversity at novelty ${b}. Each line is one blend; dots along the highlighted line step diversity from 0 to 0.75. The big dot is your current setting: recall ${fmt(cur.recall)} at diversity ${fmt(cur.ild, 2)}.`;
}

function renderSignals() {
  const rows = [
    ['Most popular (baseline)', metrics.baselines.popularity],
    ['Genre match only', cell(0, 0, 0)],
    ['Co-listening only', cell(1, 0, 0)],
    ['Hybrid, blend 0.75', cell(0.75, 0, 0)],
    ['Hybrid 0.75 + diversity 0.3', cell(0.75, 0.3, 0)],
  ];
  $('signal-table').querySelector('tbody').innerHTML = rows.map(([n, g]) => `<tr><th scope="row">${n}</th><td>${fmt(g.recall)}</td><td>${fmt(g.coverage, 2)}</td><td>${fmt(g.ild, 2)}</td><td>${fmt(g.novelty, 2)}</td></tr>`).join('');
}

init().catch((e) => { $('recs-empty').hidden = false; $('recs-empty').textContent = `Could not load the catalog (${e.message}).`; });
