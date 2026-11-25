import { TEAM_PRESETS, DEFAULT_SETTINGS, AI_CONF } from '../data/sets.js';
import { computeStanding, score } from '../core/engine.js';
import { load, store, loadSoloStats, saveSoloStats } from '../utils/storage.js';
import { setBgmStyle, stopSpeak } from '../utils/audio.js';
import { isIdbImageRef, getCachedIdbImage, hydrateImages } from '../utils/imageStore.js';
import { isSafeImageUrl } from '../core/questions.js';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const isReducedMotion = () => !!(document.body.classList.contains('reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));

export const actions = {};

function initSetupState() {
  let setup = load('bq_setup', null);
  if (!setup || !Array.isArray(setup.teams)) {
    setup = {
      teams: TEAM_PRESETS.map(t => ({ name: t.name, emoji: t.emoji })),
      solo: { name: '나', emoji: '🦊' },
      settings: { ...DEFAULT_SETTINGS }
    };
  }
  while (setup.teams.length < TEAM_PRESETS.length) {
    const p = TEAM_PRESETS[setup.teams.length];
    setup.teams.push({ name: p.name, emoji: p.emoji });
  }
  if (!setup.solo || typeof setup.solo !== 'object') setup.solo = { name: '나', emoji: '🦊' };
  setup.settings = { ...DEFAULT_SETTINGS, ...setup.settings };
  if (!Array.isArray(setup.settings.disabledRewards)) setup.settings.disabledRewards = [];
  setBgmStyle(setup.settings.bgmStyle);
  return setup;
}

export const app = {
  S: null,
  setup: initSetupState(),
  undoStack: [],
  lastScores: null,
  gameSession: 0,
  busy: false,
  aiFocusTile: -1,
  aiFastTurn: false,
  aiWaitWake: null,
  tileFx: new Map(),
  prevRenderedLines: new Set(),
  qScale: Math.min(1.35, Math.max(0.8, Number(load('bq_qscale', 1)) || 1)),
  liveRoom: null,
  studentLive: null,
  modalType: null,
  annFinish: null
};

export function saveSetup() {
  store('bq_setup', app.setup);
}

export function announceLive(msg) {
  const el = $('#sr-live');
  if (el && msg) el.textContent = msg;
}

export function applyMotion(reduce) {
  document.body.classList.toggle('reduce-motion', !!reduce);
}

export function applyBigScreen(on) {
  document.body.classList.toggle('big-screen', !!on);
}

export function renderImgTag(src, cls = 'q-img', alt = '문제 그림', extraStyle = '') {
  const s = String(src || '').trim();
  if (!s || !isSafeImageUrl(s)) return '';
  const st = extraStyle ? ` style="${extraStyle}"` : '';
  if (isIdbImageRef(s)) {
    const cached = getCachedIdbImage(s);
    if (cached) return `<img class="${cls}"${st} src="${esc(cached)}" data-idb-src="${esc(s)}" alt="${esc(alt)}" onerror="this.style.display='none'">`;
    return `<img class="${cls}"${st} data-idb-src="${esc(s)}" alt="${esc(alt)}" style="${extraStyle ? extraStyle + ';' : ''}display:none">`;
  }
  return `<img class="${cls}"${st} src="${esc(s)}" alt="${esc(alt)}" onerror="this.style.display='none'">`;
}

export function drawBg(theme = 'forest') {
  const bg = $('#bg');
  if (!bg) return;
  let h = '';
  if (theme === 'ocean') {
    [12, 38, 65, 86].forEach(x => { h += `<div class="sunray" style="left:${x}%"></div>`; });
    [6, 18, 32, 48, 63, 79, 91].forEach((x, k) => { h += `<div class="coral" style="left:${x}%;height:${60 + (k % 3) * 28}px;background:${k % 2 ? '#ff7a6b' : '#34d399'}"></div>`; });
    for (let i = 0; i < 14; i++) {
      const sz = 12 + (i % 4) * 10;
      h += `<div class="bubble" style="left:${(i * 7 + 4) % 96}%;width:${sz}px;height:${sz}px;animation-duration:${7 + (i % 5) * 2}s;animation-delay:-${i * 1.1}s"></div>`;
    }
    h += '<div class="wave"></div><div class="sand"></div>';
  } else if (theme === 'space') {
    for (let i = 0; i < 42; i++) {
      const sz = 2 + (i % 3) * 2;
      h += `<div class="star" style="left:${(i * 23 + 7) % 98}%;top:${(i * 19 + 5) % 88}%;width:${sz}px;height:${sz}px;animation-delay:-${(i % 7) * 0.5}s"></div>`;
    }
    h += '<div class="planet ring" style="left:8%;top:14%;width:92px;height:92px;background:linear-gradient(135deg,#fbbf24,#f97316)"></div>';
    h += '<div class="planet" style="right:7%;bottom:12%;width:120px;height:120px;background:linear-gradient(135deg,#38bdf8,#6366f1);opacity:.8"></div>';
  } else if (theme === 'chalkboard') {
    h += '<div class="chalk-grid"></div><div class="chalk-rail"></div>';
    h += '<div class="chalk-stick" style="left:12%"></div><div class="chalk-stick" style="left:18%;background:#fde047"></div><div class="chalk-stick" style="right:14%;background:#f9a8d4"></div>';
  } else {
    [3, 12, 22, 37, 58, 71, 84, 95].forEach((x, k) => { h += `<div class="leafwall" style="left:${x + 2}%"></div><div class="trunk" style="left:${x}%;opacity:${k % 2 ? 0.55 : 0.85}"></div>`; });
    h += `<div class="pine" style="left:3%;bottom:150px"><i></i><i></i><i></i><b></b></div><div class="pine" style="right:3%;bottom:150px"><i></i><i></i><i></i><b></b></div>`;
    for (let x = -5; x < 105; x += 22) h += `<div class="mt a" style="left:${x}%"></div>`;
    for (let x = -10; x < 105; x += 17) h += `<div class="mt b" style="left:${x}%"></div>`;
    for (let x = 0; x < 105; x += 14) h += `<div class="mt c" style="left:${x}%"></div>`;
    h += '<div class="ground"></div>';
  }
  bg.innerHTML = h;
}

export function applyTheme(theme) {
  const t = ['forest', 'ocean', 'space', 'chalkboard'].includes(theme) ? theme : 'forest';
  if (document.body.dataset.theme !== t || !$('#bg').innerHTML) {
    document.body.dataset.theme = t;
    drawBg(t);
  }
}

export function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  document.body.classList.toggle('in-game', id === 'game');
  if (actions.closeMoreMenu) actions.closeMoreMenu();
  if (actions.closeEmoPicker) actions.closeEmoPicker();
  window.scrollTo(0, 0);
  if (id === 'title') {
    applyTheme(app.setup.settings.theme);
    applyMotion(app.setup.settings.reduceMotion);
    applyBigScreen(app.setup.settings.bigScreen);
    if (actions.refreshTitle) actions.refreshTitle();
  }
  if (id === 'game' && actions.renderBingoLines) requestAnimationFrame(actions.renderBingoLines);
}

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  announceLive(msg);
  setTimeout(() => t.remove(), 3300);
}

