// STRATA — app controller: game flow, input, UI.
import { Game } from './game.js';
import { BoardScene } from './scene.js';
import { Sfx, haptics } from './audio.js';
import { SLIDES } from './howto.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const area = $('#board-area');

const COLOR_NAMES = ['赤', '緑', '青'];
const COLOR_CSS = ['var(--red)', 'var(--green)', 'var(--blue)'];
const DEFAULT_NAMES = ['ゴールド', 'シルバー'];
const KIND_NAMES = { straight: '一直線', diagonal: 'ななめ', tower: 'タワー', stairs: '階段', space: '立体ななめ' };
const isTouch = matchMedia('(pointer: coarse)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  menu: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  face: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="11" y="4" width="12" height="18" rx="2.5"/><circle cx="17" cy="1.5" r="1.3" fill="currentColor"/><circle cx="17" cy="24.5" r="1.3" fill="currentColor"/></svg>',
  pass: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="12" y="3" width="10" height="16" rx="2.2"/><path d="M5 21c4 3 20 3 24 0"/><path d="m26 19 3 2-2 3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  side: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="24" height="15" rx="2"/><circle cx="12" cy="23" r="1.5" fill="currentColor"/><circle cx="22" cy="23" r="1.5" fill="currentColor"/></svg>',
};

// ------------------------------------------------------------- storage
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('strata.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('strata.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('strata.' + k); } catch { /* ignore */ } },
};

const settings = { sound: true, haptics: true, labels: true, glyphs: false, undo: true, quality: 'auto', ...store.get('settings', {}) };
const setup = { size: 5, height: 5, style: isTouch ? 'face' : 'side', first: 'alt', names: ['', ''], ...store.get('setup', {}) };

const state = {
  screen: 'loading',
  game: null,
  names: [...DEFAULT_NAMES],
  scores: [0, 0],
  style: setup.style,
  colorSel: [0, 0],
  selection: null,
  busy: false,
  undoFor: null,
  showing: 'none', // what the 3D board currently shows: 'demo' | 'game' | 'none'
};

const sfx = new Sfx();
let scene;

// ============================================================== boot
async function boot() {
  try {
    scene = new BoardScene($('#gl'), $('#labels'));
  } catch (err) {
    console.error(err);
    $('#loading .loading-text').textContent = 'WebGLを初期化できませんでした';
    return;
  }
  applySettings();
  // GPU resets (e.g. iOS backgrounding) — the game is saved after every move, so just reload.
  $('#gl').addEventListener('webglcontextlost', (e) => { e.preventDefault(); saveGame(); });
  $('#gl').addEventListener('webglcontextrestored', () => location.reload());
  scene.onImpact = (e) => {
    sfx.impact(e);
    if (haptics.canVibrate) haptics.fire('place');
  };

  layout();
  new ResizeObserver(layout).observe(area);
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));

  // background board for the title screen
  const saved = loadSaved();
  if (saved) {
    scene.newBoard(saved.game.size, saved.game.height);
    scene.setPieces(saved.game.cols);
    state.showing = 'game';
  } else {
    showDemo();
  }
  scene.mode = 'title';
  scene.applyRig(scene.rigFor('title'));
  scene.enableOrbit('title');
  await frame();
  await frame();
  showTitle(true);

  bindInput();
  bindTitle();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function applySettings() {
  sfx.enabled = settings.sound;
  haptics.enabled = settings.haptics;
  app.dataset.glyphs = String(settings.glyphs);
  scene.setOptions({ labels: settings.labels, glyphs: settings.glyphs, quality: settings.quality });
  store.set('settings', settings);
}

function layout() {
  if (!scene) return;
  scene.resize();
  const r = area.getBoundingClientRect();
  scene.setRegion({ x: r.left, y: r.top, w: r.width, h: r.height });
  if (state.game && state.style === 'face' && !state.game.result) scene.setLabelTheta(seatYaw(state.game.turn));
}

function setScreen(s) {
  state.screen = s;
  app.dataset.screen = s;
}

function showDemo() {
  const size = 5, height = 5;
  if (scene.size !== size || scene.height !== height) scene.newBoard(size, height);
  // a calm, believable mid-game position
  const cols = Array.from({ length: size * size }, () => []);
  const rnd = mulberry(20261031);
  for (let i = 0; i < cols.length; i++) {
    const h = rnd() < 0.42 ? 0 : Math.floor(rnd() * 3.2);
    for (let z = 0; z < h; z++) cols[i].push(Math.floor(rnd() * 3));
  }
  scene.setPieces(cols);
  state.showing = 'demo';
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================ saving
function saveGame() {
  const g = state.game;
  if (!g || g.result) { store.del('game'); return; }
  store.set('game', {
    game: g.toJSON(), names: state.names, scores: state.scores, style: state.style,
    colorSel: state.colorSel, undoFor: state.undoFor, savedAt: Date.now(),
  });
}

function loadSaved() {
  const s = store.get('game');
  if (!s || !s.game || !s.game.moves) return null;
  try {
    const game = Game.fromJSON(s.game);
    if (game.result) return null;
    return { ...s, game };
  } catch { return null; }
}

// ============================================================= title
function showTitle(first = false) {
  closeSheet(true);
  setScreen('title');
  keepAwake(false);
  const saved = state.game && !state.game.result ? { game: state.game } : loadSaved();
  const cont = $('#btn-continue');
  cont.hidden = !saved;
  if (saved) {
    const n = saved.game.moves.length;
    $('#continue-meta').textContent = `${saved.game.size}×${saved.game.size} · ${n}手目`;
  }
  $('#btn-new span').textContent = saved ? '新しいゲーム' : 'あそぶ';
  $('#btn-new').classList.toggle('primary', !saved);
  $('#btn-new').classList.toggle('quiet', !!saved);
  if (!first) scene.setMode('title', 1.6);

  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#install-hint').hidden = !(ios && !standalone && !store.get('hideInstall', false));
}

function bindTitle() {
  $('#btn-new').addEventListener('click', () => { sfx.tick(); openSetup(); });
  $('#btn-continue').addEventListener('click', () => { sfx.tick(); continueGame(); });
  $('#btn-howto').addEventListener('click', () => { sfx.tick(); openHowto(); });
  $('#btn-settings').addEventListener('click', () => { sfx.tick(); openSettings(); });
  $('#install-hint .x').addEventListener('click', () => { $('#install-hint').hidden = true; store.set('hideInstall', true); });
  $$('#peek-bar .btn').forEach((b) => b.addEventListener('click', () => { sfx.tick(); setScreen('result'); }));
}

// ============================================================ flow
function resolveNames(names) {
  return [0, 1].map((i) => (names?.[i] || '').trim().slice(0, 12) || DEFAULT_NAMES[i]);
}

async function startNewGame() {
  store.set('setup', setup);
  const prevFirst = state.game ? state.game.first : store.get('lastFirst', 1);
  let first = 0;
  if (setup.first === 'alt') first = 1 - prevFirst;
  else if (setup.first === 'random') first = Math.random() < 0.5 ? 0 : 1;
  else first = +setup.first;
  store.set('lastFirst', first);
  state.names = resolveNames(setup.names);
  state.scores = [0, 0];
  state.style = setup.style;
  state.colorSel = [0, 0];
  state.undoFor = null;
  state.game = new Game({ size: setup.size, height: setup.height, first });
  saveGame();
  await enterGame(false);
}

async function continueGame() {
  if (!state.game || state.game.result) {
    const saved = loadSaved();
    if (!saved) return;
    state.game = saved.game;
    state.names = resolveNames(saved.names);
    state.scores = saved.scores || [0, 0];
    state.style = saved.style || setup.style;
    state.colorSel = saved.colorSel || [0, 0];
    state.undoFor = saved.undoFor ?? null;
  }
  await enterGame(true);
}

async function enterGame(resume) {
  const g = state.game;
  closeSheet(true);
  setScreen('transition');
  sfx.whoosh();
  applyStyle();
  const rebuild = scene.size !== g.size || scene.height !== g.height;
  if (rebuild) {
    await curtain(true);
    scene.newBoard(g.size, g.height);
    if (resume) scene.setPieces(g.cols);
    scene.mode = 'title';
    scene.applyRig(scene.rigFor('title'));
    await frame();
    curtain(false);
  } else if (!(resume && state.showing === 'game')) {
    if (scene.pieces.size) await scene.sweep();
    if (resume) scene.setPieces(g.cols);
  }
  state.showing = 'game';
  state.selection = null;
  state.busy = true;
  setViewForTurn(false);
  buildDocks();
  setScreen('game');
  updateDocks();
  await scene.setMode('top', 1.3);
  scene.setLastMove(g.lastMove);
  state.busy = false;
  keepAwake(true);
  if (!store.get('seenHowto', false)) {
    store.set('seenHowto', true);
    openHowto(g.turn);
  }
}

/** Which way the player in a seat looks at the board (world yaw). */
function seatYaw(player) {
  if (state.style !== 'face') return player === 1 && state.style === 'pass' ? Math.PI : 0;
  const land = matchMedia('(orientation: landscape)').matches;
  if (land) return player === 0 ? Math.PI / 2 : -Math.PI / 2; // P1 sits at the right, P2 at the left
  return player === 0 ? 0 : Math.PI;
}

function setViewForTurn(animate = true) {
  const g = state.game;
  if (!g) return;
  if (state.style === 'pass') {
    scene.setViewTheta(seatYaw(g.turn), animate && scene.mode === 'top');
  } else {
    scene.viewTheta = 0;
    scene.setLabelTheta(seatYaw(g.turn));
  }
}

async function placeSelected() {
  const g = state.game;
  const sel = state.selection;
  if (!sel || state.busy || g.result || state.screen !== 'game') return;
  if (g.isColumnFull(sel.x, sel.y)) { feedbackFull(sel); return; }
  const color = state.colorSel[g.turn];
  const move = g.place(sel.x, sel.y, color);
  if (!move) return;
  state.busy = true;
  state.selection = null;
  state.undoFor = null;
  if (!haptics.canVibrate) haptics.fire('place');
  updateDocks();
  scene.setLastMove(null);
  await scene.dropPiece(move);
  saveGame();
  if (g.result) { finish(); return; }
  state.undoFor = move.player;
  scene.setLastMove(move);
  setViewForTurn(true);
  state.busy = false;
  saveGame();
  updateDocks();
  if (pendingPointer) refreshHover();
}

async function doUndo() {
  const g = state.game;
  if (state.busy || state.undoFor === null || !settings.undo || g.result) return;
  const mover = state.undoFor;
  const move = g.undo();
  if (!move) return;
  state.busy = true;
  state.selection = null;
  scene.hideGhost(true);
  sfx.undo();
  haptics.fire('undo');
  await scene.removePiece(move);
  state.undoFor = null;
  state.colorSel[move.player] = move.color;
  scene.setLastMove(g.lastMove);
  setViewForTurn(true);
  state.busy = false;
  saveGame();
  updateDocks();
  toast(mover, '1手戻しました');
}

async function finish() {
  const g = state.game, r = g.result;
  store.del('game');
  state.undoFor = null;
  if (r.type === 'win') {
    state.scores[r.player]++;
    sfx.win();
    haptics.fire('win');
  } else {
    sfx.draw();
  }
  updateDocks();
  scene.markWinners(r);
  await wait(r.type === 'win' ? 800 : 450);
  setScreen('transition');
  keepAwake(false);
  await scene.reveal(r);
  renderResult();
  setScreen('result');
  state.busy = false;
}

async function rematch() {
  if (state.busy) return;
  state.busy = true;
  setScreen('transition');
  sfx.whoosh();
  const old = state.game;
  const p = scene.sweep();
  await wait(380);
  const camP = scene.setMode('top', 1.2);
  await p;
  state.game = new Game({ size: old.size, height: old.height, first: 1 - old.first });
  store.set('lastFirst', state.game.first);
  state.selection = null;
  state.undoFor = null;
  state.colorSel = [0, 0];
  setViewForTurn(false);
  buildDocks();
  setScreen('game');
  updateDocks();
  await camP;
  if (state.style === 'pass') await scene.setViewTheta(state.game.turn === 1 ? Math.PI : 0, true);
  saveGame();
  keepAwake(true);
  state.busy = false;
}

async function toTitle() {
  if (state.game?.result) {
    state.game = null;
    await scene.sweep();
    showDemo();
  } else {
    saveGame();
  }
  scene.hideGhost(true);
  state.selection = null;
  showTitle();
}

// ============================================================= docks
function applyStyle() {
  app.dataset.style = state.style;
}

function seatFor(player) {
  if (state.style === 'face') return player === 0 ? 'near' : 'far';
  return 'near';
}

function buildDocks() {
  const near = $('#dock-near'), far = $('#dock-far');
  if (state.style === 'face') {
    buildPlayerDock(near, 0);
    buildPlayerDock(far, 1);
  } else {
    buildPlayerDock(near, state.game ? state.game.turn : 0);
    buildStatusDock(far);
  }
}

function buildPlayerDock(el, player) {
  el.dataset.player = player;
  el.dataset.kind = 'player';
  el.innerHTML = `
  <div class="dock-inner">
    <div class="panel">
      <div class="toast" role="status"></div>
      <div class="dock-head">
        <span class="crest"></span>
        <div class="who"><span class="name"></span><span class="wins"></span></div>
        <span class="turn-tag"></span>
        <button class="icon-btn menu-btn" aria-label="メニュー">${ICON.menu}</button>
      </div>
      <div class="controls">
        <div class="gems" role="radiogroup" aria-label="コマの色">
          ${[0, 1, 2].map((c) => `<button class="gem-btn" role="radio" data-color="${c}" aria-checked="false" aria-label="${COLOR_NAMES[c]}"><span class="gem"></span><span class="gem-name">${COLOR_NAMES[c]}</span></button>`).join('')}
        </div>
        <button class="place-btn" disabled><span class="place-main">置く</span><span class="place-sub"></span></button>
      </div>
      <p class="hint"></p>
      <div class="waiting"><p class="wait-text"></p><button class="undo-btn" hidden>${ICON.undo}<span>待った</span></button></div>
    </div>
  </div>`;
}

function buildStatusDock(el) {
  el.dataset.player = '';
  el.dataset.kind = 'status';
  el.innerHTML = `
  <div class="dock-inner">
    <div class="panel status">
      <div class="toast" role="status"></div>
      <div class="side p0"><span class="crest"></span><span class="name"></span></div>
      <span class="score"></span>
      <div class="side p1"><span class="crest"></span><span class="name"></span></div>
      <div class="actions">
        <button class="undo-btn" hidden aria-label="待った">${ICON.undo}<span>待った</span></button>
        <button class="icon-btn menu-btn" aria-label="メニュー">${ICON.menu}</button>
      </div>
    </div>
  </div>`;
}

function updateDocks() {
  const g = state.game;
  if (!g) return;
  for (const el of [$('#dock-near'), $('#dock-far')]) {
    if (el.dataset.kind === 'status') { updateStatusDock(el); continue; }
    if (state.style !== 'face' && el.dataset.seat === 'near' && +el.dataset.player !== g.turn && !g.result) {
      el.dataset.player = g.turn;
    }
    const p = +el.dataset.player;
    const active = g.turn === p && !g.result;
    el.classList.toggle('is-active', active);
    $('.name', el).textContent = state.names[p];
    $('.wins', el).textContent = state.scores[0] + state.scores[1] > 0 ? `${state.scores[p]}勝` : '';
    $('.turn-tag', el).textContent = state.style === 'face' ? 'あなたの番' : '手番';
    const c = state.colorSel[p];
    $$('.gem-btn', el).forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.color === c)));
    const sel = active ? state.selection : null;
    const btn = $('.place-btn', el);
    btn.disabled = !sel || state.busy;
    btn.classList.toggle('ready', !!sel);
    $('.place-sub', el).innerHTML = sel
      ? `<i style="--dot:${COLOR_CSS[c]}"></i>${COLOR_NAMES[c]} · ${g.heightAt(sel.x, sel.y) + 1}段目`
      : 'マスを選択';
    const last = g.lastMove;
    let hint;
    if (sel) hint = 'もう一度タップ、または［置く］で確定';
    else if (last && last.player !== p) hint = `${state.style === 'face' ? '相手' : esc(state.names[last.player])}は <span class="dot" style="background:${COLOR_CSS[last.color]}"></span><b>${COLOR_NAMES[last.color]}</b> を <b>${last.z + 1}段目</b> に置いた`;
    else hint = isTouch ? '色を選んで、マスをタップ' : '色を選んで、マスをクリック（1・2・3キーでも色を選べます）';
    $('.hint', el).innerHTML = hint;
    $('.wait-text', el).innerHTML = g.result ? '' : `<b>${esc(state.names[g.turn])}</b> の番です`;
    $('.undo-btn', el).hidden = !(settings.undo && state.undoFor === p && !g.result);
  }
}