export function announce(big, small = '', cls = '', ms = 1700) {
  return new Promise(res => {
    app.busy = true;
    const el = $('#announce');
    el.className = 'show ' + cls;
    el.innerHTML = `<div class="ann-big">${big}</div>${small ? `<div class="ann-small">${small}</div>` : ''}`;
    announceLive(`${big} ${small}`.trim());
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      app.annFinish = null;
      el.className = '';
      el.onclick = null;
      setTimeout(() => { app.busy = false; res(); }, 180);
    };
    app.annFinish = finish;
    el.onclick = finish;
    setTimeout(finish, ms);
  });
}

export function confetti(n = 90) {
  if (isReducedMotion()) return;
  const cols = ['#ff4f8b', '#ffd23f', '#3ec1ff', '#7ee08f', '#b07cff', '#ff8a3d'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    d.className = 'cf';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = cols[i % cols.length];
    d.style.animationDelay = Math.random() * 0.6 + 's';
    d.style.animationDuration = (1.8 + Math.random() * 1.5) + 's';
    d.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }
}

export function shakeBoard() {
  if (isReducedMotion()) return;
  const a = $('#arena');
  if (!a) return;
  a.classList.remove('shake-board');
  void a.offsetWidth;
  a.classList.add('shake-board');
  setTimeout(() => a.classList.remove('shake-board'), 500);
}