function updateStatusDock(el) {
  const g = state.game;
  for (const p of [0, 1]) {
    const side = $(`.side.p${p}`, el);
    side.classList.toggle('on', g.turn === p && !g.result);
    $('.name', side).textContent = state.names[p];
  }
  $('.score', el).textContent = `${state.scores[0]} – ${state.scores[1]}`;
  $('.undo-btn', el).hidden = !(settings.undo && state.undoFor !== null && !g.result);
}

function toast(player, text) {
  const seat = seatFor(player);
  const el = $(`#dock-${seat} .toast`);
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1700);
}

function chooseColor(player, c) {
  const g = state.game;
  if (!g || g.turn !== player || g.result) return;
  if (state.colorSel[player] === c) { haptics.fire('light'); return; }
  state.colorSel[player] = c;
  sfx.gem(c);
  haptics.fire('select');
  if (state.selection) scene.setGhostColor(c);
  updateDocks();
}

function onDockClick(e) {
  const dock = e.currentTarget;
  const t = e.target.closest('button');
  if (!t || !state.game) return;
  sfx.unlock();
  if (t.classList.contains('gem-btn')) chooseColor(+dock.dataset.player, +t.dataset.color);
  else if (t.classList.contains('place-btn')) placeSelected();
  else if (t.classList.contains('undo-btn')) doUndo();
  else if (t.classList.contains('menu-btn')) { sfx.tick(); openMenu(dock.dataset.seat); }
}

// ============================================================= input
let pointer = null;
let pendingPointer = null; // last known mouse position for hover refresh

function sameCell(a, b) { return a && b && a.x === b.x && a.y === b.y; }

function canInteract() {
  return state.screen === 'game' && state.game && !state.game.result && !state.busy && $('#sheet').hidden;
}

function select(cell, { quiet = false } = {}) {
  const g = state.game;
  if (!cell || g.isColumnFull(cell.x, cell.y)) return false;
  if (sameCell(cell, state.selection)) return true;
  state.selection = cell;
  scene.showGhost(cell.x, cell.y, state.colorSel[g.turn]);
  if (!quiet) { sfx.tick(); haptics.fire('light'); }
  updateDocks();
  return true;
}

function clearSelection() {
  if (!state.selection) return;
  state.selection = null;
  scene.hideGhost();
  updateDocks();
}

function feedbackFull(cell) {
  scene.flashFull(cell.x, cell.y);
  sfx.error();
  haptics.fire('error');
  toast(state.game.turn, 'このマスはもう積めません');
}

function refreshHover() {
  if (!pendingPointer || !canInteract()) return;
  const cell = scene.pick(pendingPointer.x, pendingPointer.y, 0);
  if (cell && !state.game.isColumnFull(cell.x, cell.y)) select(cell, { quiet: true });
}