export function downloadCsv(filename, rows) {
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + rows.map(r => r.map(escCsv).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function recordSoloResult() {
  const st = loadSoloStats();
  const S = app.S;
  if (!S || S.settings.playMode !== 'solo' || S.teams.length < 2) return { newlyCleared: null, stats: st };
  const { rank } = computeStanding(S);
  const hScore = score(S, 0);
  const hRank = rank(0);
  const aRank = rank(1);
  const lvl = S.teams[1].aiLevel || S.settings.aiLevel || 'normal';
  if (hScore > st.bestScore) st.bestScore = hScore;
  let newlyCleared = null;
  if (hRank < aRank) {
    st.wins++;
    st.streak++;
    if (st.streak > st.maxStreak) st.maxStreak = st.streak;
    if (['easy', 'normal', 'hard'].includes(lvl) && !st.cleared[lvl]) {
      st.cleared[lvl] = true;
      newlyCleared = lvl;
    }
  } else if (hRank === aRank) {
    st.draws++;
  } else {
    st.losses++;
    st.streak = 0;
  }
  saveSoloStats(st);
  return { newlyCleared, stats: st };
}

export function soloStatsHTML(st, showReset = false) {
  const hasAny = st.wins || st.draws || st.losses || st.bestScore || st.cleared.easy || st.cleared.normal || st.cleared.hard;
  return `<span>🏅 전적 ${st.wins}승 ${st.draws}무 ${st.losses}패 · 최고 ${st.bestScore}점</span>` +
    `<span class="lvl-badge ${st.cleared.easy ? 'cleared' : ''}">🌱 쉬움${st.cleared.easy ? ' ✓' : ''}</span>` +
    `<span class="lvl-badge ${st.cleared.normal ? 'cleared' : ''}">⚡ 보통${st.cleared.normal ? ' ✓' : ''}</span>` +
    `<span class="lvl-badge ${st.cleared.hard ? 'cleared' : ''}">🔥 어려움${st.cleared.hard ? ' ✓' : ''}</span>` +
    (showReset && hasAny ? '<button type="button" class="stats-reset-btn" data-reset-stats>초기화</button>' : '');
}

let autoNextTimer = null;
let modalLastFocus = null;
let modalOnClose = null;
let qTimer = null;
let cfResolver = null;
let cfLastFocus = null;

export function clearAutoNext() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
}

export function scheduleAutoNext(fn, delay) {
  clearAutoNext();
  autoNextTimer = setTimeout(fn, delay);
}

export function stopTimer() {
  if (qTimer) {
    clearInterval(qTimer);
    qTimer = null;
  }
}

export function startQuestionTimer(fn, intervalMs = 100) {
  stopTimer();
  qTimer = setInterval(fn, intervalMs);
}

export function trapTab(e, root) {
  if (!root) return;
  const els = [...root.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  const cur = document.activeElement;
  if (!root.contains(cur)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
}

export function openModal(html, size = '', type = 'generic', onClose = null) {
  clearAutoNext();
  stopTimer();
  stopSpeak();
  app.modalType = type;
  modalOnClose = typeof onClose === 'function' ? onClose : null;
  if (!$('#modal').classList.contains('show')) modalLastFocus = document.activeElement;
  const b = $('#modal-box');
  b.className = size;
  b.innerHTML = html;
  $('#modal').classList.add('show');
  hydrateImages(b);
  b.scrollTop = 0;
  const firstFocus = b.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]');
  if (firstFocus && firstFocus.offsetParent !== null) firstFocus.focus();
  else b.focus();
  return b;
}

export function closeModal() {
  clearAutoNext();
  stopTimer();
  stopSpeak();
  app.modalType = null;
  const cb = modalOnClose;
  modalOnClose = null;
  $('#modal').classList.remove('show');
  $('#modal-box').innerHTML = '';
  if (modalLastFocus && modalLastFocus.focus && document.contains(modalLastFocus)) modalLastFocus.focus();
  modalLastFocus = null;
  if (cb) cb();
}

export function confirmModal({ title, desc = '', okText = '확인', cancelText = '취소', danger = false }) {
  return new Promise(res => {
    if (cfResolver) { cfResolver(false); cfResolver = null; }
    cfResolver = res;
    cfLastFocus = document.activeElement;
    $('#cf-title').textContent = title;
    $('#cf-desc').textContent = desc;
    $('#cf-desc').classList.toggle('hidden', !desc);
    const okBtn = $('#cf-ok');
    const caBtn = $('#cf-cancel');
    okBtn.textContent = okText;
    caBtn.textContent = cancelText;
    okBtn.className = 'pbtn ' + (danger ? 'bad' : 'gold');
    $('#confirm-modal').classList.add('show');
    okBtn.focus();
  });
}

export function finishConfirm(val) {
  if (!cfResolver) return;
  const r = cfResolver;
  cfResolver = null;
  $('#confirm-modal').classList.remove('show');
  if (cfLastFocus && cfLastFocus.focus && document.contains(cfLastFocus)) cfLastFocus.focus();
  cfLastFocus = null;
  r(val);
}

export const isAISessionAlive = sid => sid === app.gameSession && !!app.S && !app.S.over && $('#screen-game').classList.contains('active') && !!(app.S.teams[app.S.turn] && app.S.teams[app.S.turn].isAI);
export const isPCBusyTurn = () => !!(app.S && !app.S.over && app.S.teams[app.S.turn]?.isAI);

export async function waitConfirmClear(sid) {
  while ($('#confirm-modal').classList.contains('show') && sid === app.gameSession) await sleep(80);
}

export function skipAIWait() {
  app.aiFastTurn = true;
  if (app.aiWaitWake) { const w = app.aiWaitWake; app.aiWaitWake = null; w(); }
}

export function aiWait(ms, reduced) {
  const fastMode = !!(app.S && app.S.settings && app.S.settings.aiFast);
  const dur = app.aiFastTurn ? 35 : (fastMode ? Math.min(reduced, 140) : (isReducedMotion() ? reduced : ms));
  return new Promise(res => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      if (app.aiWaitWake === fin) app.aiWaitWake = null;
      clearTimeout(t);
      res();
    };
    const t = setTimeout(fin, dur);
    app.aiWaitWake = fin;
  });
}

export function saveGame() {
  if (app.S) store('bq_save', app.S);
}

export function teamTag(t) {
  const tm = app.S.teams[t];
  return `${tm.emoji} ${esc(tm.name)}`;
}

export function addLog(msg) {
  if (!app.S) return;
  app.S.log.push(`[${app.S.round}R] ${msg}`);
  if (app.S.log.length > 300) app.S.log.shift();
}

export function pushUndo() {
  if (!app.S || app.S.teams[app.S.turn]?.isAI) return;
  app.undoStack.push(JSON.stringify(app.S));
  if (app.undoStack.length > 40) app.undoStack.shift();
}

export function initSharedUI() {
  $('#modal').addEventListener('click', e => {
    if (e.target === $('#modal') && (app.modalType === 'info' || app.modalType === 'manage' || app.modalType === 'settings')) closeModal();
  });
  $('#cf-ok').onclick = () => finishConfirm(true);
  $('#cf-cancel').onclick = () => finishConfirm(false);
  $('#confirm-modal').addEventListener('click', e => {
    if (e.target === $('#confirm-modal')) finishConfirm(false);
  });
}