function bindInput() {
  document.addEventListener('pointerdown', () => sfx.unlock(), true);
  $('#dock-near').addEventListener('click', onDockClick);
  $('#dock-far').addEventListener('click', onDockClick);

  area.addEventListener('pointerdown', (e) => {
    if (!canInteract()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { area.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const cell = scene.pick(e.clientX, e.clientY);
    pointer = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, type: e.pointerType, armed: false, startCell: cell };
    if (!cell) return;
    if (state.game.isColumnFull(cell.x, cell.y)) { pointer.full = cell; return; }
    if (e.pointerType === 'mouse') { pointer.armed = true; select(cell, { quiet: sameCell(cell, state.selection) }); return; }
    pointer.armed = sameCell(cell, state.selection);
    select(cell);
  });

  area.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') pendingPointer = { x: e.clientX, y: e.clientY };
    if (!canInteract()) return;
    if (pointer && pointer.id === e.pointerId) {
      if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 10) pointer.moved = true;
      const cell = scene.pick(e.clientX, e.clientY);
      if (cell && !sameCell(cell, state.selection) && !state.game.isColumnFull(cell.x, cell.y)) {
        select(cell);
        pointer.armed = false;
      }
    } else if (e.pointerType === 'mouse' && !pointer) {
      // desktop: hover previews, click places
      const cell = scene.pick(e.clientX, e.clientY, 0);
      if (cell && !state.game.isColumnFull(cell.x, cell.y)) select(cell, { quiet: true });
      else if (!cell) clearSelection();
    }
  });

  const end = (e, cancelled) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const p = pointer;
    pointer = null;
    if (cancelled || !canInteract()) return;
    const cell = scene.pick(e.clientX, e.clientY);
    if (p.full && !p.moved && sameCell(cell, p.full)) { feedbackFull(p.full); return; }
    if (p.armed && !p.moved && sameCell(cell, state.selection)) placeSelected();
    else if (p.type === 'mouse' && p.armed && sameCell(cell, state.selection)) placeSelected();
  };
  area.addEventListener('pointerup', (e) => end(e, false));
  area.addEventListener('pointercancel', (e) => end(e, true));
  area.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointer) { pendingPointer = null; if (canInteract()) clearSelection(); }
  });
  area.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveGame();
    else if (state.screen === 'game') keepAwake(true);
  });
  window.addEventListener('pagehide', saveGame);
}

function onKey(e) {
  if (e.target.closest?.('input')) return;
  if (!$('#sheet').hidden) { if (e.key === 'Escape') closeSheet(); return; }
  if (state.screen !== 'game' || !state.game) return;
  const g = state.game;
  const k = e.key.toLowerCase();
  if (k === 'escape') { openMenu('near'); return; }
  if (!canInteract()) return;
  if (['1', '2', '3'].includes(k)) { chooseColor(g.turn, +k - 1); return; }
  if (k === 'r' || k === 'g' || k === 'b') { chooseColor(g.turn, 'rgb'.indexOf(k)); return; }
  if (k === 'backspace' || k === 'z') { doUndo(); return; }
  if (k === 'enter' || k === ' ') { e.preventDefault(); if (state.selection) placeSelected(); else select({ x: g.size >> 1, y: g.size >> 1 }); return; }
  const dirs = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (dirs[k]) {
    e.preventDefault();
    let [dx, dy] = dirs[k];
    if (scene.viewTheta === Math.PI) { dx = -dx; dy = -dy; }
    const cur = state.selection || { x: g.size >> 1, y: g.size >> 1 };
    let nx = cur.x, ny = cur.y;
    for (let i = 0; i < g.size; i++) {
      nx = Math.max(0, Math.min(g.size - 1, nx + dx));
      ny = Math.max(0, Math.min(g.size - 1, ny + dy));
      if (!g.isColumnFull(nx, ny)) break;
    }
    if (!state.selection) select(cur); else select({ x: nx, y: ny });
  }
}

// ============================================================ result
function renderResult() {
  const g = state.game, r = g.result;
  for (const card of $$('.result-card')) {
    const seat = card.dataset.seat;
    const viewer = state.style === 'face' ? (seat === 'near' ? 0 : 1) : null;
    let kicker, title, win = false;
    if (r.type === 'draw') { kicker = 'DRAW'; title = '引き分け'; }
    else if (viewer === null) { kicker = 'WINNER'; title = `${esc(state.names[r.player])}の勝ち`; win = true; }
    else if (viewer === r.player) { kicker = 'VICTORY'; title = 'あなたの勝ち'; win = true; }
    else { kicker = 'DEFEAT'; title = 'あなたの負け'; }
    const accent = r.type === 'win' ? (r.player === 0 ? 'var(--gold-hi)' : 'var(--silver-hi)') : '#fff';
    const sub = r.type === 'win'
      ? `${viewer === r.player ? '' : `${esc(state.names[r.player])}が `}<span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLOR_CSS[r.color]};margin:0 3px 1px;vertical-align:middle"></span><b>${COLOR_NAMES[r.color]}</b>の「${KIND_NAMES[r.lines[0].kind]}」${r.lines.length > 1 ? `ほか${r.lines.length - 1}本` : ''}を完成 · ${g.moves.length}手`
      : `盤面がすべて埋まりました · ${g.moves.length}手`;
    card.style.setProperty('--accent', accent);
    card.innerHTML = `
      <div class="result-kicker">${kicker}</div>
      <div class="result-title ${win ? 'win' : ''}">${title}</div>
      <p class="result-sub">${sub}</p>
      <div class="result-score">
        <span class="s p0"><span class="crest"></span>${esc(state.names[0])} <span class="n">${state.scores[0]}</span></span>
        <span class="s" style="opacity:.4">–</span>
        <span class="s p1"><span class="n">${state.scores[1]}</span> ${esc(state.names[1])}<span class="crest"></span></span>
      </div>
      <div class="result-actions">
        <button class="btn primary" data-act="again">もう一度</button>
        <button class="btn quiet" data-act="peek" aria-label="盤面を見る">${ICON.eye}<span>盤面</span></button>
        <button class="btn quiet" data-act="title">タイトル</button>
      </div>`;
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      sfx.unlock(); sfx.tick();
      if (b.dataset.act === 'again') rematch();
      else if (b.dataset.act === 'peek') setScreen('peek');
      else if (b.dataset.act === 'title') toTitle();
    };
  }
}

// ============================================================ sheets
const sheet = $('#sheet');
const panel = $('.sheet-panel', sheet);
let sheetResolve = null;

function flipFor(seat) {
  if (state.style !== 'face' || state.screen === 'title' || !seat) return 'false';
  const land = matchMedia('(orientation: landscape)').matches;
  if (seat === 'far') return land ? 'left' : 'true';
  return land ? 'right' : 'false';
}

function openSheet(html, { seat = null, onMount } = {}) {
  sheet.hidden = false;
  sheet.dataset.flip = flipFor(seat);
  panel.innerHTML = html;
  panel.scrollTop = 0;
  sheet.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  onMount?.(panel);
  sheet.onclick = (e) => {
    if (e.target.closest('[data-close]')) { sfx.tick(); closeSheet(); }
  };
}

function closeSheet(instant = false) {
  if (sheet.hidden) return;
  sheet.classList.remove('open');
  if (sheetResolve) { sheetResolve(false); sheetResolve = null; }
  if (instant) { sheet.hidden = true; return; }
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
}

function confirmSheet(title, body, ok, seat) {
  return new Promise((resolve) => {
    openSheet(`
      <h2>${title}</h2><p class="lead">${body}</p>
      <div class="menu-list">
        <button class="btn primary" data-ok>${ok}</button>
        <button class="btn quiet" data-close>キャンセル</button>
      </div>`, {
      seat,
      onMount: (p) => {
        $('[data-ok]', p).onclick = () => { sfx.tick(); sheetResolve = null; closeSheet(); resolve(true); };
      },
    });
    sheetResolve = resolve;
  });
}

function segHTML(key, items, value) {
  return `<div class="seg ${items.some((i) => i.icon) ? 'tall' : ''}" data-key="${key}">${items.map((i) => `
    <button type="button" data-v="${i.v}" aria-pressed="${String(i.v) === String(value)}">${i.icon || ''}<span>${i.label}</span>${i.sub ? `<small>${i.sub}</small>` : ''}</button>`).join('')}</div>`;
}

function bindSegs(root, onChange) {
  $$('.seg', root).forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $$('button', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sfx.tick(); haptics.fire('light');
      onChange(seg.dataset.key, b.dataset.v);
    });
  });
}

function openSetup(seat = null) {
  const s = setup;
  openSheet(`
    <button class="sheet-close" data-close aria-label="閉じる">×</button>
    <h2>新しいゲーム</h2>
    <p class="lead">同じ色を4つ並べた人の勝ち。下に隠れた色は、覚えておくしかない。</p>
    <div class="field"><div class="field-label">盤面 <small id="sz-note"></small></div>
      ${segHTML('size', [4, 5, 6, 7, 8].map((v) => ({ v, label: `${v}×${v}` })), s.size)}</div>
    <div class="field"><div class="field-label">高さの上限</div>
      ${segHTML('height', [4, 5, 6, 8].map((v) => ({ v, label: `${v}段` })), s.height)}</div>
    <div class="field"><div class="field-label">スタイル</div>
      ${segHTML('style', [
        { v: 'face', label: '向かい合う', sub: '机に置いて対面', icon: ICON.face },
        { v: 'pass', label: '手渡し', sub: '交代で持つ', icon: ICON.pass },
        { v: 'side', label: '並んで', sub: 'PC・横並び', icon: ICON.side },
      ], s.style)}</div>
    <div class="field"><div class="field-label">先手</div>
      ${segHTML('first', [{ v: 'alt', label: '交互' }, { v: '0', label: 'ゴールド' }, { v: '1', label: 'シルバー' }, { v: 'random', label: 'ランダム' }], s.first)}</div>
    <div class="field"><div class="field-label">名前 <small>空欄でもOK</small></div>
      <div class="names">
        <label class="p0"><span class="crest"></span><input maxlength="12" placeholder="${DEFAULT_NAMES[0]}" value="${esc(s.names[0] || '')}" data-name="0" enterkeyhint="next" autocomplete="off"></label>
        <label class="p1"><span class="crest"></span><input maxlength="12" placeholder="${DEFAULT_NAMES[1]}" value="${esc(s.names[1] || '')}" data-name="1" enterkeyhint="done" autocomplete="off"></label>
      </div></div>
    <button class="btn primary" data-start>はじめる</button>`, {
    seat,
    onMount: (p) => {
      const note = () => {
        const cells = setup.size * setup.size * setup.height;
        $('#sz-note', p).textContent = setup.size <= 4 ? 'サクッと' : setup.size <= 5 ? 'おすすめ' : setup.size <= 6 ? 'じっくり' : '長期戦';
        $('#sz-note', p).title = `最大${cells}手`;
      };
      note();
      bindSegs(p, (k, v) => {
        setup[k] = k === 'size' || k === 'height' ? +v : v;
        note();
      });
      $$('input', p).forEach((inp) => {
        inp.addEventListener('input', () => { setup.names[+inp.dataset.name] = inp.value; });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      });
      $('[data-start]', p).onclick = () => { sfx.tick(); haptics.fire('select'); startNewGame(); };
    },
  });
}

function openSettings(seat = null) {
  const row = (key, t, d) => `
    <div class="toggle-row"><div><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div>
    <button class="switch" role="switch" data-key="${key}" aria-checked="${settings[key]}" aria-label="${t}"></button></div>`;
  openSheet(`
    <button class="sheet-close" data-close aria-label="閉じる">×</button>
    <h2>設定</h2>
    <div style="margin-top:10px">
      ${row('sound', 'サウンド', '')}
      ${row('haptics', '振動', '対応端末のみ')}
      ${row('labels', '段数を表示', '各マスに積まれた高さを数字で表示')}
      ${row('glyphs', '色覚サポート', 'コマに ▲●■ の印を付ける')}
      ${row('undo', '待ったを許可', '相手が置く前なら1手戻せる')}
    </div>
    <div class="field" style="margin-top:14px"><div class="field-label">画質</div>
      ${segHTML('quality', [{ v: 'auto', label: '自動' }, { v: 'high', label: '高' }, { v: 'medium', label: '中' }, { v: 'low', label: '低' }], settings.quality)}</div>
    <button class="btn quiet" data-close>閉じる</button>`, {
    seat,
    onMount: (p) => {
      $$('.switch', p).forEach((sw) => sw.addEventListener('click', () => {
        const k = sw.dataset.key;
        settings[k] = !settings[k];
        sw.setAttribute('aria-checked', String(settings[k]));
        applySettings();
        if (k === 'sound' && settings.sound) { sfx.unlock(); sfx.tick(); }
        if (k === 'haptics' && settings.haptics) haptics.fire('select');
        updateDocks();
      }));
      bindSegs(p, (k, v) => { settings[k] = v; applySettings(); });
    },
  });
}

function openHowto(seatOrPlayer = null) {
  const seat = typeof seatOrPlayer === 'number' ? seatFor(seatOrPlayer) : seatOrPlayer;
  let idx = 0;
  openSheet(`
    <button class="sheet-close" data-close aria-label="閉じる">×</button>
    <h2>遊び方</h2>
    <div class="howto" style="margin-top:14px">
      <div class="howto-track">
        ${SLIDES.map((s) => `<div class="howto-slide"><div class="howto-art">${s.art()}</div><h3>${s.title}</h3><p>${s.body}</p></div>`).join('')}
      </div>
    </div>
    <div class="howto-nav">
      <div class="dots">${SLIDES.map(() => '<i></i>').join('')}</div>
      <button class="btn primary" data-next>次へ</button>
    </div>`, {
    seat,
    onMount: (p) => {
      const track = $('.howto-track', p);
      const dots = $$('.dots i', p);
      const next = $('[data-next]', p);
      const go = (i) => {
        idx = Math.max(0, Math.min(SLIDES.length - 1, i));
        track.style.transform = `translateX(${-idx * 100}%)`;
        dots.forEach((d, j) => d.classList.toggle('on', j === idx));
        next.textContent = idx === SLIDES.length - 1 ? 'はじめる' : '次へ';
      };
      go(0);
      next.onclick = () => {
        sfx.tick();
        if (idx === SLIDES.length - 1) closeSheet(); else go(idx + 1);
      };
      // swipe
      let sx = null, sy = 0;
      track.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
      track.addEventListener('pointerup', (e) => {
        if (sx === null) return;
        let dx = e.clientX - sx;
        const dy = e.clientY - sy;
        sx = null;
        // flipped sheets swipe the other way on screen
        const f = sheet.dataset.flip;
        if (f === 'true') dx = -dx;
        if (f === 'left' || f === 'right') { dx = f === 'left' ? dy : -dy; }
        if (Math.abs(dx) > 40) { sfx.tick(); go(idx + (dx < 0 ? 1 : -1)); }
      });
    },
  });
}

function openMenu(seat) {
  if (!state.game) return;
  clearSelection();
  openSheet(`
    <button class="sheet-close" data-close aria-label="閉じる">×</button>
    <h2>メニュー</h2>
    <p class="lead">${state.game.size}×${state.game.size} · 高さ${state.game.height} · ${state.game.moves.length}手目</p>
    <div class="menu-list">
      <button class="btn primary" data-close>ゲームに戻る</button>
      <button class="btn quiet" data-a="howto">遊び方</button>
      <button class="btn quiet" data-a="settings">設定</button>
      <button class="btn quiet" data-a="new">新しいゲーム…</button>
      <button class="btn quiet" data-a="title">タイトルへ（自動保存）</button>
    </div>`, {
    seat,
    onMount: (p) => {
      $$('[data-a]', p).forEach((b) => b.addEventListener('click', async () => {
        sfx.tick();
        const a = b.dataset.a;
        if (a === 'howto') openHowto(seat);
        else if (a === 'settings') openSettings(seat);
        else if (a === 'title') { closeSheet(); toTitle(); }
        else if (a === 'new') {
          const ok = state.game.moves.length === 0 || await confirmSheet('新しいゲーム', '今の対局は破棄されます。', '新しく始める', seat);
          if (ok) openSetup(seat);
        }
      }));
    },
  });
}

// ============================================================== misc
function curtain(on) {
  const c = $('#curtain');
  c.classList.toggle('on', on);
  return wait(on ? 260 : 0);
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      const w = wakeLock; wakeLock = null; await w.release();
    }
  } catch { /* not allowed */ }
}

// debugging / automated tests
window.__strata = {
  get state() { return state; },
  get scene() { return scene; },
  place(x, y, c) { state.colorSel[state.game.turn] = c; select({ x, y }, { quiet: true }); return placeSelected(); },
};

boot();
