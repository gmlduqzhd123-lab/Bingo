import {
  TEAM_PRESETS,
  EMOJIS,
  DEFAULT_SETTINGS,
  AI_CONF,
  SOLO_MISSIONS,
  MODE_PRESETS,
  REWARDS,
  MISSIONS,
  TEAM_TARGET,
  COMMUNITY_STARTER_SETS
} from './data/sets.js';
import {
  isSafeImageUrl,
  parseQuestions,
  serializeQuestions,
  matchShortAnswer,
  getSpeechSpec,
  makeChosungHint,
  formatRichText
} from './core/questions.js';
import {
  pick,
  shuffle,
  getLines,
  neighbors,
  emptyStats,
  boardN,
  lineOwners,
  tileCount,
  bingoCount,
  score,
  computeStanding,
  validTargets,
  computeReachMap,
  scoreTileForAI,
  chooseAITile,
  computeAwards,
  computeSetStars,
  isCatchupEligible
} from './core/engine.js';
import {
  load,
  store,
  savedSets,
  allSets,
  getSet,
  loadFavorites,
  toggleFavorite,
  loadSoloStats,
  saveSoloStats,
  loadSetMastery,
  recordSetMastery,
  hashSetContent,
  loadMyCloudCodes,
  saveMyCloudCode,
  findReusableCloudCode,
  loadHallOfFame,
  addHallOfFameEntry,
  clearHallOfFame
} from './utils/storage.js';
import {
  AU,
  saveAudio,
  volLabel,
  ac,
  sfx,
  vibrate,
  bgmStart,
  bgmStop,
  setBgmStyle,
  speakText,
  stopSpeak,
  isTtsSupported
} from './utils/audio.js';
import { encodeSetShare, decodeSetShare, makeQRSvg } from './utils/qr.js';
import {
  normalizeCode,
  uploadSharedSet,
  fetchSharedSet,
  submitReviewResult,
  fetchClassAnalytics,
  fetchPublicLibrary,
  publishToPublicLibrary
} from './utils/cloud.js';
import { compressImageFile } from './utils/image.js';
import { createLiveChannel, normalizeRoomCode } from './utils/realtime.js';
import { printQuestionSheet, printBingoBoard } from './ui/print.js';

/* ================= DOM · 공통 도우미 ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isReducedMotion = () => !!(document.body.classList.contains('reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));

function announceLive(msg) {
  const el = $('#sr-live');
  if (el && msg) el.textContent = msg;
}

function applyMotion(reduce) {
  document.body.classList.toggle('reduce-motion', !!reduce);
}

function applyTheme(theme) {
  const t = ['forest', 'ocean', 'space', 'chalkboard'].includes(theme) ? theme : 'forest';
  if (document.body.dataset.theme !== t || !$('#bg').innerHTML) {
    document.body.dataset.theme = t;
    drawBg(t);
  }
}

function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  document.body.classList.toggle('in-game', id === 'game');
  closeMoreMenu();
  closeEmoPicker();
  window.scrollTo(0, 0);
  if (id === 'title') {
    applyTheme(setup.settings.theme);
    applyMotion(setup.settings.reduceMotion);
    refreshTitle();
  }
  if (id === 'game') requestAnimationFrame(renderBingoLines);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  announceLive(msg);
  setTimeout(() => t.remove(), 3300);
}

let busy = false;
let annFinish = null;
function announce(big, small = '', cls = '', ms = 1700) {
  return new Promise(res => {
    busy = true;
    const el = $('#announce');
    el.className = 'show ' + cls;
    el.innerHTML = `<div class="ann-big">${big}</div>${small ? `<div class="ann-small">${small}</div>` : ''}`;
    announceLive(`${big} ${small}`.trim());
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      annFinish = null;
      el.className = '';
      el.onclick = null;
      setTimeout(() => { busy = false; res(); }, 180);
    };
    annFinish = finish;
    el.onclick = finish;
    setTimeout(finish, ms);
  });
}

function confetti(n = 90) {
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

function shakeBoard() {
  if (isReducedMotion()) return;
  const a = $('#arena');
  a.classList.remove('shake-board');
  void a.offsetWidth;
  a.classList.add('shake-board');
  setTimeout(() => a.classList.remove('shake-board'), 500);
}

function downloadCsv(filename, rows) {
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + rows.map(r => r.map(escCsv).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ================= 1인 전적 · 배지 ================= */
function recordSoloResult() {
  const st = loadSoloStats();
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

function soloStatsHTML(st, showReset = false) {
  const hasAny = st.wins || st.draws || st.losses || st.bestScore || st.cleared.easy || st.cleared.normal || st.cleared.hard;
  return `<span>🏅 전적 ${st.wins}승 ${st.draws}무 ${st.losses}패 · 최고 ${st.bestScore}점</span>` +
    `<span class="lvl-badge ${st.cleared.easy ? 'cleared' : ''}">🌱 쉬움${st.cleared.easy ? ' ✓' : ''}</span>` +
    `<span class="lvl-badge ${st.cleared.normal ? 'cleared' : ''}">⚡ 보통${st.cleared.normal ? ' ✓' : ''}</span>` +
    `<span class="lvl-badge ${st.cleared.hard ? 'cleared' : ''}">🔥 어려움${st.cleared.hard ? ' ✓' : ''}</span>` +
    (showReset && hasAny ? '<button type="button" class="stats-reset-btn" data-reset-stats>초기화</button>' : '');
}

/* ================= 모달 · 커스텀 확인창 ================= */
let modalType = null;
let autoNextTimer = null;
let modalLastFocus = null;
let modalOnClose = null;
let qTimer = null;

function clearAutoNext() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
}

function stopTimer() {
  if (qTimer) {
    clearInterval(qTimer);
    qTimer = null;
  }
}

function trapTab(e, root) {
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

function openModal(html, size = '', type = 'generic', onClose = null) {
  clearAutoNext();
  stopTimer();
  stopSpeak();
  modalType = type;
  modalOnClose = typeof onClose === 'function' ? onClose : null;
  if (!$('#modal').classList.contains('show')) modalLastFocus = document.activeElement;
  const b = $('#modal-box');
  b.className = size;
  b.innerHTML = html;
  $('#modal').classList.add('show');
  b.scrollTop = 0;
  const firstFocus = b.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]');
  if (firstFocus && firstFocus.offsetParent !== null) firstFocus.focus();
  else b.focus();
  return b;
}

function closeModal() {
  clearAutoNext();
  stopTimer();
  stopSpeak();
  modalType = null;
  const cb = modalOnClose;
  modalOnClose = null;
  $('#modal').classList.remove('show');
  $('#modal-box').innerHTML = '';
  if (modalLastFocus && modalLastFocus.focus && document.contains(modalLastFocus)) modalLastFocus.focus();
  modalLastFocus = null;
  if (cb) cb();
}

$('#modal').addEventListener('click', e => {
  if (e.target === $('#modal') && (modalType === 'info' || modalType === 'manage' || modalType === 'settings')) closeModal();
});

let cfResolver = null;
let cfLastFocus = null;
function confirmModal({ title, desc = '', okText = '확인', cancelText = '취소', danger = false }) {
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

function finishConfirm(val) {
  if (!cfResolver) return;
  const r = cfResolver;
  cfResolver = null;
  $('#confirm-modal').classList.remove('show');
  if (cfLastFocus && cfLastFocus.focus && document.contains(cfLastFocus)) cfLastFocus.focus();
  cfLastFocus = null;
  r(val);
}

$('#cf-ok').onclick = () => finishConfirm(true);
$('#cf-cancel').onclick = () => finishConfirm(false);
$('#confirm-modal').addEventListener('click', e => { if (e.target === $('#confirm-modal')) finishConfirm(false); });

/* ================= 설정 화면 & 카드형 문제 세트 선택 ================= */
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

function saveSetup() {
  store('bq_setup', setup);
}

let setFilter = 'all';
let setQuery = '';

function isPresetMatch(p) {
  return Object.entries(p.vals).every(([k, v]) => setup.settings[k] === v);
}

function renderPresets() {
  $('#preset-bar').innerHTML = MODE_PRESETS.map(p => `<button type="button" class="preset-btn ${isPresetMatch(p) ? 'on' : ''}" data-preset="${p.id}"><b>${p.label}</b><small>${p.desc}</small></button>`).join('');
}

function setAdvOpen(open) {
  $('#adv-panel').classList.toggle('hidden', !open);
  $('#btn-adv').setAttribute('aria-expanded', String(!!open));
  $('#adv-arrow').textContent = open ? '▴' : '▾';
}
$('#btn-adv').onclick = () => { sfx('click'); setAdvOpen($('#adv-panel').classList.contains('hidden')); };

let emoTargetIdx = null;
function closeEmoPicker() { emoTargetIdx = null; $('#emo-picker').classList.remove('show'); }
function openEmoPicker(k, btn) {
  if (emoTargetIdx === k && $('#emo-picker').classList.contains('show')) { closeEmoPicker(); return; }
  emoTargetIdx = k;
  const pk = $('#emo-picker');
  if (k === 'solo') {
    const cur = setup.solo.emoji || '🦊';
    pk.innerHTML = `<div class="emo-grid">${EMOJIS.map(e => `<button type="button" class="emo-opt ${e === cur ? 'cur' : ''}" data-pickemo="${e}">${e}</button>`).join('')}</div>`;
  } else {
    const activeTeams = setup.teams.slice(0, setup.settings.teamCount);
    pk.innerHTML = `<div class="emo-grid">${EMOJIS.map(e => {
      const owner = activeTeams.findIndex(t => t.emoji === e);
      return `<button type="button" class="emo-opt ${owner === k ? 'cur' : ''}" data-pickemo="${e}" title="${owner >= 0 ? `${owner + 1}팀 사용 중 (누르면 서로 바꿈)` : '선택'}">${e}${owner >= 0 && owner !== k ? `<span class="used-tag">${owner + 1}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  pk.classList.add('show');
  const r = btn.getBoundingClientRect();
  const w = pk.offsetWidth || 280;
  const h = pk.offsetHeight || 210;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
  const top = r.bottom + h + 10 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6);
  pk.style.left = left + 'px';
  pk.style.top = top + 'px';
}

$('#emo-picker').addEventListener('click', e => {
  const b = e.target.closest('[data-pickemo]');
  if (!b || emoTargetIdx == null) return;
  const chosen = b.dataset.pickemo;
  const k = emoTargetIdx;
  if (k === 'solo') {
    setup.solo.emoji = chosen;
  } else {
    const other = setup.teams.slice(0, setup.settings.teamCount).findIndex((t, idx) => idx !== k && t.emoji === chosen);
    if (other >= 0) setup.teams[other].emoji = setup.teams[k].emoji;
    setup.teams[k].emoji = chosen;
  }
  sfx('click');
  saveSetup();
  closeEmoPicker();
  renderSetup();
});

document.addEventListener('click', e => {
  if ($('#emo-picker').classList.contains('show') && !e.target.closest('#emo-picker') && !e.target.closest('[data-emo]')) closeEmoPicker();
});

function renderSetPicker() {
  const st = setup.settings;
  const sets = allSets();
  if (!sets.some(s => s.id === st.setId)) st.setId = 'sample';
  $('#set-select').innerHTML = sets.map(s => `<option value="${esc(s.id)}" ${s.id === st.setId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  const favs = loadFavorites();
  const mastery = loadSetMastery();
  const filterTabs = [
    { id: 'all', label: '전체' },
    { id: 'fav', label: `⭐ 즐겨찾기${favs.length ? ` (${favs.length})` : ''}` },
    { id: '상식', label: '상식' },
    { id: '수학', label: '수학' },
    { id: '사회', label: '사회' },
    { id: '국어', label: '국어' },
    { id: '영어', label: '영어' },
    { id: 'custom', label: '내 세트' }
  ];
  $('#set-filters').innerHTML = filterTabs.map(f => `<button type="button" class="set-filter-btn ${setFilter === f.id ? 'on' : ''}" data-sfilter="${f.id}">${f.label}</button>`).join('');

  const q = setQuery.trim().toLowerCase();
  const filtered = sets.filter(s => {
    if (setFilter === 'fav' && !favs.includes(s.id)) return false;
    if (setFilter === 'custom' && s.builtin) return false;
    if (['상식', '수학', '사회', '국어', '영어'].includes(setFilter) && s.subject !== setFilter) return false;
    if (q) {
      const hay = `${s.name} ${s.subject || ''} ${s.grade || ''} ${s.shareCode || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const ordered = [...filtered].sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0));
  $('#set-cards').innerHTML = ordered.length
    ? ordered.map(s => {
        const cnt = parseQuestions(s.text).list.length;
        const isFav = favs.includes(s.id);
        const m = mastery[s.id];
        const starsHtml = m && m.stars ? `<span class="set-stars" title="최고 ${m.bestScore}점">${'★'.repeat(m.stars)}${'☆'.repeat(3 - m.stars)}</span>` : '';
        const tag = s.builtin ? `${s.subject || '기본'}${s.grade ? '·' + s.grade : ''}` : (s.shareCode ? `☁️ ${s.shareCode}` : '내 세트');
        return `
          <div class="set-card ${s.id === st.setId ? 'on' : ''}" data-pickset="${esc(s.id)}" role="button" tabindex="0">
            <button type="button" class="set-pin ${isFav ? 'on' : ''}" data-pin="${esc(s.id)}" title="${isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}" aria-label="즐겨찾기">${isFav ? '⭐' : '☆'}</button>
            <div class="set-card-title">${esc(s.name)}</div>
            <div class="set-card-meta"><span>${esc(tag)}</span><span>· ${cnt}문제</span>${starsHtml}</div>
          </div>`;
      }).join('')
    : '<div class="hint" style="grid-column:1/-1;text-align:center;padding:14px">조건에 맞는 문제 세트가 없어요.</div>';
}

function renderSetup() {
  const st = setup.settings;
  applyTheme(st.theme);
  applyMotion(st.reduceMotion);
  renderPresets();
  const isSolo = st.playMode === 'solo';
  $('#play-mode').innerHTML = [
    { id: 'solo', label: '🤖 1인 vs PC' },
    { id: 'team2', label: '👥 2팀' },
    { id: 'team3', label: '👥 3팀' },
    { id: 'team4', label: '👥 4팀' },
    { id: 'team5', label: '👥 5팀' },
    { id: 'team6', label: '👥 6팀' }
  ].map(m => {
    const on = m.id === 'solo' ? isSolo : (!isSolo && st.teamCount === +m.id.slice(4));
    return `<button type="button" data-mode="${m.id}" class="${on ? 'on' : ''}">${m.label}</button>`;
  }).join('');
  $('#solo-box').classList.toggle('hidden', !isSolo);
  $('#team-box').classList.toggle('hidden', isSolo);
  if (isSolo) {
    $('#ai-level').innerHTML = [
      { id: 'easy', label: '🌱 쉬움' },
      { id: 'normal', label: '⚡ 보통' },
      { id: 'hard', label: '🔥 어려움' }
    ].map(l => `<button type="button" data-ailevel="${l.id}" class="${st.aiLevel === l.id ? 'on' : ''}">${l.label}</button>`).join('');
    $('#solo-row').innerHTML = `
      <div class="team-row" style="--c:${TEAM_PRESETS[0].color}">
        <button type="button" class="emo" data-emo="solo" title="캐릭터 고르기">${setup.solo.emoji || '🦊'}</button>
        <input data-soloname maxlength="8" value="${esc(setup.solo.name)}" placeholder="나">
        <span class="vs-pc-pill">VS 🤖 PC</span>
      </div>`;
    $('#solo-stats-bar').innerHTML = soloStatsHTML(loadSoloStats(), true);
  } else {
    $('#team-rows').innerHTML = setup.teams.slice(0, st.teamCount).map((t, k) => `
      <div class="team-row" style="--c:${TEAM_PRESETS[k].color}">
        <span class="dot"></span>
        <button type="button" class="emo" data-emo="${k}" title="캐릭터 고르기">${t.emoji}</button>
        <input data-tname="${k}" maxlength="8" value="${esc(t.name)}" placeholder="${TEAM_PRESETS[k].name}">
      </div>`).join('');
  }

  renderSetPicker();

  const p = parseQuestions(getSet(st.setId).text).list;
  const mc = p.filter(q => q.opts).length;
  const info = $('#set-info');
  const nSide = [3, 4, 5].includes(st.boardSize) ? st.boardSize : 5;
  const total = nSide * nSide;
  let html = `총 <b>${p.length}문제</b> (객관식 ${mc} · 주관식 ${p.length - mc})`;
  info.classList.toggle('warn', p.length < total);
  if (p.length > total) html += `<br>${nSide}×${nSide} 빙고판에는 ${st.shuffle ? '무작위로 고른' : '앞에서부터'} ${total}문제가 올라가요.`;
  else if (p.length < total) html += `<br>⚠️ ${total}문제보다 적어요. 남는 <b>${total - p.length}칸</b>은 문제 없이 바로 차지하는 🍀 행운 칸이 돼요.`;
  else html += `<br>딱 ${total}칸에 맞아요! 👍`;
  info.innerHTML = html;

  $('#board-size-seg').innerHTML = [
    { n: 3, label: '3×3 (9칸 · 5분)' },
    { n: 4, label: '4×4 (16칸 · 빠름)' },
    { n: 5, label: '5×5 (25칸 · 기본)' }
  ].map(b => `<button type="button" data-bsize="${b.n}" class="${nSide === b.n ? 'on' : ''}">${b.label}</button>`).join('');

  const themeNames = { forest: '가을 숲', ocean: '바닷속', space: '우주', chalkboard: '칠판 다크' };
  const disCnt = (st.disabledRewards || []).length;
  $('#adv-summary').textContent = `${st.tilePts}점·빙고${st.bingoPts}점${st.bingoGoal ? '·목표' + st.bingoGoal + '줄' : ''} · ${st.rewards ? (disCnt ? `보상(제외${disCnt})` : '보상 ON') : '보상 OFF'} · ${st.timer ? st.timer + '초' : '시간 무제한'} · ${themeNames[st.theme] || '가을 숲'}`;
  $$('[data-opt]').forEach(el => {
    const k = el.dataset.opt;
    if (el.type === 'checkbox') el.checked = !!st[k];
    else el.value = String(st[k]);
  });
  $('#o-penalties').disabled = !st.rewards;
  $('#o-strong').disabled = !st.rewards;
  $('#btn-rw-custom').disabled = !st.rewards;
}

function openRewardCustomizerModal() {
  const dis = new Set(setup.settings.disabledRewards || []);
  openModal(`
    <p class="m-title">🃏 보상 카드 세부 선택</p>
    <p class="m-desc">수업에서 빼고 싶은 보상·벌칙 카드를 체크 해제하세요.</p>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px">
      <button type="button" class="pbtn sm white" id="rwc-all">✅ 전체 사용</button>
      <button type="button" class="pbtn sm white" id="rwc-peace">🕊️ 뺏기·폭탄 빼기</button>
      <button type="button" class="pbtn sm white" id="rwc-nobad">🌈 벌칙 카드 모두 빼기</button>
    </div>
    <div class="rw-custom-grid">
      ${REWARDS.map(r => `<label class="rw-custom-item"><input type="checkbox" data-rwc="${r.id}" ${dis.has(r.id) ? '' : 'checked'}><span>${r.icon} ${r.name}${r.kind === 'bad' ? ' <small>(벌칙)</small>' : ''}${r.strong ? ' <small>(강력)</small>' : ''}</span></label>`).join('')}
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">적용하고 닫기</button></div>`, 'wide', 'info');
  const syncFromChecks = () => {
    const disabled = $$('[data-rwc]').filter(c => !c.checked).map(c => c.dataset.rwc);
    setup.settings.disabledRewards = disabled;
    saveSetup();
    renderSetup();
  };
  $$('[data-rwc]').forEach(c => c.addEventListener('change', syncFromChecks));
  $('#rwc-all').onclick = () => { $$('[data-rwc]').forEach(c => { c.checked = true; }); syncFromChecks(); };
  $('#rwc-peace').onclick = () => {
    const peaceBan = new Set(['steal', 'swap', 'bomb', 'stealPts', 'scoreSwap', 'freezeOther']);
    $$('[data-rwc]').forEach(c => { c.checked = !peaceBan.has(c.dataset.rwc); });
    syncFromChecks();
  };
  $('#rwc-nobad').onclick = () => {
    const badIds = new Set(REWARDS.filter(r => r.kind === 'bad').map(r => r.id));
    $$('[data-rwc]').forEach(c => { c.checked = !badIds.has(c.dataset.rwc); });
    syncFromChecks();
  };
  $('#m-close').onclick = closeModal;
}
$('#btn-rw-custom').onclick = () => { sfx('click'); openRewardCustomizerModal(); };

$('#set-search').addEventListener('input', e => {
  setQuery = e.target.value;
  renderSetPicker();
});
$('#set-filters').addEventListener('click', e => {
  const b = e.target.closest('[data-sfilter]');
  if (!b) return;
  sfx('click');
  setFilter = b.dataset.sfilter;
  renderSetPicker();
});
$('#set-cards').addEventListener('click', e => {
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    e.stopPropagation();
    sfx('click');
    toggleFavorite(pin.dataset.pin);
    renderSetPicker();
    return;
  }
  const card = e.target.closest('[data-pickset]');
  if (!card) return;
  sfx('click');
  setup.settings.setId = card.dataset.pickset;
  saveSetup();
  renderSetup();
});
$('#set-cards').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const card = e.target.closest('[data-pickset]');
    if (card && !e.target.closest('[data-pin]')) {
      e.preventDefault();
      card.click();
    }
  }
});

$('#preset-bar').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const p = MODE_PRESETS.find(x => x.id === b.dataset.preset);
  if (!p) return;
  sfx('click');
  Object.assign(setup.settings, p.vals);
  saveSetup();
  renderSetup();
  toast(`${p.label} 설정을 적용했어요`);
});
$('#play-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  sfx('click');
  const m = b.dataset.mode;
  if (m === 'solo') setup.settings.playMode = 'solo';
  else { setup.settings.playMode = 'team'; setup.settings.teamCount = +m.slice(4); }
  saveSetup();
  closeEmoPicker();
  renderSetup();
});
$('#ai-level').addEventListener('click', e => {
  const b = e.target.closest('[data-ailevel]');
  if (!b) return;
  sfx('click');
  setup.settings.aiLevel = b.dataset.ailevel;
  saveSetup();
  renderSetup();
});
$('#board-size-seg').addEventListener('click', e => {
  const b = e.target.closest('[data-bsize]');
  if (!b) return;
  sfx('click');
  setup.settings.boardSize = +b.dataset.bsize;
  saveSetup();
  renderSetup();
});
$('#solo-row').addEventListener('click', e => { const b = e.target.closest('[data-emo]'); if (!b) return; sfx('click'); openEmoPicker('solo', b); });
$('#solo-row').addEventListener('input', e => { if (!e.target.hasAttribute('data-soloname')) return; setup.solo.name = e.target.value; saveSetup(); });
$('#solo-stats-bar').addEventListener('click', async e => {
  if (!e.target.closest('[data-reset-stats]')) return;
  if (!(await confirmModal({ title: '1인 전적을 초기화할까요?', desc: '승·무·패 기록과 난이도 정복 배지가 모두 지워집니다.', okText: '초기화', danger: true }))) return;
  saveSoloStats({ wins: 0, draws: 0, losses: 0, bestScore: 0, streak: 0, maxStreak: 0, cleared: { easy: false, normal: false, hard: false } });
  sfx('click');
  renderSetup();
  toast('1인 전적을 초기화했어요');
});
$('#team-rows').addEventListener('click', e => {
  const b = e.target.closest('[data-emo]');
  if (!b) return;
  sfx('click');
  openEmoPicker(+b.dataset.emo, b);
});
$('#team-rows').addEventListener('input', e => {
  const k = e.target.dataset.tname;
  if (k == null) return;
  setup.teams[+k].name = e.target.value;
  saveSetup();
});
$('#set-select').addEventListener('change', e => { setup.settings.setId = e.target.value; saveSetup(); renderSetup(); });
$$('[data-opt]').forEach(el => el.addEventListener('change', () => {
  const k = el.dataset.opt;
  setup.settings[k] = el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value);
  if (k === 'bgmStyle') setBgmStyle(setup.settings.bgmStyle);
  saveSetup();
  renderSetup();
}));

/* ================= 문제 세트 편집 화면 ================= */
let editingId = null;
let editorBack = 'title';
let edMode = 'text';
let edSnapshot = '';
let cardList = [];
let dragCardIdx = -1;
let imgUploadIdx = -1;

const currentEdSnap = () => $('#ed-name').value + '\0' + $('#ed-text').value;
const isEdDirty = () => currentEdSnap() !== edSnapshot;
function refreshDirty() { $('#ed-dirty').classList.toggle('hidden', !isEdDirty()); }

function setEditorMode(mode) {
  edMode = mode;
  $$('[data-edmode]').forEach(b => b.classList.toggle('on', b.dataset.edmode === mode));
  $('#ed-text-wrap').classList.toggle('hidden', mode !== 'text');
  $('#ed-cards-wrap').classList.toggle('hidden', mode !== 'cards');
  if (mode === 'cards') { loadCardsFromText(); renderCardEditor(); }
}

function loadCardsFromText() {
  cardList = parseQuestions($('#ed-text').value).list.map(x => ({
    q: x.q,
    a: x.a,
    isMc: !!x.opts,
    w1: x.opts && x.opts[1] ? x.opts[1] : '',
    w2: x.opts && x.opts[2] ? x.opts[2] : '',
    w3: x.opts && x.opts[3] ? x.opts[3] : '',
    extraWrong: x.opts && x.opts.length > 4 ? x.opts.slice(4) : [],
    explain: x.explain || '',
    img: x.img || '',
    selected: false
  }));
}

function renderCardEditor() {
  const wrap = $('#ed-cards');
  if (!cardList.length) {
    wrap.innerHTML = '<div class="hint" style="padding:12px;text-align:center">아직 문제가 없어요. 아래 <b>➕ 새 문제 추가</b> 버튼을 눌러 보세요.</div>';
    return;
  }
  wrap.innerHTML = cardList.map((c, idx) => {
    const inc = !(c.q.trim() && c.a.trim());
    const canAddOpt = c.isMc && (3 + (c.extraWrong || []).length) < 5;
    const validImg = c.img && isSafeImageUrl(c.img);
    return `
    <div class="ed-card${inc ? ' incomplete' : ''}" data-ci="${idx}" draggable="true">
      <div class="ed-card-top">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" class="ed-card-chk" data-csel="${idx}" ${c.selected ? 'checked' : ''} aria-label="${idx + 1}번 선택">
          <span class="ed-drag" title="끌어서 순서 바꾸기">⠿</span>
          <b>#${idx + 1}</b>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <button type="button" class="pbtn sm white" data-cpreview="${idx}" title="실제 화면 미리보기">👁️</button>
          <button type="button" class="pbtn sm white" data-cmove="${idx}:-1" ${idx === 0 ? 'disabled' : ''} title="위로 이동">▲</button>
          <button type="button" class="pbtn sm white" data-cmove="${idx}:1" ${idx === cardList.length - 1 ? 'disabled' : ''} title="아래로 이동">▼</button>
          <select data-cf="type"><option value="mc" ${c.isMc ? 'selected' : ''}>객관식</option><option value="sa" ${!c.isMc ? 'selected' : ''}>주관식</option></select>
          <button type="button" class="pbtn sm bad" data-cdel="${idx}" title="삭제">🗑️</button>
        </div>
      </div>
      <input data-cf="q" value="${esc(c.q)}" placeholder="문제를 입력하세요 (**강조**, ____ 빈칸, ^2 위첨자)">
      <input data-cf="a" value="${esc(c.a)}" placeholder="정답을 입력하세요">
      ${c.isMc ? `<div class="ed-card-opts">
        <input data-cf="w1" value="${esc(c.w1)}" placeholder="오답 1">
        <input data-cf="w2" value="${esc(c.w2)}" placeholder="오답 2">
        <input data-cf="w3" value="${esc(c.w3)}" placeholder="오답 3">
        ${(c.extraWrong || []).map((w, j) => `<input data-cex="${j}" value="${esc(w)}" placeholder="오답 ${j + 4}">`).join('')}
      </div>` : ''}
      <input data-cf="explain" value="${esc(c.explain)}" placeholder="해설 (선택)">
      <div class="ed-img-row">
        <input data-cf="img" value="${esc(c.img || '')}" placeholder="그림 URL 또는 Ctrl+V / 🖼️ 파일 올리기 (선택)">
        <button type="button" class="pbtn sm white" data-cimgup="${idx}" title="컴퓨터에서 그림 파일 올리기">🖼️</button>
        ${validImg ? `<button type="button" class="pbtn sm bad" data-cimgclr="${idx}" title="그림 지우기">✕</button>` : ''}
      </div>
      ${validImg ? `<img class="ed-img-thumb" src="${esc(c.img)}" alt="첨부 그림 미리보기" onerror="this.style.display='none'">` : ''}
      <div class="ed-card-foot">
        <div class="ed-card-warn${inc ? '' : ' hidden'}">⚠️ 문제와 정답을 모두 입력해야 저장돼요</div>
        ${canAddOpt ? `<button type="button" class="pbtn sm white" data-caddopt="${idx}">+ 오답 추가</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function syncCardsToText() {
  const valid = cardList.filter(c => c.q.trim() && c.a.trim()).map(c => ({
    q: c.q.trim(),
    a: c.a.trim(),
    opts: c.isMc ? [c.a.trim(), c.w1.trim(), c.w2.trim(), c.w3.trim(), ...(c.extraWrong || []).map(x => x.trim())].filter(Boolean) : null,
    explain: c.explain.trim(),
    img: isSafeImageUrl(c.img) ? c.img.trim() : ''
  }));
  $('#ed-text').value = serializeQuestions(valid);
  updateEdStatus();
}

$('#ed-cards').addEventListener('dragstart', e => {
  const card = e.target.closest('.ed-card');
  if (!card) return;
  dragCardIdx = +card.dataset.ci;
  card.classList.add('dragging');
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});
$('#ed-cards').addEventListener('dragover', e => {
  e.preventDefault();
  const card = e.target.closest('.ed-card');
  $$('.ed-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (card && +card.dataset.ci !== dragCardIdx) card.classList.add('drag-over');
});
$('#ed-cards').addEventListener('drop', e => {
  e.preventDefault();
  const card = e.target.closest('.ed-card');
  $$('.ed-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (!card || dragCardIdx < 0) return;
  const toIdx = +card.dataset.ci;
  if (toIdx !== dragCardIdx && toIdx >= 0 && toIdx < cardList.length) {
    const [moved] = cardList.splice(dragCardIdx, 1);
    cardList.splice(toIdx, 0, moved);
    syncCardsToText();
    renderCardEditor();
  }
  dragCardIdx = -1;
});
$('#ed-cards').addEventListener('dragend', () => {
  dragCardIdx = -1;
  $$('.ed-card.dragging, .ed-card.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
});

$('#ed-cards').addEventListener('paste', async e => {
  const card = e.target.closest('.ed-card');
  if (!card) return;
  const items = e.clipboardData && [...(e.clipboardData.items || [])];
  const imgItem = items && items.find(it => it.type && it.type.startsWith('image/'));
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  try {
    const dataUrl = await compressImageFile(file);
    cardList[+card.dataset.ci].img = dataUrl;
    syncCardsToText();
    renderCardEditor();
    toast('🖼️ 클립보드 그림을 압축해 넣었어요!');
  } catch {
    toast('⚠️ 그림을 처리하지 못했어요 (파일 크기/형식 확인)');
  }
});

$('#ed-img-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || imgUploadIdx < 0 || !cardList[imgUploadIdx]) return;
  try {
    const dataUrl = await compressImageFile(f);
    cardList[imgUploadIdx].img = dataUrl;
    syncCardsToText();
    renderCardEditor();
    toast('🖼️ 그림을 첨부했어요!');
  } catch {
    toast('⚠️ 이미지 파일만 올릴 수 있어요');
  } finally {
    imgUploadIdx = -1;
  }
});

$('#ed-cards').addEventListener('input', e => {
  const card = e.target.closest('.ed-card');
  if (!card) return;
  const ci = +card.dataset.ci;
  if (e.target.dataset.cex != null) {
    cardList[ci].extraWrong = cardList[ci].extraWrong || [];
    cardList[ci].extraWrong[+e.target.dataset.cex] = e.target.value;
    syncCardsToText();
    return;
  }
  const f = e.target.dataset.cf;
  if (!f || f === 'type') return;
  cardList[ci][f] = e.target.value;
  const c = cardList[ci];
  const inc = !(c.q.trim() && c.a.trim());
  card.classList.toggle('incomplete', inc);
  const w = card.querySelector('.ed-card-warn');
  if (w) w.classList.toggle('hidden', !inc);
  syncCardsToText();
});
$('#ed-cards').addEventListener('change', e => {
  const card = e.target.closest('.ed-card');
  if (!card) return;
  const ci = +card.dataset.ci;
  if (e.target.dataset.csel != null) {
    cardList[ci].selected = e.target.checked;
    return;
  }
  if (e.target.dataset.cf === 'type') {
    cardList[ci].isMc = e.target.value === 'mc';
    syncCardsToText();
    renderCardEditor();
  }
});
$('#ed-cards').addEventListener('click', e => {
  const iu = e.target.closest('[data-cimgup]');
  if (iu) {
    imgUploadIdx = +iu.dataset.cimgup;
    $('#ed-img-file').click();
    return;
  }
  const ic = e.target.closest('[data-cimgclr]');
  if (ic) {
    cardList[+ic.dataset.cimgclr].img = '';
    syncCardsToText();
    renderCardEditor();
    return;
  }
  const pv = e.target.closest('[data-cpreview]');
  if (pv) {
    const c = cardList[+pv.dataset.cpreview];
    if (!c || !c.q.trim()) { toast('먼저 문제를 입력해 주세요'); return; }
    const opts = c.isMc ? [c.a, c.w1, c.w2, c.w3, ...(c.extraWrong || [])].map(x => x.trim()).filter(Boolean) : null;
    openQuestionPreview({ q: c.q, a: c.a, opts: opts && opts.length > 1 ? opts : null, explain: c.explain, img: c.img }, +pv.dataset.cpreview + 1);
    return;
  }
  const ao = e.target.closest('[data-caddopt]');
  if (ao) {
    const idx = +ao.dataset.caddopt;
    const c = cardList[idx];
    c.extraWrong = c.extraWrong || [];
    if (c.extraWrong.length < 2) {
      c.extraWrong.push('');
      renderCardEditor();
      const inp = $(`.ed-card[data-ci="${idx}"] input[data-cex="${c.extraWrong.length - 1}"]`);
      if (inp) inp.focus();
    }
    return;
  }
  const mv = e.target.closest('[data-cmove]');
  if (mv) {
    const [idx, dir] = mv.dataset.cmove.split(':').map(Number);
    const to = idx + dir;
    if (to >= 0 && to < cardList.length) {
      [cardList[idx], cardList[to]] = [cardList[to], cardList[idx]];
      syncCardsToText();
      renderCardEditor();
    }
    return;
  }
  const b = e.target.closest('[data-cdel]');
  if (!b) return;
  cardList.splice(+b.dataset.cdel, 1);
  syncCardsToText();
  renderCardEditor();
});

$('#ed-sel-all').onclick = () => {
  if (!cardList.length) return;
  const allOn = cardList.every(c => c.selected);
  cardList.forEach(c => { c.selected = !allOn; });
  renderCardEditor();
};
$('#ed-shuffle-cards').onclick = () => {
  if (cardList.length < 2) return;
  shuffle(cardList);
  syncCardsToText();
  renderCardEditor();
  toast('🔀 카드 순서를 무작위로 섞었어요');
};
$('#ed-del-selected').onclick = async () => {
  const n = cardList.filter(c => c.selected).length;
  if (!n) { toast('삭제할 카드를 먼저 체크해 주세요'); return; }
  if (!(await confirmModal({ title: `선택한 ${n}개 문제를 삭제할까요?`, okText: '삭제', danger: true }))) return;
  cardList = cardList.filter(c => !c.selected);
  syncCardsToText();
  renderCardEditor();
  toast(`🗑️ ${n}개 문제를 삭제했어요`);
};

$('#ed-add-card').onclick = () => {
  cardList.push({ q: '', a: '', isMc: true, w1: '', w2: '', w3: '', extraWrong: [], explain: '', img: '', selected: false });
  renderCardEditor();
  const last = $('#ed-cards .ed-card:last-child input[data-cf="q"]');
  if (last) { last.focus(); last.scrollIntoView({ block: 'nearest' }); }
};
$$('[data-edmode]').forEach(b => b.onclick = async () => {
  const target = b.dataset.edmode;
  if (target === edMode) return;
  if (edMode === 'cards' && target === 'text') {
    const hasAny = c => !!(c.q.trim() || c.a.trim() || c.w1.trim() || c.w2.trim() || c.w3.trim() || (c.extraWrong || []).some(x => x.trim()) || c.explain.trim() || (c.img || '').trim());
    const inc = cardList.filter(c => hasAny(c) && !(c.q.trim() && c.a.trim()));
    if (inc.length && !(await confirmModal({ title: `미완성 카드 ${inc.length}개가 있어요`, desc: '문제와 정답이 모두 채워지지 않은 카드는 텍스트 편집으로 넘어가면 제외됩니다. 계속할까요?', okText: '제외하고 전환', danger: true }))) return;
  }
  setEditorMode(target);
});

function openQuestionPreview(item, num) {
  const opts = item.opts ? [...item.opts] : null;
  const spec = getSpeechSpec(item.q);
  const ttsBtn = isTtsSupported() ? `<button type="button" class="q-tts-btn" id="q-tts" title="문제 읽어주기">🔊 읽기</button>` : '';
  const imgHtml = item.img && isSafeImageUrl(item.img) ? `<img class="q-img" src="${esc(item.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';
  openModal(`
    <div class="q-head" style="--c:#2f7de1">
      <span>👁️ 문제 미리보기</span>
      <div class="q-head-r">${ttsBtn}<span class="q-no">#${num}번</span></div>
    </div>
    ${imgHtml}
    <div class="q-text${item.q.length > 65 ? ' long' : ''}">${formatRichText(item.q)}</div>
    ${opts ? `<div class="q-opts">${opts.map((o, k) => `<button type="button" class="q-opt ${o === item.a ? 'right' : ''}" disabled><b>${'①②③④⑤⑥'[k]}</b>${formatRichText(o)}</button>`).join('')}</div>`
      : `<div class="q-answer show">정답: <b>${formatRichText(item.a)}</b></div>`}
    ${item.explain ? `<div class="q-explain">💡 <b>해설:</b> ${formatRichText(item.explain)}</div>` : ''}
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, '', 'info');
  if ($('#q-tts')) $('#q-tts').onclick = () => speakText(spec.text, spec.lang, setup.settings.ttsRate || 1);
  $('#m-close').onclick = closeModal;
}

function openEditor(from) {
  editorBack = from;
  show('editor');
  setEditorMode('text');
  renderSetList();
  renderPrompt();
  if (!$('#ed-text').value.trim()) loadIntoEditor(null);
  else updateEdStatus();
}

function loadIntoEditor(id) {
  const s = id ? getSet(id) : null;
  editingId = s && !s.builtin ? s.id : null;
  $('#ed-name').value = s ? (s.builtin ? s.name.replace(/\s*\(.*\)$/, '') + ' (복사본)' : s.name) : '';
  $('#ed-text').value = s ? s.text : '';
  edSnapshot = currentEdSnap();
  updateEdStatus();
  if (edMode === 'cards') { loadCardsFromText(); renderCardEditor(); }
}

function updateEdStatus() {
  const { list, errors } = parseQuestions($('#ed-text').value);
  const st = $('#ed-status');
  const mc = list.filter(q => q.opts).length;
  const nSide = [3, 4, 5].includes(setup.settings.boardSize) ? setup.settings.boardSize : 5;
  const targetN = nSide * nSide;
  const seen = new Map();
  const dups = [];
  list.forEach((q, idx) => {
    const k = q.q.toLowerCase().replace(/\s+/g, '');
    if (!k) return;
    if (seen.has(k)) dups.push([seen.get(k), idx + 1]);
    else seen.set(k, idx + 1);
  });
  let h = list.length ? `✅ 읽은 문제 <b>${list.length}개</b> (객관식 ${mc} · 주관식 ${list.length - mc})` : '아직 읽은 문제가 없어요. 형식에 맞춰 문제를 넣어 주세요.';
  if (list.length && list.length < targetN) h += ` · ${targetN}개(${nSide}×${nSide})보다 적으면 남는 칸은 🍀 행운 칸이 돼요`;
  if (dups.length) h += `<div class="ed-dup">⚠️ 중복된 문제가 ${dups.length}개 있어요 (${dups.slice(0, 3).map(d => `${d[0]}번=${d[1]}번`).join(', ')}${dups.length > 3 ? '…' : ''})</div>`;
  if (errors.length) h += errors.slice(0, 4).map(e => `<button type="button" class="ed-err" data-line="${e.line}">⚠️ ${esc(e.msg)}</button>`).join('') + (errors.length > 4 ? `<div style="margin-top:4px;font-size:12.5px">…외 ${errors.length - 4}줄</div>` : '');
  st.innerHTML = h;
  st.classList.toggle('warn', !list.length || errors.length > 0);
  $('#ed-preview').innerHTML = list.map((q, i) => `<div><span class="tag ${q.opts ? '' : 's'}">${q.opts ? '객관식' : '주관식'}</span><b>${i + 1}.</b> ${formatRichText(q.q)} → <b>${formatRichText(q.a)}</b>${q.opts ? ` <span style="color:var(--muted)">(오답: ${q.opts.slice(1).map(esc).join(', ')})</span>` : ''}${q.explain ? ` <span style="color:#2563eb">[해설: ${esc(q.explain)}]</span>` : ''}${q.img ? ` <span style="color:#059669">[🖼️ 그림]</span>` : ''}</div>`).join('');
  $('#ed-preview').classList.toggle('hidden', !list.length);
  refreshDirty();
}

window.addEventListener('beforeunload', e => {
  if ($('#screen-editor').classList.contains('active') && isEdDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

$('#ed-status').addEventListener('click', e => {
  const b = e.target.closest('.ed-err');
  if (!b) return;
  const line = +b.dataset.line;
  if (!line) return;
  if (edMode !== 'text') setEditorMode('text');
  const ta = $('#ed-text');
  const lines = ta.value.split('\n');
  let start = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) start += lines[i].length + 1;
  const end = start + (lines[line - 1] || '').length;
  ta.focus();
  ta.setSelectionRange(start, end);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  ta.scrollTop = Math.max(0, (line - 3) * lh);
});

function renderSetList() {
  const codes = loadMyCloudCodes();
  $('#set-list').innerHTML = allSets().map(s => {
    const n = parseQuestions(s.text).list.length;
    const code = s.shareCode || (codes.find(c => c.title === s.name)?.code || '');
    return `
      <div class="item"><div class="nm">${s.builtin ? '⭐ ' : ''}${esc(s.name)} <span class="n">· ${n}문제${code ? ` · ☁️ ${esc(code)}` : ''}</span></div>
        <button class="pbtn sm white" data-load="${esc(s.id)}">불러오기</button>
        <button class="pbtn sm ok" data-useset="${esc(s.id)}">게임에 사용</button>
        ${code ? `<button class="pbtn sm blue" data-analytics="${esc(code)}" data-atitle="${esc(s.name)}">📊 현황</button>` : ''}
        ${s.builtin ? '' : `<button class="pbtn sm bad" data-del="${esc(s.id)}">삭제</button>`}
      </div>`;
  }).join('');
}

function saveEditor() {
  const name = $('#ed-name').value.trim();
  const text = $('#ed-text').value;
  const n = parseQuestions(text).list.length;
  if (!n) { toast('읽을 수 있는 문제가 없어요. 형식을 확인해 주세요.'); return null; }
  if (!name) { toast('문제 세트 이름을 적어 주세요.'); $('#ed-name').focus(); return null; }
  const sets = savedSets();
  let s = editingId && sets.find(x => x.id === editingId);
  const wasEdit = !!s;
  if (s) { s.name = name; s.text = text; }
  else { s = { id: 'set_' + Date.now().toString(36), name, text }; sets.push(s); editingId = s.id; }
  if (!store('bq_sets', sets)) {
    if (!wasEdit) editingId = null;
    toast('⚠️ 저장 공간이 부족해 저장하지 못했어요. 필요 없는 세트를 지우거나 백업해 주세요.');
    return null;
  }
  const inc = edMode === 'cards' ? cardList.filter(c => (c.q.trim() || c.a.trim()) && !(c.q.trim() && c.a.trim())).length : 0;
  edSnapshot = currentEdSnap();
  refreshDirty();
  renderSetList();
  toast(inc ? `💾 “${name}” 저장 완료 (${n}문제 · 미완성 카드 ${inc}개 제외)` : `💾 “${name}” 저장 완료 (${n}문제)`);
  sfx('coin');
  return s.id;
}

$('#ed-name').addEventListener('input', refreshDirty);
$('#ed-text').addEventListener('input', updateEdStatus);
$('#ed-save').onclick = () => saveEditor();
$('#ed-use').onclick = () => { const id = saveEditor(); if (!id) return; setup.settings.setId = id; saveSetup(); renderSetup(); show('setup'); };
$('#ed-paste').onclick = async () => {
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip || !clip.trim()) { toast('클립보드가 비어 있어요'); return; }
    if ($('#ed-text').value.trim() && !(await confirmModal({ title: '클립보드 내용으로 바꿀까요?', desc: '지금 입력되어 있는 문제 대신 클립보드 내용을 넣습니다.' }))) return;
    setEditorMode('text');
    $('#ed-text').value = clip;
    updateEdStatus();
    toast('📋 클립보드에서 붙여넣었어요');
  } catch { toast('브라우저에서 직접 Ctrl+V로 붙여넣어 주세요'); }
};
$('#ed-new').onclick = async () => {
  if (isEdDirty() && !(await confirmModal({ title: '새로 쓰기를 시작할까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
  loadIntoEditor(null);
};
$('#ed-sample').onclick = async () => {
  if (isEdDirty() && !(await confirmModal({ title: '예시 문제를 불러올까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
  loadIntoEditor(setup.settings.boardSize === 4 ? 'sample4' : 'sample');
};
$('#ed-back').onclick = async () => {
  if (isEdDirty() && !(await confirmModal({ title: '저장하지 않고 돌아갈까요?', desc: '수정한 내용이 저장되지 않았습니다.', okText: '그냥 돌아가기', danger: true }))) return;
  if (editorBack === 'setup') { renderSetup(); show('setup'); }
  else show('title');
};

$('#set-list').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.load) {
    if (isEdDirty() && !(await confirmModal({ title: '이 세트를 불러올까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
    loadIntoEditor(b.dataset.load);
    toast('불러왔어요. 고친 뒤 저장하세요.');
  }
  if (b.dataset.useset) {
    setup.settings.setId = b.dataset.useset;
    saveSetup();
    renderSetup();
    show('setup');
    toast('문제 세트를 골랐어요!');
  }
  if (b.dataset.analytics) {
    openAnalyticsModal(b.dataset.analytics, b.dataset.atitle || '');
  }
  if (b.dataset.del) {
    const s = getSet(b.dataset.del);
    if (!(await confirmModal({ title: `“${s.name}” 세트를 삭제할까요?`, desc: '삭제한 문제 세트는 다시 복구할 수 없어요.', okText: '삭제하기', danger: true }))) return;
    store('bq_sets', savedSets().filter(x => x.id !== s.id));
    if (editingId === s.id) editingId = null;
    renderSetList();
    toast('삭제했어요');
  }
});

$('#ed-export').onclick = () => {
  const text = $('#ed-text').value;
  if (!text.trim()) { toast('내보낼 내용이 없어요'); return; }
  const name = ($('#ed-name').value.trim() || '문제세트').replace(/[\\/:*?"<>|]/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name + '.txt';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};
$('#ed-import').onclick = () => $('#ed-file').click();

$('#ed-print').onclick = () => {
  const parsed = parseQuestions($('#ed-text').value).list;
  if (!parsed.length) { toast('인쇄할 문제가 없어요'); return; }
  const name = $('#ed-name').value.trim() || '빙고 퀴즈 학습지';
  const nSide = [3, 4, 5].includes(setup.settings.boardSize) ? setup.settings.boardSize : 5;
  openModal(`
    <p class="m-title">🖨️ 인쇄 방식 선택</p>
    <p class="m-desc">“${esc(name)}” (${parsed.length}문제)</p>
    <div class="m-actions" style="flex-direction:column;align-items:stretch">
      <button type="button" class="pbtn gold" id="pr-student">📝 학생용 학습지 인쇄 (문제만)</button>
      <button type="button" class="pbtn blue" id="pr-teacher">📋 교사용 학습지 인쇄 (정답·해설 포함)</button>
      <button type="button" class="pbtn ok" id="pr-bingo">🎲 종이 빙고판 인쇄 (${nSide}×${nSide})</button>
      <button type="button" class="pbtn white" id="m-close">닫기</button>
    </div>`, 'narrow', 'info');
  $('#pr-student').onclick = () => { closeModal(); printQuestionSheet({ title: name, subtitle: `총 ${parsed.length}문제 · 학생용`, questions: parsed, includeAnswers: false }); };
  $('#pr-teacher').onclick = () => { closeModal(); printQuestionSheet({ title: name, subtitle: `총 ${parsed.length}문제 · 교사용 정답지`, questions: parsed, includeAnswers: true }); };
  $('#pr-bingo').onclick = () => { closeModal(); printBingoBoard({ title: name, size: nSide, questions: parsed }); };
  $('#m-close').onclick = closeModal;
};

$('#sets-backup').onclick = () => {
  const sets = savedSets();
  if (!sets.length) { toast('백업할 저장된 문제 세트가 없어요'); return; }
  const payload = JSON.stringify({ app: 'bingo-quiz', v: 1, exportedAt: new Date().toISOString(), sets }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
  a.download = '빙고퀴즈_문제세트_백업.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast(`📦 저장된 세트 ${sets.length}개를 백업했어요`);
};

function restoreSetsFromJson(rawJson) {
  const data = JSON.parse(rawJson);
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.sets) ? data.sets : null);
  if (!arr) throw new Error('Invalid backup format');
  const cur = savedSets();
  const seen = new Set(cur.map(s => s.name + '\0' + s.text));
  const usedIds = new Set(cur.map(s => s.id));
  let added = 0;
  let skipped = 0;
  arr.forEach(item => {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 30) : '';
    const text = typeof item?.text === 'string' ? item.text : '';
    if (!name || !parseQuestions(text).list.length) { skipped++; return; }
    const key = name + '\0' + text;
    if (seen.has(key)) { skipped++; return; }
    const id = typeof item.id === 'string' && item.id.startsWith('set_') && !usedIds.has(item.id)
      ? item.id
      : 'set_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    usedIds.add(id);
    seen.add(key);
    cur.push({ id, name, text, shareCode: item.shareCode || undefined });
    added++;
  });
  if (!store('bq_sets', cur)) throw new Error('QUOTA');
  renderSetList();
  return { added, skipped, total: cur.length };
}
$('#sets-restore').onclick = () => $('#sets-restore-file').click();
$('#sets-restore-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const res = restoreSetsFromJson(String(r.result));
      if (res.added) { sfx('coin'); toast(`📥 ${res.added}개 세트를 불러왔어요${res.skipped ? ` (중복·빈 항목 ${res.skipped}개 건너뜀)` : ''}`); }
      else toast('새로 추가할 문제 세트가 없어요');
    } catch (err) {
      toast(err && err.message === 'QUOTA' ? '⚠️ 저장 공간이 부족해 불러오지 못했어요' : '올바른 백업(.json) 파일이 아니에요');
    }
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
});
$('#sets-analytics').onclick = () => openAnalyticsLookupModal();

let qrZoomLastFocus = null;
function closeQrZoom() {
  const ov = $('#qr-zoom-overlay');
  if (!ov || !ov.classList.contains('show')) return;
  ov.classList.remove('show');
  ov.innerHTML = '';
  if (qrZoomLastFocus && qrZoomLastFocus.focus && document.contains(qrZoomLastFocus)) qrZoomLastFocus.focus();
  qrZoomLastFocus = null;
}
function openQrZoom(title, count, svgHtml) {
  const ov = $('#qr-zoom-overlay');
  if (!ov || !svgHtml) return;
  qrZoomLastFocus = document.activeElement;
  ov.innerHTML = `
    <div class="qr-zoom-card">
      <div style="font-size:20px;font-weight:900">📱 ${esc(title)} <small style="font-size:14px;color:#5c4d38">(${count}문제)</small></div>
      ${svgHtml}
      <div class="hint" style="margin:0;color:#5c4d38">화면 밝기를 높이면 교실 뒤에서도 잘 인식돼요</div>
      <button type="button" class="pbtn gold" id="qr-zoom-close">닫기</button>
    </div>`;
  ov.classList.add('show');
  $('#qr-zoom-close').onclick = closeQrZoom;
  $('#qr-zoom-close').focus();
}
$('#qr-zoom-overlay').addEventListener('click', e => { if (e.target === $('#qr-zoom-overlay')) closeQrZoom(); });

function openPublishLibraryModal(name, text, count) {
  openModal(`
    <p class="m-title">🏛️ 공개 문제 창고에 등록</p>
    <p class="m-desc">다른 선생님들도 검색해서 수업에 쓸 수 있게 공유해요.</p>
    <form id="pub-form" class="tm-grid" style="margin-top:12px">
      <div class="opt-row"><label>제목</label><input id="pub-title" class="ed-field" style="max-width:66%" maxlength="40" value="${esc(name)}"></div>
      <div class="opt-row"><label>과목</label><select id="pub-subj"><option>상식</option><option>과학</option><option>수학</option><option>사회</option><option>국어</option><option>영어</option><option>기타</option></select></div>
      <div class="opt-row"><label>추천 학년</label><select id="pub-grade"><option>전학년</option><option>초등</option><option>중등</option><option>고등</option></select></div>
      <div class="opt-row"><label>작성자 이름</label><input id="pub-author" class="ed-field" style="max-width:66%" maxlength="20" value="선생님" placeholder="예: 엽쌤"></div>
      <div class="q-msg" id="pub-msg" style="font-size:14px"></div>
      <div class="m-actions">
        <button type="submit" class="pbtn ok" id="pub-submit">🌐 등록하기 (${count}문제)</button>
        <button type="button" class="pbtn white" id="m-close">취소</button>
      </div>
    </form>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#pub-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#pub-submit');
    btn.disabled = true;
    $('#pub-msg').textContent = '☁️ 공개 창고에 올리는 중...';
    try {
      await publishToPublicLibrary({
        title: $('#pub-title').value,
        subject: $('#pub-subj').value,
        grade: $('#pub-grade').value,
        authorAlias: $('#pub-author').value,
        content: text,
        questionCount: count
      });
      closeModal();
      sfx('coin');
      toast('🏛️ 공개 문제 창고에 등록했어요!');
    } catch {
      btn.disabled = false;
      $('#pub-msg').textContent = '⚠️ 등록에 실패했어요. 네트워크 또는 Supabase 테이블 설정을 확인해 주세요.';
    }
  };
}

async function openShareModal(name, text, count, forceNew = false) {
  const token = await encodeSetShare(name, text);
  const baseUrl = location.href.split('#')[0].split('?')[0];
  const offlineUrl = baseUrl + '#set=' + token;
  let cloudResult = null;
  let cloudError = '';
  let reused = false;

  const existing = !forceNew ? findReusableCloudCode(name, text) : null;
  if (existing) {
    cloudResult = { code: existing.code, shareUrl: `${baseUrl}?code=${existing.code}` };
    reused = true;
  } else if (navigator.onLine !== false) {
    try {
      cloudResult = await uploadSharedSet(name, text, count, baseUrl);
      saveMyCloudCode({ code: cloudResult.code, title: name, count, contentHash: hashSetContent(name, text) });
      if (editingId) {
        const sets = savedSets();
        const cur = sets.find(s => s.id === editingId);
        if (cur) { cur.shareCode = cloudResult.code; store('bq_sets', sets); renderSetList(); }
      }
    } catch {
      cloudError = '클라우드 코드 서버가 아직 준비되지 않았거나 오프라인 상태예요. 아래 오프라인 링크·QR로 바로 공유할 수 있어요.';
    }
  } else {
    cloudError = '오프라인 상태라 오프라인 링크·QR 모드로 열었어요.';
  }

  let mode = cloudResult ? 'cloud' : 'offline';
  const renderShareBody = () => {
    const activeUrl = mode === 'cloud' && cloudResult ? cloudResult.shareUrl : offlineUrl;
    const qrSvg = makeQRSvg(activeUrl);
    const qrVer = qrSvg ? +(qrSvg.match(/data-qr-ver="(\d+)"/)?.[1] || 0) : 0;
    openModal(`
      <p class="m-title">🔗 문제 세트 공유하기</p>
      <p class="m-desc">“${esc(name)}” · <b>${count}문제</b></p>
      <div class="share-mode-tabs ed-tabs" style="justify-content:center;margin:10px 0">
        <button type="button" class="${mode === 'cloud' ? 'on' : ''}" data-smode="cloud" ${cloudResult ? '' : 'disabled'}>☁️ 6자리 코드 QR</button>
        <button type="button" class="${mode === 'offline' ? 'on' : ''}" data-smode="offline">📦 오프라인 압축 링크</button>
      </div>
      ${mode === 'cloud' && cloudResult ? `
        <div class="cloud-code-box">
          <div style="font-size:13px;font-weight:800">${reused ? '같은 내용의 기존 코드를 재사용했어요 · ' : ''}학생이 ‘코드 문제’에 입력하거나 QR을 찍으세요</div>
          <div class="cloud-code-val">${esc(cloudResult.code)}</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="pbtn sm gold" id="sh-copy-code">📋 코드 복사</button>
            <button type="button" class="pbtn sm blue" id="sh-analytics">📊 학급 복습 현황</button>
            <button type="button" class="pbtn sm white" id="sh-new-code">🔄 새 코드 발급</button>
          </div>
        </div>` : (cloudError ? `<div class="set-info warn" style="margin:6px 0">${esc(cloudError)}</div>` : '')}
      <div class="share-qr-box">
        ${qrSvg ? `<button type="button" class="share-qr-btn" id="sh-qr-zoom" title="눌러서 크게 보기">${qrSvg}</button>`
          : '<div class="set-info warn" style="width:100%">⚠️ 문제 양이 많아 QR 코드 대신 아래 <b>공유 링크</b>를 복사해서 전달해 주세요!</div>'}
        ${qrSvg && qrVer >= 20 ? '<div class="set-info warn" style="width:100%;text-align:center">💡 문제가 많아 QR 점이 작아요. <b>🔍 QR 크게 보기</b>로 확대하거나 <b>링크 복사</b>를 추천해요!</div>' : ''}
      </div>
      <div class="share-url-row">
        <input id="sh-url" readonly value="${esc(activeUrl)}">
        <button type="button" class="pbtn gold sm" id="sh-copy">📋 링크 복사</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:8px">학생이 QR을 찍거나 코드를 열면 <b>🤖 1인 플레이(vs PC)</b>로 바로 복습할 수 있어요!</p>
      <div class="m-actions">${qrSvg ? '<button type="button" class="pbtn blue" id="sh-zoom-btn">🔍 QR 크게 보기</button>' : ''}<button type="button" class="pbtn ok" id="sh-publish">🏛️ 공개 창고에 등록</button><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');

    $$('[data-smode]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      mode = b.dataset.smode;
      renderShareBody();
    });
    if ($('#sh-qr-zoom')) $('#sh-qr-zoom').onclick = () => openQrZoom(name, count, qrSvg);
    if ($('#sh-zoom-btn')) $('#sh-zoom-btn').onclick = () => openQrZoom(name, count, qrSvg);
    if ($('#sh-copy-code') && cloudResult) {
      $('#sh-copy-code').onclick = async () => {
        try { await navigator.clipboard.writeText(cloudResult.code); toast(`📋 코드 ${cloudResult.code} 복사 완료!`); }
        catch { toast(`공유 코드: ${cloudResult.code}`); }
      };
    }
    if ($('#sh-analytics') && cloudResult) {
      $('#sh-analytics').onclick = () => openAnalyticsModal(cloudResult.code, name);
    }
    if ($('#sh-new-code')) {
      $('#sh-new-code').onclick = () => openShareModal(name, text, count, true);
    }
    $('#sh-publish').onclick = () => openPublishLibraryModal(name, text, count);
    $('#sh-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(activeUrl); toast('📋 공유 링크를 복사했어요!'); }
      catch {
        $('#sh-url').select();
        try { document.execCommand('copy'); toast('📋 공유 링크를 복사했어요!'); }
        catch { toast('링크를 선택해 복사해 주세요'); }
      }
    };
    $('#m-close').onclick = closeModal;
  };
  renderShareBody();
}

$('#ed-share').onclick = () => {
  const text = $('#ed-text').value;
  const parsed = parseQuestions(text).list;
  if (!parsed.length) { toast('공유할 수 있는 문제가 없어요'); return; }
  const name = $('#ed-name').value.trim() || '공유 문제 세트';
  openShareModal(name, text, parsed.length);
};

$('#ed-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    editingId = null;
    $('#ed-name').value = f.name.replace(/\.(txt|csv)$/i, '');
    $('#ed-text').value = String(r.result);
    edSnapshot = '';
    updateEdStatus();
    if (edMode === 'cards') { loadCardsFromText(); renderCardEditor(); }
    toast('파일을 불러왔어요. 저장하기를 눌러 보관하세요.');
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
});

function renderPrompt() {
  const grade = $('#p-grade').value;
  const topic = $('#p-topic').value.trim() || '(과목과 주제)';
  const n = +$('#p-count').value;
  const type = $('#p-type').value;
  const diff = $('#p-diff').value;
  const withEx = $('#p-explain').checked;
  const mcN = Math.round(n * 0.8);
  const typeLine = {
    mix: `- 객관식 ${mcN}개, 주관식 ${n - mcN}개를 섞어서 만들어 줘.`,
    mc: '- 모든 문제를 객관식(정답 1개 + 오답 3개)으로 만들어 줘.',
    sa: '- 모든 문제를 주관식(단답형)으로 만들어 줘.'
  }[type];
  $('#prompt-out').value =
`너는 ${grade} 학생들을 가르치는 선생님이야.
"${topic}"에 대한 교실 퀴즈 게임용 문제를 ${n}개 만들어 줘.
난이도는 "${diff}"(으)로 해 줘.

[출력 규칙] 아래 규칙을 반드시 지켜 줘.
- 한 줄에 문제 하나씩만 쓰고, 번호·제목·설명·인사말 없이 문제 줄만 출력해.
- 객관식 형식: 문제 | 정답 | 오답1 | 오답2 | 오답3${withEx ? ' | 해설: 한 줄 설명' : ''}
- 주관식 형식: 문제 | 정답${withEx ? ' | 해설: 한 줄 설명' : ''}
${typeLine}
- 칸은 세로 막대(|)로만 나누고, 문제와 보기 안에는 | 기호를 쓰지 마.
- 정답은 짧고 분명하게(한두 단어) 써 줘. 주관식은 답이 하나로 정해지는 문제만 내 줘.
- 오답은 그럴듯하지만 분명히 틀린 것으로 만들어 줘.${withEx ? '\n- 각 줄 맨 끝에 "| 해설: 한 문장 설명"을 꼭 붙여 줘.' : ''}
- 같은 내용의 문제가 겹치지 않게 하고, ${grade} 학생이 이해할 수 있는 쉬운 말로 써 줘.
- 결과는 복사하기 쉽게 코드 블록 하나 안에 넣어 줘.

[예시]
식물이 햇빛을 받아 스스로 양분을 만드는 과정은? | 광합성 | 증산 작용 | 호흡 | 소화${withEx ? ' | 해설: 잎에서 빛을 이용해 양분을 만들어요.' : ''}
우리 몸에서 피를 온몸으로 보내는 기관은? | 심장${withEx ? ' | 해설: 혈액을 온몸으로 순환시키는 펌프 역할을 해요.' : ''}`;
}
['#p-grade', '#p-topic', '#p-count', '#p-type', '#p-diff', '#p-explain'].forEach(s => $(s).addEventListener('input', renderPrompt));
$('#p-copy').onclick = async () => {
  const ta = $('#prompt-out');
  const text = ta.value;
  try { await navigator.clipboard.writeText(text); toast('📋 프롬프트를 복사했어요!'); }
  catch {
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); toast('📋 프롬프트를 복사했어요!'); }
    catch { toast('복사가 안 되면 글을 직접 선택해서 복사해 주세요'); }
  }
};

/* ================= 클라우드 코드 열기 · 공개 창고 · 학급 복습 현황 · 명예의 전당 ================= */
async function openSharedSetPrompt({ name, rawText, count, shareCode = null }) {
  const parsed = parseQuestions(rawText).list;
  if (!parsed.length) { toast('공유된 문제 세트를 읽지 못했어요'); return; }
  const prettyText = serializeQuestions(parsed);
  const saveShared = () => {
    const sets = savedSets();
    let existing = sets.find(s => (shareCode && s.shareCode === shareCode) || (s.name === name && (s.text === prettyText || s.text === rawText)));
    if (!existing) {
      existing = { id: 'set_' + Date.now().toString(36), name, text: prettyText, shareCode: shareCode || undefined };
      sets.push(existing);
      store('bq_sets', sets);
    } else if (shareCode && !existing.shareCode) {
      existing.shareCode = shareCode;
      store('bq_sets', sets);
    }
    return existing.id;
  };

  const wasInGame = $('#screen-game').classList.contains('active');
  if (wasInGame) { gameSession++; aiFocusTile = -1; }
  let skipResume = false;
  const resumePausedPC = () => {
    if (!skipResume && wasInGame && $('#screen-game').classList.contains('active') && S && !S.over && S.teams[S.turn]?.isAI) scheduleAITurn();
  };
  openModal(`
    <p class="m-title">📦 공유된 문제 세트</p>
    <p class="m-desc" style="font-weight:800;margin-bottom:6px">“${esc(name)}”${shareCode ? ` <small>(${esc(shareCode)})</small>` : ''}</p>
    <p class="m-desc">총 <b>${parsed.length}문제</b>가 들어 있어요. 바로 풀어 볼까요?</p>
    ${shareCode ? `<div class="q-sa-form" style="margin:12px auto 4px"><input id="sh-alias" maxlength="12" value="${esc(setup.solo.name === '나' ? '' : setup.solo.name)}" placeholder="내 학번 또는 이름 (예: 5반 김철수)"></div>` : ''}
    <div class="m-actions">
      <button type="button" class="pbtn ok big" id="sh-solo">🤖 저장하고 1인 플레이 (vs PC)</button>
      <button type="button" class="pbtn gold" id="sh-save">💾 내 문제 세트에 저장</button>
      <button type="button" class="pbtn white" id="m-close">닫기</button>
    </div>`, 'narrow', 'info', resumePausedPC);
  $('#sh-solo').onclick = () => {
    skipResume = true;
    const aliasEl = $('#sh-alias');
    if (aliasEl && aliasEl.value.trim()) {
      setup.solo.name = aliasEl.value.trim().slice(0, 12);
    }
    const id = saveShared();
    closeModal();
    setup.settings.playMode = 'solo';
    setup.settings.setId = id;
    if (count <= 9) setup.settings.boardSize = 3;
    else if (count <= 16) setup.settings.boardSize = 4;
    saveSetup();
    setAdvOpen(false);
    renderSetup();
    show('setup');
    toast(`💾 “${name}” 저장 완료! 바로 시작해 보세요`);
  };
  $('#sh-save').onclick = () => {
    const id = saveShared();
    setup.settings.setId = id;
    saveSetup();
    closeModal();
    toast(`💾 “${name}” 세트를 저장했어요`);
    if ($('#screen-editor').classList.contains('active')) renderSetList();
    if ($('#screen-setup').classList.contains('active')) renderSetup();
  };
  $('#m-close').onclick = closeModal;
}

function openCodeJoinModal() {
  openModal(`
    <p class="m-title">🔑 공유 코드로 문제 열기</p>
    <p class="m-desc">선생님이 알려 준 6자리 영문·숫자 코드를 입력하세요.</p>
    <form id="code-join-form" class="q-sa-form" style="margin-top:14px">
      <input type="text" id="code-join-input" maxlength="8" placeholder="예: A7K3P9" autocomplete="off" style="text-transform:uppercase;letter-spacing:4px">
      <button type="submit" class="pbtn gold" id="code-join-submit">불러오기</button>
    </form>
    <div class="q-msg" id="code-join-msg" style="font-size:15px"></div>
    <div class="m-actions"><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#code-join-form').onsubmit = async e => {
    e.preventDefault();
    const raw = $('#code-join-input').value;
    const code = normalizeCode(raw);
    const msgEl = $('#code-join-msg');
    if (!code) {
      msgEl.textContent = '⚠️ 영문·숫자 6자리 코드를 정확히 입력해 주세요.';
      return;
    }
    const btn = $('#code-join-submit');
    btn.disabled = true;
    msgEl.textContent = '☁️ 문제 세트를 불러오는 중...';
    try {
      const row = await fetchSharedSet(code);
      if (!row) {
        msgEl.textContent = `❌ “${code}” 코드를 찾을 수 없어요. 오타가 없는지 확인해 주세요.`;
        btn.disabled = false;
        return;
      }
      closeModal();
      openSharedSetPrompt({ name: row.title, rawText: row.content, count: row.question_count, shareCode: row.code });
    } catch {
      msgEl.textContent = '⚠️ 네트워크 오류이거나 클라우드 기능이 아직 활성화되지 않았어요.';
      btn.disabled = false;
    }
  };
}

async function openPublicLibraryModal() {
  let subjFilter = 'all';
  let qText = '';
  let merged = [...COMMUNITY_STARTER_SETS];
  openModal(`
    <p class="m-title">🏛️ 공개 문제 창고</p>
    <p class="m-desc">수업에 바로 쓸 수 있는 추천·공유 세트를 골라 보세요.</p>
    <div class="set-picker-bar" style="margin-top:12px">
      <input type="search" class="set-search" id="lib-search" placeholder="🔍 단원·과목·작성자 검색">
      <div class="set-filter-chips" id="lib-filters"></div>
    </div>
    <div class="lib-grid" id="lib-grid"></div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'wide', 'info');
  $('#m-close').onclick = closeModal;

  const subjects = ['all', '상식', '과학', '수학', '사회', '국어', '영어', '기타'];
  const drawLib = () => {
    const fEl = $('#lib-filters');
    const gEl = $('#lib-grid');
    if (!fEl || !gEl) return;
    fEl.innerHTML = subjects.map(s => `<button type="button" class="set-filter-btn ${subjFilter === s ? 'on' : ''}" data-lsubj="${s}">${s === 'all' ? '전체' : s}</button>`).join('');
    const q = qText.trim().toLowerCase();
    const list = merged.filter(it => {
      if (subjFilter !== 'all' && it.subject !== subjFilter) return false;
      if (q && !`${it.title} ${it.subject} ${it.grade} ${it.author_alias}`.toLowerCase().includes(q)) return false;
      return true;
    });
    gEl.innerHTML = list.length ? list.map((it, idx) => `
      <div class="lib-card">
        <div class="lib-card-title">${esc(it.title)}</div>
        <div class="lib-card-meta">${esc(it.subject)} · ${esc(it.grade)} · ${it.question_count}문제 · ${esc(it.author_alias)}</div>
        <div style="margin-top:auto;display:flex;gap:6px;flex-wrap:wrap;padding-top:6px">
          <button type="button" class="pbtn sm gold" data-libpick="${idx}">📥 가져오기</button>
        </div>
      </div>`).join('') : '<div class="hint" style="grid-column:1/-1;text-align:center;padding:18px">조건에 맞는 세트가 없어요.</div>';
    gEl._list = list;
  };
  $('#lib-search').addEventListener('input', e => { qText = e.target.value; drawLib(); });
  $('#lib-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-lsubj]');
    if (!b) return;
    subjFilter = b.dataset.lsubj;
    drawLib();
  });
  $('#lib-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-libpick]');
    if (!b) return;
    const gEl = $('#lib-grid');
    const item = gEl && gEl._list ? gEl._list[+b.dataset.libpick] : null;
    if (!item) return;
    closeModal();
    openSharedSetPrompt({ name: item.title, rawText: item.content, count: item.question_count });
  });
  drawLib();

  const { items: cloudItems } = await fetchPublicLibrary();
  if (!$('#lib-grid') || !cloudItems.length) return;
  const seenTitles = new Set();
  merged = [...cloudItems, ...COMMUNITY_STARTER_SETS].filter(it => {
    const k = `${it.title}\0${it.question_count}`;
    if (seenTitles.has(k)) return false;
    seenTitles.add(k);
    return true;
  });
  drawLib();
}

function openHallOfFameModal() {
  const drawHof = () => {
    const list = loadHallOfFame();
    openModal(`
      <p class="m-title">🏆 학급 명예의 전당</p>
      <p class="m-desc">지금까지 이 기기에 저장된 경기 우승 기록이에요.</p>
      ${list.length ? `<div class="hof-list">${list.map(h => `
        <div class="hof-item">
          <div>
            <b>${esc(h.winnerEmoji)} ${esc(h.winnerName)}</b> <span style="color:#d97706;font-weight:900">${h.winnerScore}점</span>
            <div style="font-size:12.5px;color:var(--muted)">${esc(h.setName)} · ${h.boardSize}×${h.boardSize}${h.runnerUp ? ` · ${esc(h.runnerUp)}` : ''}</div>
          </div>
          <small style="color:var(--muted)">${new Date(h.date).toLocaleDateString('ko-KR')}</small>
        </div>`).join('')}</div>`
      : '<div class="hint" style="text-align:center;padding:24px">아직 기록된 우승팀이 없어요. 경기가 끝난 뒤 ‘🏆 명예의 전당 기록’을 눌러 보세요!</div>'}
      <div class="m-actions">
        ${list.length ? '<button type="button" class="pbtn blue" id="hof-csv">📥 CSV 내보내기</button><button type="button" class="pbtn bad" id="hof-clear">🗑️ 기록 지우기</button>' : ''}
        <button type="button" class="pbtn gold" id="m-close">닫기</button>
      </div>`, 'narrow', 'info');
    if ($('#hof-csv')) {
      $('#hof-csv').onclick = () => {
        downloadCsv('빙고퀴즈_명예의전당.csv', [
          ['날짜', '문제 세트', '크기', '우승', '점수', '비고'],
          ...loadHallOfFame().map(h => [new Date(h.date).toLocaleString('ko-KR'), h.setName, `${h.boardSize}x${h.boardSize}`, h.winnerName, h.winnerScore, h.runnerUp])
        ]);
        toast('📥 명예의 전당 CSV를 저장했어요');
      };
    }
    if ($('#hof-clear')) {
      $('#hof-clear').onclick = async () => {
        if (!(await confirmModal({ title: '명예의 전당 기록을 모두 지울까요?', okText: '지우기', danger: true }))) return;
        clearHallOfFame();
        drawHof();
      };
    }
    $('#m-close').onclick = closeModal;
  };
  drawHof();
}

function openAnalyticsLookupModal() {
  const codes = loadMyCloudCodes();
  openModal(`
    <p class="m-title">📊 학급 복습 현황 조회</p>
    <p class="m-desc">최근 공유한 코드를 누르거나 6자리 코드를 직접 입력해 주세요.</p>
    <form id="an-form" class="q-sa-form" style="margin-top:12px">
      <input type="text" id="an-code-inp" maxlength="8" placeholder="6자리 코드" style="text-transform:uppercase;letter-spacing:3px">
      <button type="submit" class="pbtn blue">조회</button>
    </form>
    ${codes.length ? `<div class="set-list" style="margin-top:10px">${codes.map(c => `<div class="item"><div class="nm">☁️ <b>${esc(c.code)}</b> · ${esc(c.title)} <span class="n">(${c.count}문제)</span></div><button type="button" class="pbtn sm blue" data-ancode="${esc(c.code)}" data-antitle="${esc(c.title)}">현황 보기</button></div>`).join('')}</div>`
      : '<p class="hint" style="text-align:center">아직 이 기기에서 공유한 클라우드 코드가 없어요.</p>'}
    <div class="m-actions"><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#an-form').onsubmit = e => {
    e.preventDefault();
    const code = normalizeCode($('#an-code-inp').value);
    if (!code) { toast('6자리 코드를 입력해 주세요'); return; }
    openAnalyticsModal(code, '');
  };
  $$('[data-ancode]').forEach(b => b.onclick = () => openAnalyticsModal(b.dataset.ancode, b.dataset.antitle || ''));
}

async function openAnalyticsModal(rawCode, title = '') {
  const code = normalizeCode(rawCode);
  if (!code) return;
  openModal(`
    <p class="m-title">📊 학급 복습 현황</p>
    <p class="m-desc">${title ? `“${esc(title)}” · ` : ''}코드 <b>${esc(code)}</b></p>
    <div id="dash-body" style="padding:20px;text-align:center;font-weight:800">☁️ 데이터를 불러오는 중...</div>
    <div class="m-actions"><button type="button" class="pbtn blue hidden" id="an-csv">📥 엑셀(.csv) 내보내기</button><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'wide', 'info');
  $('#m-close').onclick = closeModal;
  try {
    const data = await fetchClassAnalytics(code);
    const body = $('#dash-body');
    if (!body) return;
    if (!data.totalPlays) {
      body.innerHTML = '<div class="hint" style="padding:18px">아직 제출된 복습 결과가 없어요. 학생들이 1인 플레이를 완료하면 이곳에 자동 집계돼요!</div>';
      return;
    }
    const maxMiss = data.topMissed.length ? data.topMissed[0].count : 1;
    body.style.textAlign = 'left';
    body.innerHTML = `
      <div class="dash-summary">
        <div class="dash-stat"><b>${data.totalPlays}회</b><small>참여 완료</small></div>
        <div class="dash-stat"><b>${data.avgScore}점</b><small>평균 점수</small></div>
        <div class="dash-stat"><b>${data.winRate}%</b><small>PC 승률</small></div>
        <div class="dash-stat"><b>${data.avgAccuracy}%</b><small>평균 정답률</small></div>
      </div>
      <h4 style="margin:14px 0 6px">🔥 가장 많이 틀린 문제 TOP 5</h4>
      ${data.topMissed.length ? `<div class="dash-missed">${data.topMissed.map((m, i) => `
        <div class="dash-missed-row">
          <div style="font-weight:800;font-size:14px">${i + 1}. ${esc(m.question)} <span style="color:#dc2626">(${m.count}회 오답)</span></div>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.max(10, Math.round((m.count / maxMiss) * 100))}%"></div></div>
        </div>`).join('')}</div>`
      : '<div class="hint">오답으로 기록된 문제가 없어요! 👏</div>'}
      <h4 style="margin:14px 0 6px">🕒 최근 기록</h4>
      <div class="log-list" style="max-height:160px">${data.recent.map(r => `<div><b>${esc(r.student_alias)}</b> · ${r.score}점 (⭕${r.correct_count} / ❌${r.wrong_count}) ${r.won ? '🏆' : ''}</div>`).join('')}</div>`;
    const csvBtn = $('#an-csv');
    if (csvBtn && data.allRows) {
      csvBtn.classList.remove('hidden');
      csvBtn.onclick = () => {
        downloadCsv(`빙고퀴즈_학급현황_${code}.csv`, [
          ['제출 시각', '학생', '점수', '정답 수', '오답 수', '승리 여부', '틀린 문제'],
          ...data.allRows.map(r => [
            new Date(r.created_at).toLocaleString('ko-KR'),
            r.student_alias,
            r.score,
            r.correct_count,
            r.wrong_count,
            r.won ? '승' : '패/무',
            Array.isArray(r.missed_questions) ? r.missed_questions.join(' / ') : ''
          ])
        ]);
        toast('📥 학급 현황 CSV를 내려받았어요');
      };
    }
  } catch {
    const body = $('#dash-body');
    if (body) body.innerHTML = '<div class="set-info warn">⚠️ 현황 데이터를 불러오지 못했어요. 네트워크 연결이나 Supabase 테이블 설정을 확인해 주세요.</div>';
  }
}

/* ================= 실시간 교실 참여 방 (Host & Student) ================= */
let liveRoom = null; // { ch, code, students: Set, tileVotes: Map, qAnswers: Map, qIndex: -1, status }
let studentLive = null; // { ch, code, alias, state, question, votedTile, pickedAns, status }

function genRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function broadcastLiveState() {
  if (!liveRoom || !S) return;
  liveRoom.ch.send('room_state', {
    setName: S.setName,
    round: S.round,
    size: boardN(S),
    over: !!S.over,
    turnName: S.teams[S.turn]?.name || '',
    turnEmoji: S.teams[S.turn]?.emoji || '',
    tiles: S.tiles.map(t => ({ owner: t.owner, opened: t.opened })),
    teams: S.teams.map((t, k) => ({ name: t.name, emoji: t.emoji, score: score(S, k) }))
  });
}

function refreshLiveHostUI() {
  const btn = $('#g-live');
  if (btn) {
    btn.classList.toggle('live-on', !!liveRoom);
    btn.textContent = liveRoom ? `📡 방 ${liveRoom.code} (${liveRoom.students.size})` : '📡 실시간 방';
  }
  const respBox = $('#live-resp-box');
  if (respBox && liveRoom && liveRoom.qIndex >= 0) {
    const total = liveRoom.qAnswers.size;
    respBox.classList.remove('hidden');
    const q = S?.tiles[liveRoom.qIndex]?.q;
    if (q && q.opts) {
      const counts = new Map();
      for (const ans of liveRoom.qAnswers.values()) counts.set(ans, (counts.get(ans) || 0) + 1);
      respBox.innerHTML = `<b>📡 학생 실시간 응답 (${total}명)</b><div class="live-resp-bar">${[...counts.entries()].map(([k, v]) => `<span class="live-resp-pill">${esc(k)}: ${v}명</span>`).join('') || '<span>응답을 기다리는 중...</span>'}</div>`;
    } else {
      const list = [...liveRoom.qAnswers.entries()].slice(-5);
      respBox.innerHTML = `<b>📡 학생 실시간 답안 (${total}명)</b><div class="live-resp-bar">${list.map(([stu, ans]) => `<span class="live-resp-pill">${esc(stu)}: ${esc(ans)}</span>`).join('') || '<span>답안을 기다리는 중...</span>'}</div>`;
    }
  }
}

function closeHostLiveRoom() {
  if (!liveRoom) return;
  try { liveRoom.ch.send('room_closed', {}); } catch {}
  liveRoom.ch.close();
  liveRoom = null;
  refreshLiveHostUI();
  if (S) renderBanner();
}

function startHostLiveRoom() {
  if (liveRoom) return;
  const code = genRoomCode();
  const room = {
    code,
    students: new Set(),
    tileVotes: new Map(),
    qAnswers: new Map(),
    qIndex: -1,
    status: 'connecting',
    ch: null
  };
  room.ch = createLiveChannel(code, {
    onStatus(st) {
      room.status = st;
      refreshLiveHostUI();
      if (st === 'connected') broadcastLiveState();
    },
    onMessage(ev, pl) {
      if (ev === 'student_join') {
        const who = String(pl.alias || '학생').slice(0, 16);
        room.students.add(who);
        refreshLiveHostUI();
        broadcastLiveState();
      } else if (ev === 'sync_req') {
        broadcastLiveState();
      } else if (ev === 'tile_vote') {
        const who = String(pl.alias || '학생').slice(0, 16);
        const idx = Number(pl.tile);
        if (Number.isInteger(idx) && idx >= 0 && idx < (S ? S.tiles.length : 25)) {
          room.students.add(who);
          room.tileVotes.set(who, idx);
          if (S && $('#screen-game').classList.contains('active')) renderBanner();
        }
      } else if (ev === 'q_answer') {
        const who = String(pl.alias || '학생').slice(0, 16);
        room.students.add(who);
        if (pl.qIndex === room.qIndex) {
          room.qAnswers.set(who, String(pl.answer || '').slice(0, 40));
          refreshLiveHostUI();
        }
      }
    }
  });
  liveRoom = room;
  refreshLiveHostUI();
}

function openHostLiveModal() {
  if (!S) return;
  if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  if (!liveRoom) startHostLiveRoom();
  const baseUrl = location.href.split('#')[0].split('?')[0];
  const joinUrl = `${baseUrl}?room=${liveRoom.code}`;
  const qrSvg = makeQRSvg(joinUrl);
  openModal(`
    <p class="m-title">📡 실시간 교실 방</p>
    <p class="m-desc">학생들이 휴대폰·태블릿에서 칸 투표와 문제 응답에 바로 참여해요.</p>
    <div class="cloud-code-box">
      <div style="font-size:13px;font-weight:800">참여 중인 학생: <b id="hl-cnt">${liveRoom.students.size}</b>명 · 연결: <b>${liveRoom.status === 'connected' ? '🟢 연결됨' : '🟡 연결 중'}</b></div>
      <div class="cloud-code-val">${esc(liveRoom.code)}</div>
      <div style="font-size:13px">학생 화면에서 <b>📡 실시간 방</b>을 누르거나 아래 QR을 스캔하세요</div>
    </div>
    <div class="share-qr-box">${qrSvg || ''}</div>
    <div class="share-url-row">
      <input id="hl-url" readonly value="${esc(joinUrl)}">
      <button type="button" class="pbtn gold sm" id="hl-copy">📋 주소 복사</button>
    </div>
    <div class="m-actions">
      <button type="button" class="pbtn bad" id="hl-stop">방 닫기</button>
      <button type="button" class="pbtn gold" id="m-close">계속 진행</button>
    </div>`, 'narrow', 'info');
  $('#hl-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl); toast('📋 참여 주소를 복사했어요!'); }
    catch { toast(`방 코드: ${liveRoom.code}`); }
  };
  $('#hl-stop').onclick = () => { closeHostLiveRoom(); closeModal(); toast('실시간 방을 닫았어요'); };
  $('#m-close').onclick = closeModal;
}

function renderLiveStudentScreen() {
  if (!studentLive) return;
  const stEl = $('#ls-status');
  const metaEl = $('#ls-meta');
  const stageEl = $('#ls-stage');
  $('#ls-room-title').textContent = `📡 실시간 방 · ${studentLive.code}`;
  stEl.textContent = studentLive.status === 'connected' ? '🟢 연결됨' : (studentLive.status === 'error' ? '🔴 연결 오류' : '🟡 연결 중');
  stEl.className = 'live-status ' + (studentLive.status === 'connected' ? 'ok' : (studentLive.status === 'error' ? 'err' : ''));

  const rs = studentLive.state;
  if (!rs) {
    metaEl.textContent = `참여자: ${studentLive.alias} · 교실 화면의 신호를 기다리는 중...`;
    stageEl.innerHTML = '<div class="hint" style="text-align:center;padding:24px">선생님 화면과 연결되면 이곳에 빙고판과 문제가 나타납니다.</div>';
    return;
  }
  metaEl.innerHTML = `<span>👤 ${esc(studentLive.alias)}</span><span>· ${rs.round}R · ${esc(rs.turnEmoji)} ${esc(rs.turnName)} 차례</span>`;

  if (rs.over) {
    stageEl.innerHTML = `<div class="set-info" style="text-align:center">🏁 경기가 종료되었습니다!<br>${(rs.teams || []).map(t => `${t.emoji} ${esc(t.name)} <b>${t.score}점</b>`).join(' · ')}</div>`;
    return;
  }

  const q = studentLive.question;
  if (q) {
    const imgHtml = q.img && isSafeImageUrl(q.img) ? `<img class="q-img" src="${esc(q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';
    if (q.isMc && Array.isArray(q.opts)) {
      stageEl.innerHTML = `
        ${imgHtml}
        <div class="q-text" style="font-size:20px;padding:8px 4px 12px">${formatRichText(q.q)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${q.opts.map((o, k) => `<button type="button" class="live-opt-btn ${studentLive.pickedAns === o ? 'picked' : ''}" data-lopt="${esc(o)}"><b>${'①②③④⑤⑥'[k]}</b> ${formatRichText(o)}</button>`).join('')}
        </div>
        <p class="hint" style="text-align:center">${studentLive.pickedAns ? `✅ “${esc(studentLive.pickedAns)}” 전송 완료!` : '정답이라고 생각하는 보기를 눌러 보세요'}</p>`;
      stageEl.querySelectorAll('[data-lopt]').forEach(b => b.onclick = () => {
        studentLive.pickedAns = b.dataset.lopt;
        studentLive.ch.send('q_answer', { alias: studentLive.alias, qIndex: q.qIndex, answer: studentLive.pickedAns });
        sfx('click');
        renderLiveStudentScreen();
      });
    } else {
      stageEl.innerHTML = `
        ${imgHtml}
        <div class="q-text" style="font-size:20px;padding:8px 4px 12px">${formatRichText(q.q)}</div>
        <form id="ls-sa-form" class="q-sa-form">
          <input id="ls-sa-inp" placeholder="정답 입력" value="${esc(studentLive.pickedAns || '')}" autocomplete="off">
          <button type="submit" class="pbtn gold">전송</button>
        </form>
        <p class="hint" style="text-align:center">${studentLive.pickedAns ? `✅ “${esc(studentLive.pickedAns)}” 전송 완료!` : '답안을 입력해 선생님 화면으로 보낼 수 있어요'}</p>`;
      $('#ls-sa-form').onsubmit = e => {
        e.preventDefault();
        const val = $('#ls-sa-inp').value.trim();
        if (!val) return;
        studentLive.pickedAns = val;
        studentLive.ch.send('q_answer', { alias: studentLive.alias, qIndex: q.qIndex, answer: val });
        sfx('click');
        renderLiveStudentScreen();
      };
    }
    return;
  }

  const N = rs.size || 5;
  stageEl.innerHTML = `
    <p class="hint" style="text-align:center;margin:0 0 8px">열리지 않은 번호 칸을 눌러 다음 도전 칸에 투표하세요!</p>
    <div class="live-grid" style="--ln:${N}">
      ${(rs.tiles || []).map((t, i) => `<button type="button" class="live-tile-btn ${t.opened ? 'opened' : ''} ${studentLive.votedTile === i ? 'voted' : ''}" data-ltile="${i}" ${t.opened ? 'disabled' : ''}>${t.opened ? (t.owner >= 0 && rs.teams[t.owner] ? rs.teams[t.owner].emoji : '·') : (i + 1)}</button>`).join('')}
    </div>`;
  stageEl.querySelectorAll('[data-ltile]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.ltile;
    studentLive.votedTile = idx;
    studentLive.ch.send('tile_vote', { alias: studentLive.alias, tile: idx });
    sfx('click');
    renderLiveStudentScreen();
    toast(`📡 ${idx + 1}번 칸에 투표했어요!`);
  });
}

function leaveStudentLiveRoom() {
  if (studentLive) {
    studentLive.ch.close();
    studentLive = null;
  }
  show('title');
}

function joinStudentLiveRoom(code, alias) {
  if (studentLive) studentLive.ch.close();
  const cleanAlias = (alias || '학생').trim().slice(0, 12) || '학생';
  const sl = {
    code,
    alias: cleanAlias,
    status: 'connecting',
    state: null,
    question: null,
    votedTile: -1,
    pickedAns: '',
    ch: null
  };
  sl.ch = createLiveChannel(code, {
    onStatus(st) {
      sl.status = st;
      renderLiveStudentScreen();
      if (st === 'connected') {
        sl.ch.send('student_join', { alias: sl.alias });
        sl.ch.send('sync_req', {});
      }
    },
    onMessage(ev, pl) {
      if (ev === 'room_state') {
        sl.state = pl;
        sl.votedTile = -1;
        renderLiveStudentScreen();
      } else if (ev === 'question') {
        sl.question = pl;
        sl.pickedAns = '';
        renderLiveStudentScreen();
      } else if (ev === 'question_closed') {
        sl.question = null;
        sl.pickedAns = '';
        renderLiveStudentScreen();
      } else if (ev === 'room_closed') {
        toast('선생님이 실시간 방을 닫았어요');
        leaveStudentLiveRoom();
      }
    }
  });
  studentLive = sl;
  show('live-student');
  renderLiveStudentScreen();
}

function openLiveJoinModal() {
  openModal(`
    <p class="m-title">📡 실시간 교실 방 참여</p>
    <p class="m-desc">선생님 화면에 표시된 6자리 방 코드와 내 이름을 입력하세요.</p>
    <form id="lj-form" class="tm-grid" style="margin-top:12px">
      <input id="lj-code" class="ed-field" maxlength="8" placeholder="6자리 방 코드 (예: K4M8P2)" style="text-align:center;text-transform:uppercase;letter-spacing:4px">
      <input id="lj-alias" class="ed-field" maxlength="12" value="${esc(setup.solo.name === '나' ? '' : setup.solo.name)}" placeholder="내 이름 또는 학번">
      <div class="m-actions">
        <button type="submit" class="pbtn gold big">📡 방 들어가기</button>
        <button type="button" class="pbtn white" id="m-close">닫기</button>
      </div>
    </form>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#lj-form').onsubmit = e => {
    e.preventDefault();
    const code = normalizeRoomCode($('#lj-code').value);
    if (!code) { toast('6자리 방 코드를 정확히 입력해 주세요'); return; }
    const alias = $('#lj-alias').value.trim() || '학생';
    closeModal();
    joinStudentLiveRoom(code, alias);
  };
}
$('#ls-exit').onclick = leaveStudentLiveRoom;

/* ================= 게임 상태 · 렌더링 ================= */
let S = null;
let undoStack = [];
let lastScores = null;
let gameSession = 0;
let aiFocusTile = -1;
let aiFastTurn = false;
let aiWaitWake = null;

const tileFx = new Map();
let prevRenderedLines = new Set();

function triggerTileFx(indices, cls) {
  if (isReducedMotion()) return;
  indices.forEach(idx => tileFx.set(idx, cls));
  setTimeout(() => {
    indices.forEach(idx => {
      if (tileFx.get(idx) === cls) tileFx.delete(idx);
    });
    const boardEl = $('#board');
    if (boardEl) {
      indices.forEach(idx => {
        const el = boardEl.querySelector(`.tile[data-i="${idx}"]`);
        if (el) el.classList.remove(cls);
      });
    }
  }, 600);
}

function skipAIWait() {
  aiFastTurn = true;
  if (aiWaitWake) { const w = aiWaitWake; aiWaitWake = null; w(); }
}

function aiWait(ms, reduced) {
  const fastMode = !!(S && S.settings && S.settings.aiFast);
  const dur = aiFastTurn ? 35 : (fastMode ? Math.min(reduced, 140) : (isReducedMotion() ? reduced : ms));
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; if (aiWaitWake === fin) aiWaitWake = null; clearTimeout(t); res(); };
    const t = setTimeout(fin, dur);
    aiWaitWake = fin;
  });
}

const isAISessionAlive = sid => sid === gameSession && !!S && !S.over && $('#screen-game').classList.contains('active') && !!(S.teams[S.turn] && S.teams[S.turn].isAI);
const isPCBusyTurn = () => !!(S && !S.over && S.teams[S.turn]?.isAI);
async function waitConfirmClear(sid) { while ($('#confirm-modal').classList.contains('show') && sid === gameSession) await sleep(80); }
function save() { if (S) store('bq_save', S); }
function teamTag(t) { const tm = S.teams[t]; return `${tm.emoji} ${esc(tm.name)}`; }
function addLog(msg) { S.log.push(`[${S.round}R] ${msg}`); if (S.log.length > 300) S.log.shift(); }
function pushUndo() { if (!S || S.teams[S.turn]?.isAI) return; undoStack.push(JSON.stringify(S)); if (undoStack.length > 40) undoStack.shift(); }

function startGame(opts = null) {
  gameSession++;
  aiFocusTile = -1;
  aiFastTurn = false;
  tileFx.clear();
  prevRenderedLines = new Set();

  const st = opts && opts.settings ? { ...DEFAULT_SETTINGS, ...opts.settings } : { ...setup.settings };
  const N = [3, 4, 5].includes(st.boardSize) ? st.boardSize : 5;
  const total = N * N;
  const isSolo = st.playMode === 'solo';
  const customQs = opts && Array.isArray(opts.customQuestions) ? opts.customQuestions : null;
  const activeSet = customQs ? null : getSet(st.setId);
  const parsed = customQs ? customQs.map(q => ({ ...q, opts: q.opts ? [...q.opts] : null })) : parseQuestions(activeSet.text).list;
  let qs = [...parsed];
  if (st.shuffle) shuffle(qs);
  qs = qs.slice(0, total);
  const tiles = Array.from({ length: total }, (_, i) => ({ q: qs[i] || null, owner: -1, opened: false, golden: false, fails: 0 }));
  shuffle([...Array(total).keys()]).slice(0, Math.min(total, st.golden)).forEach(i => { tiles[i].golden = true; });

  const mkTeam = (base, k, isAI = false, aiLevel = undefined) => ({
    name: (base.name || '').trim() || TEAM_PRESETS[k % TEAM_PRESETS.length].name,
    emoji: base.emoji || TEAM_PRESETS[k % TEAM_PRESETS.length].emoji,
    color: TEAM_PRESETS[k % TEAM_PRESETS.length].color,
    dark: TEAM_PRESETS[k % TEAM_PRESETS.length].dark,
    light: TEAM_PRESETS[k % TEAM_PRESETS.length].light,
    bonus: 0,
    shield: 0,
    freeze: 0,
    double: false,
    combo: 0,
    hintsLeft: st.hint5050 ? 1 : 0,
    isAI,
    aiLevel,
    stats: emptyStats()
  });

  let teams;
  if (opts && Array.isArray(opts.teams) && opts.teams.length >= 2) {
    teams = opts.teams.map((t, k) => mkTeam(t, k, !!t.isAI, t.isAI ? (t.aiLevel || st.aiLevel || 'normal') : undefined));
  } else if (isSolo) {
    teams = [
      mkTeam({ name: (setup.solo.name || '').trim() || '나', emoji: setup.solo.emoji || '🦊' }, 0, false),
      mkTeam({ name: 'PC', emoji: '🤖' }, 1, true, st.aiLevel || 'normal')
    ];
  } else {
    teams = setup.teams.slice(0, st.teamCount).map((t, k) => mkTeam(t, k, false));
  }

  const setName = (opts && opts.setName) || (activeSet ? activeSet.name : '퀴즈');
  const setId = (opts && opts.setId) || (activeSet ? activeSet.id : st.setId);
  const shareCode = (opts && opts.shareCode) || (activeSet ? activeSet.shareCode || null : null);

  S = {
    v: 3,
    size: N,
    teams,
    tiles,
    turn: 0,
    round: 1,
    settings: st,
    lineOwners: Array(2 * N + 2).fill(-1),
    pending: null,
    phase: null,
    extra: false,
    lastTile: -1,
    log: [],
    over: false,
    setId,
    setName,
    shareCode,
    customQuestions: customQs,
    statRecorded: false,
    cloudSubmitted: false,
    goalWinners: null
  };
  undoStack = [];
  lastScores = null;
  applyTheme(st.theme);
  applyMotion(st.reduceMotion);
  setBgmStyle(st.bgmStyle);
  show('game');
  render();
  sfx('fanfare');
  announce(
    isSolo ? '🤖 PC와 대결!' : '게임 시작!',
    isSolo ? `${teamTag(0)}부터 시작해요 (${(AI_CONF[st.aiLevel] || AI_CONF.normal).label})` : `${teamTag(0)} 팀부터 시작해요`,
    '',
    1800
  );
}

function resumeGame() {
  S = load('bq_save', null);
  if (!S || !Array.isArray(S.tiles) || !S.teams) return;
  gameSession++;
  aiFocusTile = -1;
  aiFastTurn = false;
  tileFx.clear();
  prevRenderedLines = new Set();
  const rootN = Math.round(Math.sqrt(S.tiles.length));
  S.size = [3, 4, 5].includes(S.size) ? S.size : ([3, 4, 5].includes(rootN) ? rootN : 5);
  S.settings = { ...DEFAULT_SETTINGS, ...(S.settings || {}), boardSize: S.size };
  if (!S.settings.playMode) S.settings.playMode = S.teams.some(t => t.isAI) ? 'solo' : 'team';
  S.teams.forEach((t, k) => {
    const p = TEAM_PRESETS[k % TEAM_PRESETS.length];
    t.color = t.color || p.color;
    t.dark = t.dark || p.dark;
    t.light = t.light || p.light;
    t.bonus = Number(t.bonus) || 0;
    t.shield = Number(t.shield) || 0;
    t.freeze = Number(t.freeze) || 0;
    t.double = !!t.double;
    t.combo = Number(t.combo) || 0;
    t.hintsLeft = t.hintsLeft == null ? (S.settings.hint5050 ? 1 : 0) : Number(t.hintsLeft);
    t.isAI = !!t.isAI;
    if (t.isAI) t.aiLevel = t.aiLevel || S.settings.aiLevel || 'normal';
    t.stats = { ...emptyStats(), ...(t.stats || {}) };
  });
  const lLen = getLines(S.size).length;
  if (!Array.isArray(S.lineOwners) || S.lineOwners.length !== lLen) S.lineOwners = lineOwners(S);
  S.log = Array.isArray(S.log) ? S.log : [];
  S.pending = S.pending || null;
  undoStack = [];
  lastScores = null;
  applyTheme(S.settings.theme);
  applyMotion(S.settings.reduceMotion);
  setBgmStyle(S.settings.bgmStyle);
  show('game');
  render();
  if (!S.over && S.teams[S.turn]?.isAI) { scheduleAITurn(); return; }
  if (S.phase === 'cards') showCards();
  else if (S.phase && S.phase.startsWith('team:')) {
    const r = REWARDS.find(x => x.id === S.phase.slice(5));
    if (r && S.teams.length > 2) pickTeam(r);
    else if (r && S.teams.length === 2) applyTeamEffect(r, S.turn === 0 ? 1 : 0);
    else { S.phase = null; render(); }
  }
}

function render() {
  if (!S) return;
  renderBoard();
  renderTeams();
  renderTop();
  renderBanner();
  save();
  if (liveRoom) broadcastLiveState();
}

function renderBingoLines() {
  const stage = $('#board-stage');
  const boardEl = $('#board');
  const svg = $('#bingo-svg');
  if (!stage || !boardEl || !svg || !S) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) { svg.innerHTML = ''; return; }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const lo = lineOwners(S);
  const lines = getLines(boardN(S));
  const out = [];
  const nextSet = new Set();
  lines.forEach((line, k) => {
    const o = lo[k];
    if (o < 0) return;
    const key = `${k}:${o}`;
    nextSet.add(key);
    const isNew = !prevRenderedLines.has(key);
    const e1 = boardEl.querySelector(`.tile[data-i="${line[0]}"]`);
    const e2 = boardEl.querySelector(`.tile[data-i="${line[line.length - 1]}"]`);
    if (!e1 || !e2) return;
    const x1 = boardEl.offsetLeft + e1.offsetLeft + e1.offsetWidth / 2;
    const y1 = boardEl.offsetTop + e1.offsetTop + e1.offsetHeight / 2;
    const x2 = boardEl.offsetLeft + e2.offsetLeft + e2.offsetWidth / 2;
    const y2 = boardEl.offsetTop + e2.offsetTop + e2.offsetHeight / 2;
    const col = S.teams[o].color;
    const cls = isNew ? ' class="bingo-line-draw"' : '';
    out.push(`<line${cls} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,.85)" stroke-width="11" stroke-linecap="round"/>`);
    out.push(`<line${cls} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`);
  });
  prevRenderedLines = nextSet;
  svg.innerHTML = out.join('');
}

function renderBoard() {
  const N = boardN(S);
  const total = N * N;
  const boardEl = $('#board');
  boardEl.style.setProperty('--n', N);
  if (boardEl.dataset.size !== String(N) || boardEl.children.length !== total) {
    boardEl.dataset.size = String(N);
    boardEl.innerHTML = Array.from({ length: total }, (_, i) => `<button type="button" class="tile" data-i="${i}"></button>`).join('');
  }

  const lo = lineOwners(S);
  const inBingo = new Set();
  getLines(N).forEach((l, k) => { if (lo[k] >= 0) l.forEach(i => inBingo.add(i)); });
  const tg = S.pending ? new Set(validTargets(S, S.pending)) : null;
  const reach = computeReachMap(S);
  const bombAim = S.pending && S.pending.type === 'bomb' && S.pending.aim != null ? new Set([S.pending.aim, ...neighbors(S.pending.aim, N)]) : null;

  S.tiles.forEach((t, i) => {
    const btn = boardEl.children[i];
    if (!btn) return;
    let cls = 'tile';
    let style = '';
    if (t.owner >= 0) {
      const tm = S.teams[t.owner];
      cls += ' owned pat' + (t.owner % 6);
      style = `--f:${tm.color};--s:${tm.dark};--h:${tm.light}`;
    } else if (t.opened) {
      cls += ' empty';
    } else {
      cls += ' closed';
    }
    if (inBingo.has(i)) cls += ' bingo';
    if (t.golden && t.opened) cls += ' golden';
    if (reach.has(i)) { cls += ' reach'; style += `;--rc:${S.teams[reach.get(i)].color}`; }
    if (tg) cls += tg.has(i) ? ' target' : ' dim';
    if (S.pending && ((S.pending.type === 'swap' && S.pending.first === i) || (S.pending.type === 'bomb' && S.pending.aim === i))) cls += ' picked';
    if (i === aiFocusTile) cls += ' ai-focus';
    if (bombAim && bombAim.has(i)) cls += ' blast';
    if (tileFx.has(i)) cls += ' ' + tileFx.get(i);

    const label = t.owner >= 0 ? `${i + 1}번 ${S.teams[t.owner].name} 땅` : t.opened ? `${i + 1}번 빈 땅` : `${i + 1}번 문제`;
    const inner = `<span class="tnum">${i + 1}</span>` +
      (t.owner >= 0 ? `<span class="temo">${S.teams[t.owner].emoji}</span>` : '') +
      (t.golden && t.opened ? '<span class="tstar">⭐</span>' : '') +
      (reach.has(i) ? '<span class="treach" title="빙고 1칸 남음!">🔥</span>' : '') +
      (!t.opened && t.fails ? `<span class="tfail">✖${t.fails}</span>` : '');

    if (btn.className !== cls) btn.className = cls;
    if (btn.getAttribute('style') !== style) {
      if (style) btn.setAttribute('style', style);
      else btn.removeAttribute('style');
    }
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
    if (btn.innerHTML !== inner) btn.innerHTML = inner;
  });

  requestAnimationFrame(renderBingoLines);
}

function renderTeams() {
  const L = $('#side-left');
  const R = $('#side-right');
  $('#arena').classList.toggle('compact-sides', S.teams.length >= 5);
  L.innerHTML = '';
  R.innerHTML = '';
  const scores = S.teams.map((_, k) => score(S, k));
  S.teams.forEach((t, k) => {
    const el = document.createElement('div');
    el.className = 'tcard' + (k === S.turn && !S.over ? ' turn' : '');
    el.style.cssText = `--c:${t.color};--d:${t.dark}`;
    const st = [];
    if (t.isAI) st.push(`<span class="ai-badge">🤖 AI · ${(AI_CONF[t.aiLevel || 'normal'] || AI_CONF.normal).label}</span>`);
    if ((t.combo || 0) >= 2) st.push(`<span class="combo-badge" title="연속 정답">🔥 ${t.combo}연속</span>`);
    if (t.shield) st.push(`<span title="방패">🛡️×${t.shield}</span>`);
    if (t.freeze) st.push(`<span title="얼음">❄️ 쉬기${t.freeze > 1 ? '×' + t.freeze : ''}</span>`);
    if (t.double) st.push('<span title="2배 찬스">✨2배</span>');
    if (k === S.turn && S.extra) st.push('<span>⏩한 번 더</span>');
    el.innerHTML = `<button type="button" class="tcard-manage" data-manage="${k}" title="${esc(t.name)} 점수·상태·차례 관리" aria-label="${esc(t.name)} 관리">⚙️</button>
      <div class="ava">${t.emoji}</div><div class="nm"><span class="swatch pat${k % 6}" title="우리 팀 땅 무늬"></span>${esc(t.name)}</div><div class="sc">${scores[k]}</div>
      <div class="meta"><span>🏳️ ${tileCount(S, k)}칸</span><span>🎯 ${bingoCount(S, k)}줄</span><span>💰 ${t.bonus >= 0 ? '+' : ''}${t.bonus}</span></div>
      <div class="st">${st.join('')}</div>
      <div class="adj"><button data-adj="${k}" data-v="-10">−10</button><button data-adj="${k}" data-v="10">+10</button></div>`;
    (k % 2 ? R : L).appendChild(el);
    if (lastScores && lastScores[k] !== undefined && lastScores[k] !== scores[k]) {
      const d = scores[k] - lastScores[k];
      const f = document.createElement('div');
      f.className = 'float ' + (d > 0 ? 'p' : 'm');
      f.textContent = (d > 0 ? '+' : '') + d;
      el.appendChild(f);
      el.classList.add('pop');
    }
  });
  lastScores = scores;
}

function renderTop() {
  const { scores, order, rank } = computeStanding(S);
  $('#rankbar').innerHTML = order.map(k => {
    const r = rank(k);
    return `<div class="rk ${r === 1 ? 'first' : ''}"><span class="e">${S.teams[k].emoji}</span>${r}위</div>`;
  }).join('');
  const mob = $('#mob-scores');
  if (mob) {
    mob.innerHTML = order.map(k => {
      const t = S.teams[k];
      const r = rank(k);
      const b = bingoCount(S, k);
      const badges = `${t.shield ? '🛡️' : ''}${t.freeze ? '❄️' : ''}${t.double ? '✨' : ''}${(t.combo || 0) >= 2 ? `🔥${t.combo}` : ''}`;
      return `<button type="button" class="ms-chip${k === S.turn && !S.over ? ' turn' : ''}" data-manage="${k}" style="--c:${t.color};--d:${t.dark}" title="눌러서 점수·차례 관리">${r}위 ${t.emoji} ${esc(t.name)} <b class="ms-sc">${scores[k]}점</b>${b ? ` · 🎯${b}` : ''}${badges ? ` <span>${badges}</span>` : ''}</button>`;
    }).join('');
  }
  const lim = S.settings.roundLimit;
  $('#round').innerHTML = `<b>${S.round}</b><span class="hide-sm">라운드</span><span class="show-sm-inline">R</span>${lim ? ` <span style="font-size:13px;opacity:.75">/ ${lim}</span>` : ''}`;
  const showR = $('#round').querySelector('.show-sm-inline');
  if (showR) showR.style.display = window.innerWidth <= 900 ? 'inline' : 'none';
  $('#g-bgm').classList.toggle('off', !AU.bgm);
  $('#g-sfx').classList.toggle('off', !AU.sfx);
  $('#g-vol').textContent = volLabel();
  $('#g-undo').disabled = !undoStack.length;
  $('#undo-cnt').textContent = `(${undoStack.length})`;
  const fsOn = !!document.fullscreenElement;
  $('#g-fs').textContent = fsOn ? '⛶ 창모드' : '⛶ 전체화면';
  refreshLiveHostUI();
  const mBgm = $('[data-more="bgm"]');
  const mSfx = $('[data-more="sfx"]');
  const mVol = $('[data-more="vol"]');
  const mFs = $('[data-more="fs"]');
  if (mBgm) mBgm.textContent = AU.bgm ? '♫ 음악 (켜짐)' : '♫ 음악 (꺼짐)';
  if (mSfx) mSfx.textContent = AU.sfx ? '♪ 효과음 (켜짐)' : '♪ 효과음 (꺼짐)';
  if (mVol) mVol.textContent = `${volLabel()} (음량)`;
  if (mFs) mFs.textContent = fsOn ? '⛶ 전체화면 끄기' : '⛶ 전체화면';
}

function getTopTileVote() {
  if (!liveRoom || !liveRoom.tileVotes.size || !S) return null;
  const counts = new Map();
  for (const idx of liveRoom.tileVotes.values()) {
    if (S.tiles[idx] && !S.tiles[idx].opened) counts.set(idx, (counts.get(idx) || 0) + 1);
  }
  if (!counts.size) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { idx: best[0], count: best[1] };
}

function renderBanner() {
  const t = S.teams[S.turn];
  const b = $('#banner');
  b.style.setProperty('--c', t.color);
  b.classList.toggle('pending', !!S.pending);
  if (S.over) {
    b.innerHTML = `<span>🏁 게임이 끝났어요!</span><button type="button" class="pbtn sm gold" id="go-result">🏆 결과 다시 보기</button>`;
    return;
  }
  const goalTag = S.settings.bingoGoal ? `<span class="goal-pill">🎯 목표 ${S.settings.bingoGoal}줄</span>` : '';
  const comboTag = (t.combo || 0) >= 2 ? `<span class="combo-pill">🔥 ${t.combo}연속</span>` : '';
  const voteTop = !S.pending ? getTopTileVote() : null;
  const voteTag = voteTop ? `<span class="live-vote-pill">📡 투표 1위: ${voteTop.idx + 1}번 (${voteTop.count}명)</span>` : '';
  if (t.isAI) {
    const left = S.tiles.filter(x => !x.opened).length;
    const msg = S.pending ? '🤖 PC가 카드 효과를 사용하는 중...' : '🤖 PC가 도전할 칸을 고르고 있어요...';
    b.innerHTML = `<span class="b-e">${t.emoji}</span><span><b>${esc(t.name)}</b> · ${msg}</span>${goalTag}<span style="font-size:.82em;color:var(--muted)">남은 칸 ${left}</span>`;
    return;
  }
  if (S.pending) {
    const p = S.pending;
    if (p.type === 'bomb' && p.aim != null) {
      b.innerHTML = `<span class="b-e">${t.emoji}</span><span><b>${esc(t.name)}</b> · 💣 ${p.aim + 1}번 칸 조준! (위·아래·왼쪽·오른쪽)</span><button type="button" class="pbtn sm bad" id="confirm-bomb">💥 여기 터뜨리기!</button><button type="button" class="pbtn sm ghost" id="skip-pending">건너뛰기</button>`;
      return;
    }
    const msg = {
      grab: '🚩 땅따먹기! 반짝이는 빈 칸 하나를 골라 차지하세요',
      steal: '🗡️ 땅 뺏기! 빼앗을 다른 팀 칸을 고르세요',
      swap: p.step === 1 ? '🔄 칸 바꾸기! 먼저 내줄 우리 팀 칸을 고르세요' : '🔄 이제 가져올 다른 팀 칸을 고르세요',
      bomb: '💣 폭탄! 터뜨릴 가운데 칸을 고르세요 (1번 눌러 범위 확인)'
    }[p.type];
    b.innerHTML = `<span class="b-e">${t.emoji}</span><span><b>${esc(t.name)}</b> · ${msg}</span><button type="button" class="pbtn sm ghost" id="skip-pending">건너뛰기</button>`;
  } else {
    const left = S.tiles.filter(x => !x.opened).length;
    b.innerHTML = `<span class="b-e">${t.emoji}</span><span><b>${esc(t.name)}</b> 차례! 도전할 칸을 골라 주세요</span>${goalTag}${comboTag}${voteTag}<span style="font-size:.82em;color:var(--muted)">남은 칸 ${left}</span>`;
  }
}

/* ================= 게임 중 빠른 설정 · 팀 관리 모달 ================= */
function openQuickSettings() {
  if (!S) return;
  if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  const st = S.settings;
  const isSolo = st.playMode === 'solo';
  openModal(`
    <p class="m-title">⚙️ 게임 중 빠른 설정</p>
    <div class="tm-grid">
      <div class="opt-row"><label>배경 테마</label><select id="qs-theme"><option value="forest">🍂 가을 숲</option><option value="ocean">🌊 바닷속</option><option value="space">🚀 우주 (다크)</option><option value="chalkboard">🖍️ 칠판 다크</option></select></div>
      <div class="opt-row"><label>배경 음악 분위기</label><select id="qs-bgm"><option value="upbeat">🎶 활기찬 대결</option><option value="calm">🎵 차분한 복습</option></select></div>
      <div class="opt-row"><label>제한 시간</label><select id="qs-timer"><option value="0">없음</option><option value="15">15초</option><option value="20">20초</option><option value="30">30초</option><option value="60">60초</option></select></div>
      <div class="opt-row"><label for="qs-ttsauto">🔊 문제 자동 읽어주기</label><input type="checkbox" id="qs-ttsauto"></div>
      <div class="opt-row"><label>읽기 속도</label><select id="qs-ttsrate"><option value="0.8">🐢 천천히</option><option value="1">보통</option><option value="1.15">🐇 빠르게</option></select></div>
      <div class="opt-row"><label for="qs-autonext">정답 후 자동 넘김</label><input type="checkbox" id="qs-autonext"></div>
      <div class="opt-row"><label for="qs-reach">빙고 직전 🔥 힌트</label><input type="checkbox" id="qs-reach"></div>
      <div class="opt-row"><label for="qs-hint50">💡 힌트 찬스 허용</label><input type="checkbox" id="qs-hint50"></div>
      <div class="opt-row"><label for="qs-motion">애니메이션 줄이기</label><input type="checkbox" id="qs-motion"></div>
      ${isSolo ? `<div class="opt-row"><label for="qs-aifast">⏩ PC 차례 빠르게</label><input type="checkbox" id="qs-aifast"></div>` : ''}
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">적용하고 닫기</button></div>`, 'narrow', 'settings');

  $('#qs-theme').value = st.theme || 'forest';
  $('#qs-bgm').value = st.bgmStyle || 'upbeat';
  $('#qs-timer').value = String(st.timer || 0);
  $('#qs-ttsauto').checked = !!st.ttsAuto;
  $('#qs-ttsrate').value = String(st.ttsRate || 1);
  $('#qs-autonext').checked = !!st.autoNext;
  $('#qs-reach').checked = !!st.reachHint;
  $('#qs-hint50').checked = !!st.hint5050;
  $('#qs-motion').checked = !!st.reduceMotion;
  if ($('#qs-aifast')) $('#qs-aifast').checked = !!st.aiFast;

  const sync = () => {
    st.theme = $('#qs-theme').value;
    st.bgmStyle = $('#qs-bgm').value;
    st.timer = +$('#qs-timer').value;
    st.ttsAuto = $('#qs-ttsauto').checked;
    st.ttsRate = +$('#qs-ttsrate').value || 1;
    st.autoNext = $('#qs-autonext').checked;
    st.reachHint = $('#qs-reach').checked;
    st.hint5050 = $('#qs-hint50').checked;
    st.reduceMotion = $('#qs-motion').checked;
    if ($('#qs-aifast')) st.aiFast = $('#qs-aifast').checked;
    Object.assign(setup.settings, {
      theme: st.theme, bgmStyle: st.bgmStyle, timer: st.timer,
      ttsAuto: st.ttsAuto, ttsRate: st.ttsRate, autoNext: st.autoNext,
      reachHint: st.reachHint, hint5050: st.hint5050, reduceMotion: st.reduceMotion, aiFast: st.aiFast
    });
    saveSetup();
    applyTheme(st.theme);
    applyMotion(st.reduceMotion);
    setBgmStyle(st.bgmStyle);
    render();
  };
  ['#qs-theme', '#qs-bgm', '#qs-timer', '#qs-ttsauto', '#qs-ttsrate', '#qs-autonext', '#qs-reach', '#qs-hint50', '#qs-motion', '#qs-aifast'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', sync);
  });
  $('#m-close').onclick = closeModal;
}

function openTeamManage(k) {
  if (!S) return;
  const t = S.teams[k];
  const canTurn = !S.over && !S.pending && k !== S.turn;
  const box = openModal(`
    <div class="q-head" style="--c:${t.color}"><span>${t.emoji} ${esc(t.name)} 관리</span><span class="q-no" id="tm-score">${score(S, k)}점</span></div>
    <div class="tm-grid">
      <div class="tm-row">
        <h4>💰 점수 직접 조정 <small style="color:var(--muted)">(현재 보너스: <span id="tm-bonus">${t.bonus >= 0 ? '+' : ''}${t.bonus}</span>)</small></h4>
        <div class="tm-btns">
          <button type="button" class="pbtn sm bad" data-tadj="-20">−20</button>
          <button type="button" class="pbtn sm bad" data-tadj="-10">−10</button>
          <button type="button" class="pbtn sm bad" data-tadj="-5">−5</button>
          <button type="button" class="pbtn sm ok" data-tadj="5">+5</button>
          <button type="button" class="pbtn sm ok" data-tadj="10">+10</button>
          <button type="button" class="pbtn sm ok" data-tadj="20">+20</button>
        </div>
      </div>
      <div class="tm-row">
        <h4>🛡️ 상태 효과 조정</h4>
        <div class="tm-btns">
          <button type="button" class="pbtn sm white" data-tstat="shield:-1">🛡️ −</button>
          <b id="tm-sh">방패 ${t.shield}</b>
          <button type="button" class="pbtn sm white" data-tstat="shield:1">🛡️ +</button>
          <span style="width:10px"></span>
          <button type="button" class="pbtn sm white" data-tstat="freeze:-1">❄️ −</button>
          <b id="tm-fr">쉬기 ${t.freeze}</b>
          <button type="button" class="pbtn sm white" data-tstat="freeze:1">❄️ +</button>
          <span style="width:10px"></span>
          <button type="button" class="pbtn sm ${t.double ? 'gold' : 'white'}" id="tm-dbl">✨ 2배: ${t.double ? '켜짐' : '꺼짐'}</button>
        </div>
      </div>
      <div class="tm-row">
        <h4>▶ 차례 바꾸기</h4>
        <div class="tm-btns">
          <button type="button" class="pbtn blue" id="tm-turn" ${canTurn ? '' : 'disabled'}>▶ ${esc(t.name)} 차례로 바꾸기</button>
          ${canTurn ? '' : `<small style="color:var(--muted)">${S.over ? '종료된 게임이에요' : S.pending ? '특수 카드 효과를 먼저 마무리하세요' : '이미 이 팀 차례예요'}</small>`}
        </div>
      </div>
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'narrow', 'manage');
  const syncView = () => {
    $('#tm-score').textContent = score(S, k) + '점';
    $('#tm-bonus').textContent = (t.bonus >= 0 ? '+' : '') + t.bonus;
    $('#tm-sh').textContent = '방패 ' + t.shield;
    $('#tm-fr').textContent = '쉬기 ' + t.freeze;
    const dbl = $('#tm-dbl');
    dbl.textContent = '✨ 2배: ' + (t.double ? '켜짐' : '꺼짐');
    dbl.className = 'pbtn sm ' + (t.double ? 'gold' : 'white');
  };
  box.querySelectorAll('[data-tadj]').forEach(b => b.onclick = () => {
    const actor = S.settings.playMode === 'solo' ? '수동 조정' : '선생님';
    const v = +b.dataset.tadj;
    t.bonus += v;
    addLog(`${actor}: ${t.name} ${v > 0 ? '+' : ''}${v}점`);
    sfx(v > 0 ? 'coin' : 'click');
    render();
    syncView();
  });
  box.querySelectorAll('[data-tstat]').forEach(b => b.onclick = () => {
    const [key, d] = b.dataset.tstat.split(':');
    t[key] = Math.max(0, Math.min(5, t[key] + Number(d)));
    sfx('click');
    render();
    syncView();
  });
  $('#tm-dbl').onclick = () => { t.double = !t.double; sfx('click'); render(); syncView(); };
  $('#tm-turn').onclick = () => {
    if (!canTurn) return;
    const actor = S.settings.playMode === 'solo' ? '수동 조정' : '선생님';
    gameSession++;
    aiFocusTile = -1;
    S.turn = k;
    addLog(`${actor}: ${t.name} 차례로 변경`);
    sfx('turn');
    closeModal();
    render();
    toast(`▶ ${t.name} 차례로 바꿨어요`);
    if (S.teams[S.turn]?.isAI) scheduleAITurn();
  };
  $('#m-close').onclick = closeModal;
}

/* ================= 게임 진행 · 문제 모달 ================= */
function pickTile(i) {
  if (busy || !S || S.over || $('#modal').classList.contains('show') || S.teams[S.turn]?.isAI) return;
  if (S.pending) { handleTarget(i); return; }
  const t = S.tiles[i];
  if (t.opened) { toast(t.owner >= 0 ? `이미 ${S.teams[t.owner].name}의 땅이에요` : '빈 땅은 🚩땅따먹기 카드로만 차지할 수 있어요'); return; }
  pushUndo();
  sfx('open');
  if (!t.q) { luckyTile(i); return; }
  openQuestion(i);
}

async function luckyTile(i) {
  const sid = gameSession;
  await announce('🍀 행운 칸!', '문제 없이 이 칸을 차지해요', 'gold', 1600);
  if (sid !== gameSession || !S || S.over) return;
  resolveCorrect(i, true);
}

let qScale = Math.min(1.35, Math.max(0.8, Number(load('bq_qscale', 1)) || 1));

function openQuestion(i) {
  const tile = S.tiles[i];
  const q = tile.q;
  const team = S.teams[S.turn];
  const opts = q.opts ? shuffle([...q.opts]) : null;
  const isSolo = S.settings.playMode === 'solo';
  const isSoloSA = !opts && isSolo && !team.isAI;
  const canHintMC = !!(opts && opts.length >= 4 && S.settings.hint5050 && (team.hintsLeft || 0) > 0);
  const canHintSA = !!(!opts && S.settings.hint5050 && (team.hintsLeft || 0) > 0 && makeChosungHint(q.a));
  const longCls = q.q.length > 65 ? ' long' : '';
  const speech = getSpeechSpec(q.q);
  const ttsBtn = isTtsSupported() ? `<button type="button" class="q-tts-btn" id="q-tts" title="문제 읽어주기">🔊 읽기</button>` : '';
  const imgHtml = q.img && isSafeImageUrl(q.img) ? `<img class="q-img" src="${esc(q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';

  if (liveRoom) {
    liveRoom.qIndex = i;
    liveRoom.qAnswers.clear();
    liveRoom.ch.send('question', { qIndex: i, q: q.q, opts, isMc: !!opts, img: q.img || '' });
  }

  const box = openModal(`
    <div class="q-head" style="--c:${team.color}">
      <span>${teamTag(S.turn)} 도전!</span>
      <div class="q-head-r">
        ${ttsBtn}
        <button type="button" class="q-fbtn" id="q-fdec" title="글자 작게">A-</button>
        <button type="button" class="q-fbtn" id="q-finc" title="글자 크게">A+</button>
        <span class="q-no">${i + 1}번 문제${tile.fails ? ` · ${tile.fails}번 틀린 문제` : ''}</span>
      </div>
    </div>
    ${S.settings.timer ? `<div class="q-timer-wrap">
      <div class="q-timer" id="q-timer"><div id="q-bar"></div><span id="q-sec">${S.settings.timer}초</span></div>
      <button type="button" class="pbtn sm white" id="q-pause" title="일시정지 (P)">⏸</button>
      <button type="button" class="pbtn sm white" id="q-plus10" title="10초 추가 (+)">+10초</button>
    </div>` : ''}
    ${imgHtml}
    <div class="q-text${longCls}">${formatRichText(q.q)}</div>
    <div id="q-hint-box" class="q-hint-box hidden"></div>
    ${opts ? `<div class="q-opts">${opts.map((o, k) => `<button class="q-opt" data-k="${k}"><b>${'①②③④⑤⑥'[k]}</b>${formatRichText(o)}<kbd class="kh">${k + 1}</kbd></button>`).join('')}</div>`
      : `${isSoloSA ? `<form class="q-sa-form" id="q-sa-form"><input type="text" id="q-sa-input" placeholder="정답을 입력하고 Enter" autocomplete="off"><button type="submit" class="pbtn gold" id="q-sa-submit">제출</button></form>` : ''}
         <div class="q-answer" id="q-answer">정답: <b>${formatRichText(q.a)}</b></div>`}
    ${q.explain ? `<div class="q-explain hidden" id="q-explain">💡 <b>해설:</b> ${formatRichText(q.explain)}</div>` : ''}
    <div id="live-resp-box" class="live-resp-box hidden"></div>
    <div class="q-msg" id="q-msg"></div>
    <div class="q-actions" id="q-actions">
      ${opts ? '' : (isSoloSA ? `<button class="pbtn white" id="q-reveal">👀 정답 확인 (직접 채점)</button>` : `<button class="pbtn gold" id="q-reveal">👀 정답 보기<kbd class="kh">Space</kbd></button><button class="pbtn ok" id="q-ok">⭕ 맞혔어요<kbd class="kh">O</kbd></button><button class="pbtn bad" id="q-no">❌ 틀렸어요<kbd class="kh">X</kbd></button>`)}
      ${canHintMC ? `<button type="button" class="pbtn blue" id="q-hint">💡 50:50 찬스 (${team.hintsLeft})</button>` : ''}
      ${canHintSA ? `<button type="button" class="pbtn blue" id="q-sa-hint">💡 초성·철자 힌트 (${team.hintsLeft})</button>` : ''}
      ${isSolo ? '' : `<button class="pbtn ghost" id="q-cancel">↩ 문제 닫기 (다른 칸 고르기)<kbd class="kh">Esc</kbd></button>`}
    </div>`, '', 'question', () => {
      if (liveRoom) {
        liveRoom.qIndex = -1;
        liveRoom.ch.send('question_closed', {});
      }
    });

  box.style.setProperty('--qscale', qScale);
  refreshLiveHostUI();
  if ($('#q-tts')) $('#q-tts').onclick = () => speakText(speech.text, speech.lang, S.settings.ttsRate || 1);
  if (S.settings.ttsAuto && isTtsSupported()) {
    setTimeout(() => { if ($('#modal').classList.contains('show')) speakText(speech.text, speech.lang, S.settings.ttsRate || 1); }, 120);
  }
  $('#q-fdec').onclick = () => { qScale = Math.max(0.8, +(qScale - 0.1).toFixed(2)); box.style.setProperty('--qscale', qScale); store('bq_qscale', qScale); };
  $('#q-finc').onclick = () => { qScale = Math.min(1.35, +(qScale + 0.1).toFixed(2)); box.style.setProperty('--qscale', qScale); store('bq_qscale', qScale); };

  let answered = false;
  let proceeded = false;
  const revealExplain = () => { const ex = $('#q-explain'); if (ex) ex.classList.remove('hidden'); };
  const goNextNow = ok => { if (proceeded) return; proceeded = true; clearAutoNext(); closeModal(); ok ? resolveCorrect(i) : resolveWrong(i); };
  const finish = (ok, delay) => {
    if (answered) return;
    answered = true;
    stopTimer();
    box.querySelectorAll('.q-opt,#q-reveal,#q-ok,#q-no,#q-cancel,#q-pause,#q-plus10,#q-sa-input,#q-sa-submit,#q-hint,#q-sa-hint').forEach(b => { b.disabled = true; });
    revealExplain();
    const nextLbl = ok && S.settings.rewards ? '🎁 보상 카드 뽑기 ▶' : '다음으로 ▶';
    const act = $('#q-actions');
    act.classList.add('finished');
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'pbtn gold big';
    nextBtn.id = 'q-next';
    nextBtn.innerHTML = `${nextLbl}<kbd class="kh">Enter</kbd>`;
    nextBtn.onclick = () => goNextNow(ok);
    act.appendChild(nextBtn);
    nextBtn.focus();
    if (S.settings.autoNext && !q.explain) {
      autoNextTimer = setTimeout(() => goNextNow(ok), delay);
    }
  };

  if ($('#q-hint')) {
    $('#q-hint').onclick = () => {
      if (answered || (team.hintsLeft || 0) <= 0) return;
      const wrongBtns = [...box.querySelectorAll('.q-opt')].filter(b => opts[+b.dataset.k] !== q.a && !b.disabled);
      if (wrongBtns.length < 2) return;
      shuffle(wrongBtns).slice(0, 2).forEach(b => {
        b.disabled = true;
        b.classList.add('eliminated');
      });
      team.hintsLeft--;
      $('#q-hint').disabled = true;
      $('#q-hint').textContent = '💡 50:50 사용됨';
      sfx('hint');
      addLog(`${team.emoji} ${team.name}: 💡 50:50 찬스 사용`);
    };
  }
  if ($('#q-sa-hint')) {
    $('#q-sa-hint').onclick = () => {
      if (answered || (team.hintsLeft || 0) <= 0) return;
      const hintTxt = makeChosungHint(q.a);
      if (!hintTxt) return;
      team.hintsLeft--;
      const hb = $('#q-hint-box');
      hb.textContent = `💡 힌트: ${hintTxt}`;
      hb.classList.remove('hidden');
      $('#q-sa-hint').disabled = true;
      $('#q-sa-hint').textContent = '💡 힌트 사용됨';
      sfx('hint');
      addLog(`${team.emoji} ${team.name}: 💡 초성·철자 힌트 사용`);
    };
  }

  const revealMC = () => box.querySelectorAll('.q-opt').forEach(b => { if (opts[+b.dataset.k] === q.a) b.classList.add('right'); });

  if (opts) {
    box.querySelectorAll('.q-opt').forEach(b => b.onclick = () => {
      if (answered) return;
      const ok = opts[+b.dataset.k] === q.a;
      b.classList.add(ok ? 'right' : 'wrong');
      if (ok) { sfx('correct'); vibrate(20); $('#q-msg').textContent = '⭕ 정답!'; }
      else { sfx('wrong'); vibrate([30, 40, 30]); $('#q-msg').textContent = '❌ 아쉬워요!'; if (S.settings.wrongMode === 'reveal') revealMC(); }
      finish(ok, ok ? 1000 : 1600);
    });
  } else if (isSoloSA) {
    const inp = $('#q-sa-input');
    setTimeout(() => inp && inp.focus(), 30);
    $('#q-sa-form').onsubmit = e => {
      e.preventDefault();
      if (answered) return;
      const val = inp.value.trim();
      if (!val) { toast('정답을 입력해 주세요'); inp.focus(); return; }
      $('#q-answer').classList.add('show');
      revealExplain();
      if (matchShortAnswer(val, q.a, q.q)) {
        sfx('correct');
        vibrate(20);
        $('#q-msg').textContent = '⭕ 정답!';
        finish(true, 900);
      } else {
        answered = true;
        stopTimer();
        sfx('wrong');
        vibrate([30, 40, 30]);
        box.querySelectorAll('#q-reveal,#q-cancel,#q-pause,#q-plus10,#q-sa-input,#q-sa-submit,#q-sa-hint').forEach(b => { b.disabled = true; });
        $('#q-msg').textContent = `❌ 입력: “${val}” — 정답과 달라요`;
        const act = $('#q-actions');
        act.innerHTML = `<button type="button" class="pbtn ok" id="q-sa-override">⭕ 사실 맞았어요<kbd class="kh">O</kbd></button><button type="button" class="pbtn bad" id="q-sa-confirm-no">❌ 틀림으로 진행 ▶<kbd class="kh">X</kbd></button>`;
        $('#q-sa-override').onclick = () => { sfx('correct'); goNextNow(true); };
        $('#q-sa-confirm-no').onclick = () => goNextNow(false);
        $('#q-sa-confirm-no').focus();
      }
    };
    $('#q-reveal').onclick = () => {
      if (answered) return;
      answered = true;
      stopTimer();
      sfx('flip');
      $('#q-answer').classList.add('show');
      revealExplain();
      box.querySelectorAll('#q-reveal,#q-cancel,#q-pause,#q-plus10,#q-sa-input,#q-sa-submit,#q-sa-hint').forEach(b => { b.disabled = true; });
      const act = $('#q-actions');
      act.innerHTML = `<button type="button" class="pbtn ok" id="q-sa-override">⭕ 맞혔어요<kbd class="kh">O</kbd></button><button type="button" class="pbtn bad" id="q-sa-confirm-no">❌ 틀렸어요 ▶<kbd class="kh">X</kbd></button>`;
      $('#q-sa-override').onclick = () => { sfx('correct'); goNextNow(true); };
      $('#q-sa-confirm-no').onclick = () => goNextNow(false);
      $('#q-sa-confirm-no').focus();
    };
  } else {
    $('#q-reveal').onclick = () => { sfx('flip'); $('#q-answer').classList.add('show'); revealExplain(); };
    $('#q-ok').onclick = () => { $('#q-answer').classList.add('show'); sfx('correct'); vibrate(20); $('#q-msg').textContent = '⭕ 정답!'; finish(true, 900); };
    $('#q-no').onclick = () => { sfx('wrong'); $('#q-msg').textContent = '❌ 아쉬워요!'; if (S.settings.wrongMode === 'reveal') $('#q-answer').classList.add('show'); finish(false, S.settings.wrongMode === 'reveal' ? 1800 : 900); };
  }

  if ($('#q-cancel')) {
    $('#q-cancel').onclick = () => { if (answered) return; stopTimer(); closeModal(); undoStack.pop(); renderTop(); };
  }

  if (S.settings.timer) {
    let totalMs = S.settings.timer * 1000;
    let leftMs = totalMs;
    let paused = false;
    let lastTick = Date.now();
    let lastSec = Math.ceil(leftMs / 1000);
    const updateBar = () => {
      const bar = $('#q-bar');
      const wrap = $('#q-timer');
      const secEl = $('#q-sec');
      if (!bar || !wrap || !secEl) return;
      const sec = Math.ceil(leftMs / 1000);
      bar.style.width = Math.min(100, Math.max(0, (leftMs / totalMs) * 100)) + '%';
      secEl.textContent = paused ? `⏸ 일시정지 (${sec}초)` : `${sec}초`;
      wrap.classList.toggle('urgent', sec <= 5 && leftMs > 0 && !paused);
      if (sec !== lastSec && sec <= 5 && sec > 0 && !paused) sfx('tick');
      lastSec = sec;
    };
    $('#q-pause').onclick = () => { if (answered) return; paused = !paused; lastTick = Date.now(); $('#q-pause').textContent = paused ? '▶' : '⏸'; updateBar(); };
    $('#q-plus10').onclick = () => { if (answered) return; leftMs += 10000; totalMs = Math.max(totalMs, leftMs); lastTick = Date.now(); sfx('click'); updateBar(); };
    qTimer = setInterval(() => {
      const now = Date.now();
      if (!paused) leftMs = Math.max(0, leftMs - (now - lastTick));
      lastTick = now;
      if (!$('#q-bar')) { stopTimer(); return; }
      updateBar();
      if (leftMs <= 0) {
        stopTimer();
        sfx('wrong');
        $('#q-msg').textContent = '⏰ 시간 종료!';
        if (opts) { if (S.settings.wrongMode === 'reveal') revealMC(); finish(false, 1600); }
        else if (isSoloSA) { $('#q-answer').classList.add('show'); finish(false, 1600); }
        else { $('#q-answer').classList.add('show'); revealExplain(); }
      }
    }, 100);
  }
}

function checkBingoGoalWin() {
  const goal = S && S.settings && +S.settings.bingoGoal;
  if (!goal || S.over) return false;
  const winners = S.teams.map((_, k) => k).filter(k => bingoCount(S, k) >= goal);
  if (!winners.length) return false;
  S.goalWinners = winners;
  gameOver(`🎯 ${winners.map(k => S.teams[k].name).join('·')} 빙고 ${goal}줄 달성!`);
  return true;
}

async function resolveCorrect(i, lucky = false) {
  const sid = gameSession;
  const me = S.turn;
  const tile = S.tiles[i];
  const team = S.teams[me];
  tile.owner = me;
  tile.opened = true;
  S.lastTile = i;
  triggerTileFx([i], 'just-claimed');
  if (lucky) {
    team.stats.lucky++;
  } else {
    team.stats.correct++;
    team.combo = (team.combo || 0) + 1;
    team.stats.maxCombo = Math.max(team.stats.maxCombo || 0, team.combo);
    if (team.combo >= 3) {
      sfx('combo');
      toast(`🔥 ${team.name} ${team.combo}연속 정답!`);
    }
  }
  if (team.double) {
    team.bonus += S.settings.tilePts * (tile.golden ? 2 : 1);
    team.double = false;
    toast('✨ 2배 찬스 발동! 칸 점수를 한 번 더 받아요');
  }
  addLog(`${team.emoji} ${team.name}: ${i + 1}번 칸 ${lucky ? '행운 칸으로 차지' : '정답! 차지'}${tile.golden ? ' (⭐황금 칸)' : ''}`);
  render();
  if (tile.golden) {
    sfx('gold');
    await announce('⭐ 황금 칸!', `${i + 1}번 칸은 2칸만큼 점수가 돼요`, 'gold');
    if (sid !== gameSession || !S || S.over) return;
  }
  await checkBingo();
  if (sid !== gameSession || !S || S.over) return;
  if (checkBingoGoalWin()) return;
  if (S.settings.rewards) showCards();
  else endTurn();
}

function resolveWrong(i) {
  const tile = S.tiles[i];
  const team = S.teams[S.turn];
  tile.fails++;
  team.stats.wrong++;
  team.combo = 0;
  if (S.settings.wrongMode === 'reveal') tile.opened = true;
  addLog(`${team.emoji} ${team.name}: ${i + 1}번 문제 오답${S.settings.wrongMode === 'reveal' ? ' → 빈 땅' : ''}`);
  endTurn();
}

async function checkBingo() {
  const sid = gameSession;
  const N = boardN(S);
  const now = lineOwners(S);
  const prev = S.lineOwners || Array(2 * N + 2).fill(-1);
  const gained = {};
  const lost = {};
  now.forEach((o, k) => {
    if (o >= 0 && prev[k] !== o) gained[o] = (gained[o] || 0) + 1;
    if (prev[k] >= 0 && o !== prev[k]) lost[prev[k]] = (lost[prev[k]] || 0) + 1;
  });
  S.lineOwners = now;
  S.teams.forEach((tm, k) => { tm.stats.maxBingo = Math.max(tm.stats.maxBingo || 0, bingoCount(S, k)); });
  render();
  for (const t in lost) {
    toast(`💔 ${S.teams[t].name}의 빙고 ${lost[t]}줄이 깨졌어요!`);
    addLog(`${S.teams[t].name} 빙고 ${lost[t]}줄 깨짐`);
  }
  for (const t in gained) {
    if (sid !== gameSession || !S) return;
    sfx('bingo');
    vibrate([40, 30, 60]);
    confetti();
    addLog(`🎯 ${S.teams[t].name} 빙고 ${gained[t]}줄!`);
    await announce('BINGO!', `${teamTag(+t)} 빙고 ${gained[t]}줄 · +${gained[t] * S.settings.bingoPts}점`, 'bingo', 2300);
    if (sid !== gameSession || !S) return;
  }
}

async function endTurn() {
  const sid = gameSession;
  S.pending = null;
  S.phase = null;
  if (liveRoom) liveRoom.tileVotes.clear();
  if (!S.tiles.some(t => !t.opened)) {
    render();
    await sleep(300);
    if (sid !== gameSession || !S || S.over) return;
    gameOver('모든 칸이 열렸어요');
    return;
  }
  if (S.extra) {
    S.extra = false;
    render();
    toast(`⏩ ${S.teams[S.turn].name} 한 번 더!`);
    sfx('turn');
    aiFastTurn = false;
    if (!S.over && S.teams[S.turn]?.isAI) scheduleAITurn();
    return;
  }
  const n = S.teams.length;
  for (let guard = 0; guard < n * 6; guard++) {
    S.turn = (S.turn + 1) % n;
    if (S.turn === 0) {
      S.round++;
      if (S.settings.roundLimit && S.round > S.settings.roundLimit) {
        S.round = S.settings.roundLimit;
        render();
        gameOver(`${S.settings.roundLimit}라운드가 모두 끝났어요`);
        return;
      }
      toast(`🔔 ${S.round}라운드 시작!`);
    }
    const tm = S.teams[S.turn];
    if (tm.freeze > 0) {
      tm.freeze--;
      toast(`❄️ ${tm.name}은(는) 얼어서 이번 차례를 쉬어요`);
      addLog(`${tm.name} 얼음으로 쉬기`);
      sfx('freeze');
      continue;
    }
    break;
  }
  render();
  sfx('turn');
  aiFastTurn = false;
  if (!S.over && S.teams[S.turn]?.isAI) scheduleAITurn();
}

async function submitSoloCloudIfNeeded(manualRetry = false) {
  if (!S || !S.shareCode || S.settings.playMode !== 'solo') return;
  if (S.cloudSubmitted && !manualRetry) return;
  const { rank } = computeStanding(S);
  const h = S.teams[0];
  const missed = S.tiles.filter(t => t.q && t.fails > 0).map(t => t.q.q);
  const statusEl = $('#res-cloud-status');
  try {
    const res = await submitReviewResult({
      shareCode: S.shareCode,
      studentAlias: h.name || '학생',
      playMode: 'solo',
      score: score(S, 0),
      correctCount: h.stats?.correct || 0,
      wrongCount: h.stats?.wrong || 0,
      won: rank(0) < rank(1),
      missedQuestions: missed
    });
    if (res.ok) {
      S.cloudSubmitted = true;
      save();
      if (statusEl) {
        statusEl.innerHTML = `<span>☁️ 선생님께 복습 결과를 전송했어요 (${esc(S.shareCode)})</span>`;
        statusEl.classList.remove('hidden');
      }
      return;
    }
  } catch {}
  if (statusEl) {
    statusEl.innerHTML = `<span>⚠️ 복습 결과 전송이 보류됐어요 (${esc(S.shareCode)})</span><button type="button" class="pbtn sm blue" id="res-cloud-retry">☁️ 다시 전송</button>`;
    statusEl.classList.remove('hidden');
    $('#res-cloud-retry').onclick = () => submitSoloCloudIfNeeded(true);
  }
}

async function gameOver(reason) {
  gameSession++;
  const sid = gameSession;
  aiFocusTile = -1;
  aiFastTurn = false;
  S.over = true;
  S.pending = null;
  S.phase = null;
  closeModal();
  if (S.settings.playMode === 'solo' && !S.statRecorded) {
    S.statRecorded = true;
    const sr = recordSoloResult();
    S.lastNewlyCleared = sr.newlyCleared;
    const { rank } = computeStanding(S);
    const st = S.teams[0].stats || {};
    const stars = computeSetStars(rank(0) < rank(1), st.correct || 0, st.wrong || 0);
    if (stars > 0 && S.setId) recordSetMastery(S.setId, stars, score(S, 0));
  }
  render();
  sfx('fanfare');
  await announce('🏁 게임 끝!', reason, '', 2000);
  if (sid !== gameSession) return;
  showResult();
  submitSoloCloudIfNeeded();
}

/* ---------- 1인 플레이 PC AI ---------- */
function scheduleAITurn() {
  const sid = gameSession;
  const delay = S?.settings?.aiFast ? 90 : (isReducedMotion() ? 120 : 260);
  setTimeout(() => { if (isAISessionAlive(sid)) runAITurn(sid); }, delay);
}

async function runAITurn(sid) {
  while (busy && sid === gameSession) await sleep(80);
  await waitConfirmClear(sid);
  if (!isAISessionAlive(sid)) return;
  if (S.phase === 'cards') { showCards(); return; }
  if (S.phase && S.phase.startsWith('team:')) {
    const r = REWARDS.find(x => x.id === S.phase.slice(5));
    if (r) await applyTeamEffect(r, 0);
    else finishAction();
    return;
  }
  if (S.pending) { await runAIPending(sid); return; }
  const team = S.teams[S.turn];
  const level = team.aiLevel || S.settings.aiLevel || 'normal';
  const i = chooseAITile(S, level);
  if (i < 0) { endTurn(); return; }
  await runAIQuestion(i, sid);
}

async function runAIQuestion(i, sid) {
  aiFocusTile = i;
  sfx('open');
  renderBoard();
  await aiWait(380, 150);
  await waitConfirmClear(sid);
  aiFocusTile = -1;
  if (!isAISessionAlive(sid)) { renderBoard(); return; }
  const tile = S.tiles[i];
  const team = S.teams[S.turn];
  if (!tile.q) {
    await announce('🍀 행운 칸!', '🤖 PC가 문제 없이 이 칸을 차지해요', 'gold', S.settings.aiFast || isReducedMotion() ? 450 : 1100);
    if (!isAISessionAlive(sid)) return;
    await resolveCorrect(i, true);
    return;
  }
  const q = tile.q;
  const opts = q.opts ? shuffle([...q.opts]) : null;
  const longCls = q.q.length > 65 ? ' long' : '';
  const box = openModal(`
    <div class="q-head" style="--c:${team.color}">
      <span>🤖 PC 도전! (${(AI_CONF[team.aiLevel || 'normal'] || AI_CONF.normal).label})</span>
      <div class="q-head-r"><span class="q-no">${i + 1}번 문제${tile.fails ? ` · ${tile.fails}번 틀린 문제` : ''}</span></div>
    </div>
    <div class="q-text${longCls}">${formatRichText(q.q)}</div>
    ${opts ? `<div class="q-opts">${opts.map((o, k) => `<button class="q-opt" data-k="${k}" disabled><b>${'①②③④⑤⑥'[k]}</b>${formatRichText(o)}</button>`).join('')}</div>`
      : `<div class="q-answer" id="q-answer">정답: <b>${formatRichText(q.a)}</b></div>`}
    <div class="q-msg" id="q-msg">🤖 생각하는 중...</div>
    <div class="q-actions"><button type="button" class="pbtn sm white" id="ai-skip">⏩ 빠르게<kbd class="kh">Space</kbd></button></div>`, '', 'ai-question');
  box.style.setProperty('--qscale', qScale);
  $('#ai-skip').onclick = skipAIWait;
  await aiWait(650, 220);
  await waitConfirmClear(sid);
  if (!isAISessionAlive(sid)) return;
  const conf = AI_CONF[team.aiLevel || 'normal'] || AI_CONF.normal;
  const ok = Math.random() < conf.acc;
  if (opts) {
    const rightIdx = opts.indexOf(q.a);
    const wrongIdx = opts.map((_, k) => k).filter(k => k !== rightIdx);
    const pickIdx = ok ? rightIdx : (wrongIdx.length ? pick(wrongIdx) : rightIdx);
    const pickedBtn = box.querySelector(`.q-opt[data-k="${pickIdx}"]`);
    if (pickedBtn) pickedBtn.classList.add(ok ? 'right' : 'wrong');
    if (!ok && S.settings.wrongMode === 'reveal') {
      const rightBtn = box.querySelector(`.q-opt[data-k="${rightIdx}"]`);
      if (rightBtn) rightBtn.classList.add('right');
    }
    $('#q-msg').textContent = ok ? '⭕ PC 정답!' : '❌ PC 오답!';
  } else {
    if (ok || S.settings.wrongMode === 'reveal') $('#q-answer').classList.add('show');
    $('#q-msg').textContent = ok ? `⭕ PC 정답! (${q.a})` : '❌ PC 오답!';
  }
  sfx(ok ? 'correct' : 'wrong');
  await aiWait(800, 280);
  await waitConfirmClear(sid);
  if (!isAISessionAlive(sid)) return;
  closeModal();
  if (ok) await resolveCorrect(i);
  else resolveWrong(i);
}

async function runAIPending(sid) {
  await aiWait(450, 150);
  await waitConfirmClear(sid);
  if (!isAISessionAlive(sid)) return;
  const p = S.pending;
  if (!p) { finishAction(); return; }
  const targets = validTargets(S, p);
  if (!targets.length) { finishAction(); return; }
  const N = boardN(S);
  const me = S.turn;
  const T = S.teams[me];
  const lines = getLines(N);
  const lo = lineOwners(S);
  const conf = AI_CONF[T.aiLevel || 'normal'] || AI_CONF.normal;
  const smart = Math.random() < conf.cardSmart;
  const oppThreatScore = idx => {
    let val = 0;
    lines.forEach((l, k) => {
      if (!l.includes(idx)) return;
      const o = S.tiles[idx].owner;
      if (lo[k] === o) val += 1000;
      else if (l.filter(x => S.tiles[x].owner === o).length >= N - 1) val += 500;
      else val += l.filter(x => S.tiles[x].owner === o).length * 40;
    });
    return val;
  };
  if (p.type === 'grab') {
    const chosen = smart ? targets.slice().sort((a, b) => scoreTileForAI(S, b, me) - scoreTileForAI(S, a, me))[0] : pick(targets);
    S.tiles[chosen].owner = me;
    S.tiles[chosen].opened = true;
    triggerTileFx([chosen], 'just-claimed');
    sfx('grab');
    toast(`🤖 PC가 ${chosen + 1}번 칸을 차지했어요!`);
    addLog(`${T.name} 🚩 ${chosen + 1}번 칸 땅따먹기`);
    finishAction();
    return;
  }
  if (p.type === 'steal') {
    const chosen = smart ? targets.slice().sort((a, b) => (oppThreatScore(b) + scoreTileForAI(S, b, me)) - (oppThreatScore(a) + scoreTileForAI(S, a, me)))[0] : pick(targets);
    const o = S.tiles[chosen].owner;
    if (!blocked(o, chosen)) {
      S.tiles[chosen].owner = me;
      T.stats.steals++;
      triggerTileFx([chosen], 'just-stolen');
      sfx('steal');
      toast(`🤖 PC가 ${chosen + 1}번 칸을 빼앗았어요!`);
      addLog(`${T.name} 🗡️ ${S.teams[o].name}의 ${chosen + 1}번 칸 뺏기`);
    }
    finishAction();
    return;
  }
  if (p.type === 'swap') {
    let first = p.first;
    if (p.step === 1) {
      first = smart ? targets.slice().sort((a, b) => scoreTileForAI(S, a, me) - scoreTileForAI(S, b, me))[0] : pick(targets);
      p.step = 2;
      p.first = first;
      sfx('click');
      render();
      await aiWait(250, 100);
      await waitConfirmClear(sid);
      if (!isAISessionAlive(sid)) return;
    }
    const t2 = validTargets(S, p);
    if (!t2.length) { finishAction(); return; }
    const second = smart ? t2.slice().sort((a, b) => (oppThreatScore(b) + scoreTileForAI(S, b, me)) - (oppThreatScore(a) + scoreTileForAI(S, a, me)))[0] : pick(t2);
    const o = S.tiles[second].owner;
    if (!blocked(o, second)) {
      S.tiles[first].owner = o;
      S.tiles[second].owner = me;
      T.stats.steals++;
      triggerTileFx([first, second], 'just-stolen');
      sfx('steal');
      toast(`🤖 PC가 ${first + 1}번 ↔ ${second + 1}번 칸을 바꿨어요!`);
      addLog(`${T.name} 🔄 ${first + 1}번 ↔ ${S.teams[o].name}의 ${second + 1}번`);
    }
    finishAction();
    return;
  }
  if (p.type === 'bomb') {
    const bombScore = center => [center, ...neighbors(center, N)].reduce((sum, k) => {
      const o = S.tiles[k].owner;
      return o >= 0 && o !== me ? sum + 100 + oppThreatScore(k) : sum;
    }, 0);
    const chosen = smart ? targets.slice().sort((a, b) => bombScore(b) - bombScore(a))[0] : pick(targets);
    p.aim = chosen;
    sfx('click');
    render();
    await aiWait(500, 180);
    await waitConfirmClear(sid);
    if (!isAISessionAlive(sid)) return;
    await detonateBomb(chosen);
  }
}

/* ---------- 보상 카드 · 주사위 · 벌칙 미션 ---------- */
function drawCards(n = 3) {
  const isAI = !!(S.teams[S.turn] && S.teams[S.turn].isAI);
  const isSolo = S.settings.playMode === 'solo';
  const dis = new Set(S.settings.disabledRewards || []);
  const catchup = isCatchupEligible(S, S.turn);
  let pool = REWARDS
    .filter(r => !dis.has(r.id) && (r.kind === 'good' || S.settings.penalties) && (!r.strong || S.settings.strong) && (!isAI || r.id !== 'mission'))
    .map(r => ({ ...r, w: catchup && r.kind === 'good' ? r.w * 1.45 : r.w }));
  if (pool.length < n) {
    pool = REWARDS.filter(r => r.kind === 'good' && (!isAI || r.id !== 'mission')).map(r => ({ ...r }));
  }
  const out = [];
  while (out.length < n && pool.length) {
    const tot = pool.reduce((s, r) => s + r.w, 0);
    let x = Math.random() * tot;
    let k = 0;
    for (; k < pool.length - 1; k++) { x -= pool[k].w; if (x <= 0) break; }
    const c = pool.splice(k, 1)[0];
    if (c.id === 'mission') c.desc = pick(isSolo ? SOLO_MISSIONS : MISSIONS);
    out.push(c);
  }
  return out;
}

function cardFront(c) {
  return `<div class="card-front ${c.kind}"><span class="kd">${c.kind === 'bad' ? '벌칙' : '보상'}</span><div class="ci">${c.icon}</div><div class="cn">${c.name}</div><div class="cd">${esc(c.desc)}</div></div>`;
}

function showCards() {
  S.phase = 'cards';
  save();
  const cards = drawCards(3);
  const isAI = !!(S.teams[S.turn] && S.teams[S.turn].isAI);
  const box = openModal(`
    <div class="cards-title">${isAI ? '🤖 PC가 카드를 고르고 있어요...' : `${teamTag(S.turn)} 정답 보상! 카드를 한 장 고르세요`}</div>
    <div class="cards">${cards.map((c, k) => `<button class="card" data-k="${k}" aria-label="${k + 1}번 카드"><div class="card-inner"><div class="card-back"><span class="cnum">${k + 1}</span><small class="cq">?</small></div>${cardFront(c)}</div></button>`).join('')}</div>
    <div class="cards-foot" id="cards-foot">${isAI ? '<button type="button" class="pbtn sm white" id="ai-skip">⏩ 빠르게<kbd class="kh">Space</kbd></button>' : ''}</div>`, 'wide', 'cards');
  if (isAI) {
    const sid = gameSession;
    box.querySelectorAll('.card').forEach(x => { x.disabled = true; });
    if ($('#ai-skip')) $('#ai-skip').onclick = skipAIWait;
    (async () => {
      await aiWait(500, 180);
      await waitConfirmClear(sid);
      if (!isAISessionAlive(sid)) return;
      const k = (Math.random() * cards.length) | 0;
      const b = box.querySelector(`.card[data-k="${k}"]`);
      const c = cards[k];
      if (b) { b.classList.add('flipped', 'chosen'); sfx('flip'); }
      await aiWait(750, 260);
      await waitConfirmClear(sid);
      if (!isAISessionAlive(sid)) return;
      sfx(c.kind === 'bad' ? 'bad' : 'good');
      box.querySelectorAll('.card').forEach(x => { if (x !== b) x.classList.add('flipped', 'dim'); });
      $('#cards-foot').innerHTML = `<div class="res">${c.icon} ${c.name}${c.kind === 'bad' ? ' 😱' : ' 🎉'}</div>`;
      await aiWait(550, 200);
      await waitConfirmClear(sid);
      if (!isAISessionAlive(sid)) return;
      closeModal();
      applyReward(c);
    })();
    return;
  }
  let chosen = false;
  box.querySelectorAll('.card').forEach(b => b.onclick = () => {
    if (chosen) return;
    chosen = true;
    const sid = gameSession;
    const c = cards[+b.dataset.k];
    b.classList.add('flipped', 'chosen');
    sfx('flip');
    box.querySelectorAll('.card').forEach(x => { x.disabled = true; });
    setTimeout(() => {
      if (sid !== gameSession || !$('#cards-foot')) return;
      sfx(c.kind === 'bad' ? 'bad' : 'good');
      box.querySelectorAll('.card').forEach(x => { if (x !== b) x.classList.add('flipped', 'dim'); });
      $('#cards-foot').innerHTML = `<div class="res">${c.icon} ${c.name}${c.kind === 'bad' ? ' 😱' : ' 🎉'}</div><button class="pbtn gold big" id="card-ok">확인<kbd class="kh">Enter</kbd></button>`;
      $('#card-ok').focus();
      $('#card-ok').onclick = () => { closeModal(); applyReward(c); };
    }, 650);
  });
}

function rollDiceModal(T) {
  return new Promise(async res => {
    const sid = gameSession;
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const d = 1 + ((Math.random() * 6) | 0);
    openModal(`
      <p class="m-title">🎲 행운 주사위</p>
      <p class="m-desc">${teamTag(S.turn)} 주사위를 굴려요! (눈 × 5점)</p>
      <div class="dice-face roll" id="dice-face">⚀</div>
      <div class="q-msg" id="dice-msg">데굴데굴...</div>
      <div class="m-actions ${T.isAI ? '' : 'hidden'}" id="dice-act">${T.isAI ? '<button type="button" class="pbtn sm white" id="ai-skip">⏩ 빠르게<kbd class="kh">Space</kbd></button>' : '<button type="button" class="pbtn gold big" id="dice-ok">확인<kbd class="kh">Enter</kbd></button>'}</div>`, 'narrow', 'dice');
    if (T.isAI && $('#ai-skip')) $('#ai-skip').onclick = skipAIWait;
    const steps = aiFastTurn ? 1 : (isReducedMotion() ? 2 : (T.isAI ? 6 : 10));
    for (let k = 0; k < steps; k++) {
      const el = $('#dice-face');
      if (sid !== gameSession || !el) { res(false); return; }
      el.textContent = faces[(Math.random() * 6) | 0];
      sfx('tick');
      await sleep(70 + k * 18);
      if (sid !== gameSession || !$('#dice-face')) { res(false); return; }
    }
    const el = $('#dice-face');
    if (sid !== gameSession || !el) { res(false); return; }
    el.classList.remove('roll');
    el.textContent = faces[d - 1];
    T.bonus += d * 5;
    sfx('coin');
    render();
    $('#dice-msg').textContent = `🎉 ${d}이 나왔어요! (+${d * 5}점 획득)`;
    if (T.isAI) {
      await aiWait(700, 220);
      await waitConfirmClear(sid);
      if (sid !== gameSession) { res(false); return; }
      if ($('#dice-face')) closeModal();
      res(true);
      return;
    }
    $('#dice-act').classList.remove('hidden');
    $('#dice-ok').focus();
    $('#dice-ok').onclick = () => { closeModal(); res(true); };
  });
}

function showMissionModal(initialDesc) {
  return new Promise(res => {
    let cur = initialDesc;
    const isSolo = !!(S && S.settings.playMode === 'solo');
    const list = isSolo ? SOLO_MISSIONS : MISSIONS;
    openModal(`
      <p class="m-title">🎤 벌칙 미션</p>
      <p class="m-desc">${teamTag(S.turn)} ${isSolo ? '도전해 보세요!' : '함께 도전해 보세요!'}</p>
      <div class="mission-card" id="mission-text">${esc(cur)}</div>
      <div class="m-actions">
        <button type="button" class="pbtn white" id="mission-reroll">🎲 다른 미션 뽑기</button>
        <button type="button" class="pbtn gold big" id="mission-ok">✅ 미션 완료!<kbd class="kh">Enter</kbd></button>
      </div>`, 'narrow', 'mission');
    $('#mission-ok').focus();
    $('#mission-reroll').onclick = () => {
      const pool = list.filter(m => m !== cur);
      cur = pick(pool.length ? pool : list);
      $('#mission-text').textContent = cur;
      sfx('flip');
      addLog(`${S.teams[S.turn].name}: 미션 변경 (${cur})`);
    };
    $('#mission-ok').onclick = () => { closeModal(); res(); };
  });
}

function blocked(t, tileIdx = -1) {
  const tm = S.teams[t];
  if (tm.shield > 0) {
    tm.shield--;
    tm.stats.shieldsBlocked++;
    if (tileIdx >= 0) triggerTileFx([tileIdx], 'shield-pop');
    sfx('shield');
    toast(`🛡️ ${tm.name}의 방패가 공격을 막았어요!`);
    addLog(`${tm.name} 방패로 막음`);
    return true;
  }
  return false;
}

function fallback(r) {
  S.teams[S.turn].bonus += 10;
  sfx('coin');
  toast(`${r.icon} 쓸 수 있는 칸이 없어서 보너스 +10점으로 바뀌었어요`);
}

async function applyReward(r) {
  const sid = gameSession;
  const me = S.turn;
  const T = S.teams[me];
  S.phase = null;
  addLog(`${T.emoji} ${T.name}: ${r.icon} ${r.name} 카드${r.id === 'mission' ? ` (${r.desc})` : ''}`);
  switch (r.id) {
    case 'pts10': T.bonus += 10; sfx('coin'); break;
    case 'pts20': T.bonus += 20; sfx('coin'); break;
    case 'dice': await rollDiceModal(T); break;
    case 'grab': case 'steal': case 'swap': case 'bomb': {
      const p = { type: r.id, step: 1 };
      if (validTargets(S, p).length) { S.pending = p; render(); if (T.isAI) runAIPending(gameSession); return; }
      fallback(r);
      break;
    }
    case 'shield': T.shield++; sfx('shield'); break;
    case 'again': S.extra = true; sfx('good'); break;
    case 'double': T.double = true; sfx('gold'); break;
    case 'share': S.teams.forEach(t => { t.bonus += 10; }); sfx('coin'); break;
    case 'none': break;
    case 'minus10': T.bonus -= 10; break;
    case 'quake': {
      const own = S.tiles.map((_, i) => i).filter(i => S.tiles[i].owner === me && i !== S.lastTile);
      if (own.length) {
        const i = pick(own);
        S.tiles[i].owner = -1;
        sfx('bomb');
        render();
        shakeBoard();
        const el = $(`.tile[data-i="${i}"]`);
        if (el) el.classList.add('boom');
        await announce('🌋 지진!', `${i + 1}번 칸이 빈 땅이 됐어요`, 'bad', 1500);
      } else {
        toast('🌋 무너질 칸이 없어서 무사해요!');
      }
      break;
    }
    case 'freezeSelf': T.freeze = Math.min(2, T.freeze + 1); sfx('freeze'); break;
    case 'mission': await showMissionModal(r.desc); break;
    default:
      if (TEAM_TARGET.includes(r.id)) {
        const others = S.teams.map((_, k) => k).filter(k => k !== me);
        if (others.length === 1) {
          if (T.isAI) {
            toast(`🤖 PC가 ${r.icon} ${r.name} 카드를 사용해요!`);
            await aiWait(450, 150);
            await waitConfirmClear(sid);
            if (!isAISessionAlive(sid)) return;
          }
          await applyTeamEffect(r, others[0]);
          return;
        }
        pickTeam(r);
        return;
      }
  }
  if (sid !== gameSession || !S || S.over) return;
  finishAction();
}

async function finishAction() {
  const sid = gameSession;
  S.pending = null;
  render();
  await checkBingo();
  if (sid !== gameSession || !S || S.over) return;
  if (checkBingoGoalWin()) return;
  endTurn();
}

async function detonateBomb(i) {
  const sid = gameSession;
  const N = boardN(S);
  const me = S.turn;
  const T = S.teams[me];
  const area = [i, ...neighbors(i, N)].filter(k => S.tiles[k].owner >= 0 && S.tiles[k].owner !== me);
  const hit = [...new Set(area.map(k => S.tiles[k].owner))];
  const safe = hit.filter(t => blocked(t, i));
  let n = 0;
  area.forEach(k => { if (!safe.includes(S.tiles[k].owner)) { S.tiles[k].owner = -1; n++; } });
  if (n > 0) T.stats.steals++;
  S.pending = null;
  render();
  sfx('bomb');
  vibrate([50, 30, 50]);
  shakeBoard();
  [i, ...neighbors(i, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('boom'); });
  addLog(`${T.name} 💣 ${i + 1}번 칸 폭탄 → ${n}칸 파괴`);
  await announce('💥 쾅!', n ? `다른 팀 칸 ${n}개가 빈 땅이 됐어요` : '방패에 막혔어요!', 'bad', 1500);
  if (sid !== gameSession || !S || S.over) return;
  finishAction();
}

async function handleTarget(i) {
  const p = S.pending;
  if (!validTargets(S, p).includes(i)) {
    if (p.type === 'swap' && p.step === 2 && i === p.first) { p.step = 1; delete p.first; render(); }
    return;
  }
  const me = S.turn;
  const T = S.teams[me];
  const tile = S.tiles[i];
  if (p.type === 'grab') {
    tile.owner = me;
    tile.opened = true;
    triggerTileFx([i], 'just-claimed');
    sfx('grab');
    addLog(`${T.name} 🚩 ${i + 1}번 칸 땅따먹기`);
    if (tile.golden) toast('⭐ 황금 칸을 차지했어요!');
  } else if (p.type === 'steal') {
    const o = tile.owner;
    if (!blocked(o, i)) {
      tile.owner = me;
      T.stats.steals++;
      triggerTileFx([i], 'just-stolen');
      sfx('steal');
      toast(`🗡️ ${S.teams[o].name}의 ${i + 1}번 칸을 빼앗았어요!`);
      addLog(`${T.name} 🗡️ ${S.teams[o].name}의 ${i + 1}번 칸 뺏기`);
    }
  } else if (p.type === 'swap') {
    if (p.step === 1) { p.step = 2; p.first = i; sfx('click'); render(); return; }
    const o = tile.owner;
    if (!blocked(o, i)) {
      S.tiles[p.first].owner = o;
      tile.owner = me;
      T.stats.steals++;
      triggerTileFx([p.first, i], 'just-stolen');
      sfx('steal');
      toast(`🔄 ${p.first + 1}번 ↔ ${i + 1}번 칸을 바꿨어요!`);
      addLog(`${T.name} 🔄 ${p.first + 1}번 ↔ ${S.teams[o].name}의 ${i + 1}번`);
    }
  } else if (p.type === 'bomb') {
    if (p.aim !== i) { p.aim = i; sfx('click'); render(); return; }
    await detonateBomb(i);
    return;
  }
  finishAction();
}

function pickTeam(r) {
  S.phase = 'team:' + r.id;
  save();
  const others = S.teams.map((_, k) => k).filter(k => k !== S.turn);
  const box = openModal(`
    <p class="m-title">${r.icon} ${r.name}</p><p class="m-desc">${esc(r.desc)}</p>
    <p class="m-desc" style="margin-top:6px;font-weight:800">${teamTag(S.turn)}, 어느 팀을 고를까요?</p>
    <div class="team-pick">${others.map((k, idx) => { const t = S.teams[k]; return `<button data-t="${k}" style="--c:${t.color}"><span style="font-size:42px">${t.emoji}</span>${esc(t.name)}<small>${score(S, k)}점 <kbd class="kh">${idx + 1}</kbd></small>${t.shield && r.id !== 'gift' ? '<span class="sh">🛡️ 방패 있음</span>' : ''}</button>`; }).join('')}</div>`, 'narrow', 'teampick');
  box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { closeModal(); applyTeamEffect(r, +b.dataset.t); });
}

async function applyTeamEffect(r, k) {
  const sid = gameSession;
  const me = S.turn;
  const A = S.teams[me];
  const B = S.teams[k];
  S.phase = null;
  if (r.id === 'gift') {
    A.bonus -= 10;
    B.bonus += 10;
    sfx('coin');
    toast(`🤲 ${B.name}에게 10점을 선물했어요`);
    addLog(`${A.name} → ${B.name} 10점 선물`);
  } else if (!blocked(k)) {
    if (r.id === 'freezeOther') { B.freeze = Math.min(2, B.freeze + 1); sfx('freeze'); toast(`❄️ ${B.name}은(는) 다음 차례를 쉬어요!`); addLog(`${A.name} ❄️ ${B.name} 얼리기`); }
    if (r.id === 'stealPts') { A.bonus += 15; B.bonus -= 15; A.stats.steals++; sfx('steal'); toast(`🧲 ${B.name}에게서 15점을 가져왔어요!`); addLog(`${A.name} 🧲 ${B.name}에게서 15점`); }
    if (r.id === 'scoreSwap') {
      const sa = score(S, me);
      const sb = score(S, k);
      A.bonus += sb - sa;
      B.bonus += sa - sb;
      A.stats.steals++;
      sfx('steal');
      addLog(`${A.name} 🔀 ${B.name}와 점수 체인지 (${sa}↔${sb})`);
      render();
      await announce('🔀 점수 체인지!', `${teamTag(me)} ${sb}점 ↔ ${teamTag(k)} ${sa}점`, 'blue', 2000);
      if (sid !== gameSession || !S || S.over) return;
    }
  }
  finishAction();
}

/* ---------- 결과 · 미니 어워드 · 오답 복습 ---------- */
function showResult() {
  const { scores, order, rank } = computeStanding(S);
  const awards = computeAwards(S, order, scores, rank);
  const soloEl = $('#res-solo-stats');
  $('#res-cloud-status').classList.add('hidden');
  $('#r-hof-save').disabled = !!S.hofSaved;
  $('#r-hof-save').textContent = S.hofSaved ? '✅ 명예의 전당 기록됨' : '🏆 명예의 전당 기록';

  if (S.settings.playMode === 'solo' && S.teams.length === 2) {
    const hRank = rank(0);
    const aRank = rank(1);
    $('#res-headline').textContent = hRank < aRank ? '🎉 승리! PC를 이겼어요!' : hRank === aRank ? '🤝 무승부! 막상막하 승부!' : '🤖 PC 승리! 다시 도전해요!';
    const st = loadSoloStats();
    const clearMsg = S.lastNewlyCleared ? `<span>🏆 ${(AI_CONF[S.lastNewlyCleared] || AI_CONF.normal).label} 난이도 첫 정복!</span>` : '';
    soloEl.innerHTML = clearMsg + soloStatsHTML(st);
    soloEl.classList.remove('hidden');
  } else {
    $('#res-headline').textContent = '🏆 최종 결과';
    soloEl.classList.add('hidden');
  }
  const podOrder = order.length >= 3 ? [order[1], order[0], order[2], ...order.slice(3)] : [order[1], order[0]];
  const H = { 1: 220, 2: 165, 3: 120, 4: 92, 5: 76, 6: 66 };
  const M = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '🎖️', 5: '🎖️', 6: '🎖️' };
  $('#podium').innerHTML = podOrder.map(k => {
    const t = S.teams[k];
    const r = rank(k);
    return `<div class="pod"><div class="medal">${M[r] || '🎖️'}</div><div class="e">${t.emoji}</div><div class="award">${awards[k]}</div>
      <div class="bar" style="--c:${t.color};--d:${t.dark};height:${H[r] || 70}px"><span class="n">${esc(t.name)}</span><span class="s">${scores[k]}</span><span>${r}위</span></div></div>`;
  }).join('');
  $('#res-table').innerHTML = `<tr><th>팀</th><th>순위</th><th>칸</th><th>빙고</th><th>보너스</th><th>총점</th><th>칭찬 배지</th></tr>` +
    order.map(k => {
      const t = S.teams[k];
      return `<tr><td>${t.emoji} ${esc(t.name)}</td><td>${rank(k)}위</td><td>${tileCount(S, k)}칸</td><td>${bingoCount(S, k)}줄</td><td>${t.bonus >= 0 ? '+' : ''}${t.bonus}</td><td><b>${scores[k]}점</b></td><td>${awards[k]}</td></tr>`;
    }).join('');
  const missedCount = S.tiles.filter(t => t.q && t.fails > 0).length;
  $('#r-review').textContent = missedCount ? `📝 오답 복습 (${missedCount})` : '📖 문제 복습';
  show('result');
  confetti(140);
  setTimeout(() => confetti(80), 900);
}

function openReviewModal() {
  if (!S) return;
  const opened = S.tiles.map((t, idx) => ({ ...t, idx })).filter(t => t.q && (t.opened || t.fails > 0));
  const missed = opened.filter(t => t.fails > 0).sort((a, b) => b.fails - a.fails);
  let tab = missed.length ? 'missed' : 'all';
  let hideAns = false;
  const box = openModal(`
    <p class="m-title">📖 수업 마무리 복습</p>
    <div class="rev-top">
      <div class="ed-tabs" style="margin:0">
        <button type="button" class="${tab === 'missed' ? 'on' : ''}" data-rtab="missed">❌ 틀린 문제 (${missed.length})</button>
        <button type="button" class="${tab === 'all' ? 'on' : ''}" data-rtab="all">📖 열린 문제 전체 (${opened.length})</button>
      </div>
      <button type="button" class="pbtn sm white" id="rev-toggle">🙈 정답 가리기</button>
    </div>
    <div class="rev-list" id="rev-list"></div>
    <div class="m-actions">
      ${missed.length ? `<button type="button" class="pbtn ok" id="rev-retry">🎯 틀린 문제(${missed.length}개)로 복습 게임</button><button type="button" class="pbtn blue" id="rev-save-set">💾 오답 세트로 저장</button><button type="button" class="pbtn white" id="rev-export-txt">⬇️ 오답 노트(.txt)</button><button type="button" class="pbtn white" id="rev-print">🖨️ 오답 노트 인쇄</button>` : ''}
      <button type="button" class="pbtn gold" id="m-close">닫기</button>
    </div>`, 'wide', 'info');
  const draw = () => {
    const list = tab === 'missed' ? missed : opened;
    box.querySelectorAll('[data-rtab]').forEach(b => b.classList.toggle('on', b.dataset.rtab === tab));
    $('#rev-toggle').textContent = hideAns ? '👀 정답 보기' : '🙈 정답 가리기';
    $('#rev-list').innerHTML = list.length ? list.map(t => `
      <div class="rev-item">
        <div class="rev-meta">
          <span class="rev-badge ok">${t.idx + 1}번 칸</span>
          ${t.fails ? `<span class="rev-badge">✖ ${t.fails}번 틀림</span>` : '<span class="rev-badge ok">⭕ 한 번에 정답</span>'}
        </div>
        ${t.q.img && isSafeImageUrl(t.q.img) ? `<img class="q-img" style="max-height:150px" src="${esc(t.q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : ''}
        <div class="rev-q">${formatRichText(t.q.q)}</div>
        <div class="rev-a ${hideAns ? 'blur' : ''}">정답: ${formatRichText(t.q.a)}</div>
        ${t.q.explain ? `<div class="rev-ex">💡 ${formatRichText(t.q.explain)}</div>` : ''}
      </div>`).join('') : '<div class="hint" style="text-align:center;padding:24px">해당하는 문제가 없어요! 👏</div>';
  };
  box.querySelectorAll('[data-rtab]').forEach(b => b.onclick = () => { tab = b.dataset.rtab; draw(); });
  $('#rev-toggle').onclick = () => { hideAns = !hideAns; draw(); };
  if ($('#rev-retry')) {
    $('#rev-retry').onclick = () => {
      const prev = S;
      closeModal();
      ac();
      startGame({
        settings: { ...prev.settings, boardSize: missed.length > 16 ? 5 : (missed.length <= 9 ? 3 : 4), golden: Math.min(prev.settings.golden, 2), roundLimit: 0, bingoGoal: 0 },
        customQuestions: missed.map(t => ({ ...t.q })),
        setId: prev.setId,
        setName: `${prev.setName || '복습'} (오답 복습)`,
        teams: prev.teams.map(t => ({ name: t.name, emoji: t.emoji, isAI: t.isAI, aiLevel: t.aiLevel }))
      });
    };
  }
  if ($('#rev-save-set')) {
    $('#rev-save-set').onclick = () => {
      const txt = serializeQuestions(missed.map(t => t.q));
      const base = (S.setName || '복습').replace(/\s*\(오답 복습\)$/, '');
      const name = (base + ' 오답').slice(0, 30);
      const sets = savedSets();
      if (!sets.some(s => s.name === name && s.text === txt)) {
        sets.push({ id: 'set_' + Date.now().toString(36), name, text: txt });
        if (!store('bq_sets', sets)) { toast('⚠️ 저장 공간이 부족해 저장하지 못했어요'); return; }
      }
      sfx('coin');
      toast(`💾 “${name}” 세트로 저장했어요!`);
    };
  }
  if ($('#rev-export-txt')) {
    $('#rev-export-txt').onclick = () => {
      const txt = serializeQuestions(missed.map(t => t.q));
      const safe = ((S.setName || '복습').replace(/\s*\(오답 복습\)$/, '') || '오답노트').replace(/[\\/:*?"<>|]/g, '_');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
      a.download = safe + '_오답노트.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
  }
  if ($('#rev-print')) {
    $('#rev-print').onclick = () => {
      printQuestionSheet({
        title: `${S.setName || '복습'} · 오답 노트`,
        subtitle: `틀린 문제 ${missed.length}개 복습 학습지`,
        questions: missed.map(t => t.q),
        includeAnswers: true
      });
    };
  }
  $('#m-close').onclick = closeModal;
  draw();
}

/* ================= 안내 ================= */
function howtoHTML() {
  const rw = REWARDS.map(r => `<div class="rw ${r.kind}"><span class="i">${r.icon}</span><div><b>${r.name}</b>${r.strong ? ' <small>(강력)</small>' : ''}<br>${r.id === 'mission' ? '팀이 함께 재미있는 미션을 해요.' : r.desc}</div></div>`).join('');
  return `<div class="howto">
    <h2>❓ 게임 방법</h2>
    <h4>1. 게임 시작 · 1인 플레이 & 2~6팀 대결 · 실시간 방</h4>
    <ul><li>처음 화면에서 <b>🤖 1인 플레이 (vs PC)</b>, <b>👥 팀 대결(최대 6팀)</b>, <b>📡 실시간 방 참여</b>, <b>🏛️ 공개 문제 창고</b>를 바로 열 수 있어요.</li>
    <li>팀 대결 중 상단의 <b>📡 실시간 방</b>을 열면 학생들이 스마트폰으로 칸 투표와 답안 제출에 실시간으로 참여할 수 있어요.</li></ul>
    <h4>2. 점수 계산 · 힌트 · 읽어주기</h4>
    <ul><li><b>총점 = 칸 점수 × 칸 수 + 빙고 점수 × 빙고 줄 수 + 보너스 점수</b></li>
    <li>객관식에서는 게임당 1회 <b>💡 50:50 찬스</b>, 주관식에서는 <b>💡 초성·철자 힌트</b>와 <b>🔊 읽어주기(자동/속도 조절)</b>를 쓸 수 있어요.</li>
    <li><b>⚡ 역전 보정</b>을 켜면 30점 이상 뒤처진 팀에게 좋은 보상 카드가 나올 확률이 높아져요.</li></ul>
    <h4>3. 보상 카드 (정답을 맞히면 1·2·3 카드 중 고르기)</h4>
    <div class="rw-grid">${rw}</div>
    <h4>4. 선생님용 편의 기능 · 공유 코드 · 인쇄 · 단축키</h4>
    <ul><li><b>🔗 코드·QR 공유</b>로 6자리 공유 코드·QR을 만들고, <b>📊 학급 복습 현황</b>에서 결과 조회 및 <b>CSV 다운로드</b>가 가능해요.</li>
    <li>편집기에서 <b>그림 파일 올리기·Ctrl+V 캡처 붙여넣기</b>, <b>일괄 섞기·삭제</b>, <b>학생용/교사용/종이 빙고판 인쇄</b>를 지원해요.</li>
    <li>단축키: 객관식 <code>1~4</code> · 주관식 <code>Space</code>/<code>O</code>/<code>X</code> · 일시정지 <code>P</code> · +10초 <code>+</code> · 되돌리기 <code>Z</code> · 전체화면 <code>F</code></li></ul>
    <div class="m-actions"><button class="pbtn gold" id="m-close">닫기</button></div></div>`;
}
function openHowto() {
  if ($('#screen-game').classList.contains('active') && isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  openModal(howtoHTML(), 'wide', 'info');
  $('#m-close').onclick = closeModal;
}

/* ================= 더보기 메뉴 · 전체화면 · 단축키 ================= */
function closeMoreMenu() {
  const m = $('#more-menu');
  if (m) { m.classList.add('hidden'); $('#g-more').setAttribute('aria-expanded', 'false'); }
}
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('전체화면을 열 수 없어요'));
    else toast('이 브라우저에서는 전체화면을 지원하지 않아요');
  } else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (S) renderTop(); });
$('#g-fs').onclick = toggleFullscreen;
$('#g-settings').onclick = openQuickSettings;
$('#g-live').onclick = openHostLiveModal;
$('#g-more').onclick = e => {
  e.stopPropagation();
  const m = $('#more-menu');
  const open = m.classList.contains('hidden');
  m.classList.toggle('hidden', !open);
  $('#g-more').setAttribute('aria-expanded', String(open));
};
$('#more-menu').addEventListener('click', e => {
  const b = e.target.closest('[data-more]');
  if (!b) return;
  const act = b.dataset.more;
  closeMoreMenu();
  if (act === 'live') openHostLiveModal();
  else if (act === 'settings') openQuickSettings();
  else if (act === 'bgm') $('#g-bgm').click();
  else if (act === 'sfx') $('#g-sfx').click();
  else if (act === 'vol') $('#g-vol').click();
  else if (act === 'log') $('#g-log').click();
  else if (act === 'fs') toggleFullscreen();
  else if (act === 'help') openHowto();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.more-wrap')) closeMoreMenu();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    if ($('#qr-zoom-overlay').classList.contains('show')) { trapTab(e, $('#qr-zoom-overlay')); return; }
    if ($('#confirm-modal').classList.contains('show')) { trapTab(e, $('#confirm-modal .cf-box')); return; }
    if ($('#modal').classList.contains('show')) { trapTab(e, $('#modal-box')); return; }
  }
  if ($('#qr-zoom-overlay').classList.contains('show')) {
    if (e.key === 'Escape') { e.preventDefault(); closeQrZoom(); }
    return;
  }
  if ($('#confirm-modal').classList.contains('show')) {
    if (e.key === 'Enter') { e.preventDefault(); finishConfirm(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishConfirm(false); }
    return;
  }
  if ($('#announce').classList.contains('show')) {
    if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); if (annFinish) annFinish(); }
    return;
  }
  if (e.key === 'Escape' && $('#emo-picker').classList.contains('show')) { closeEmoPicker(); return; }
  if (e.key === 'Escape' && e.target && e.target.id === 'q-sa-input') {
    const c = $('#q-cancel');
    if (c && !c.disabled) { e.preventDefault(); c.click(); }
    return;
  }
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

  if ($('#modal').classList.contains('show')) {
    const aiTurn = !!(S && S.teams[S.turn] && S.teams[S.turn].isAI);
    if (aiTurn && modalType !== 'info' && modalType !== 'manage' && modalType !== 'settings') {
      if (e.key === ' ' || e.key === 'Enter') { const sk = $('#ai-skip'); if (sk) { e.preventDefault(); sk.click(); } }
      return;
    }
    if (modalType === 'question') {
      const nextBtn = $('#q-next');
      if (nextBtn) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextBtn.click(); } return; }
      const ovOk = $('#q-sa-override');
      const ovNo = $('#q-sa-confirm-no');
      if (ovOk || ovNo) {
        if ((e.key === 'o' || e.key === 'O') && ovOk) { e.preventDefault(); ovOk.click(); return; }
        if ((e.key === 'x' || e.key === 'X') && ovNo) { e.preventDefault(); ovNo.click(); return; }
      }
      if (/^[1-6]$/.test(e.key)) { const b = $(`.q-opt[data-k="${+e.key - 1}"]`); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
      if (e.key === ' ') { const r = $('#q-reveal'); if (r && !r.disabled) { e.preventDefault(); r.click(); } return; }
      if (e.key === 'o' || e.key === 'O') { const ok = $('#q-ok'); if (ok && !ok.disabled) { e.preventDefault(); ok.click(); } return; }
      if (e.key === 'x' || e.key === 'X') { const no = $('#q-no'); if (no && !no.disabled) { e.preventDefault(); no.click(); } return; }
      if (e.key === 'p' || e.key === 'P') { const ps = $('#q-pause'); if (ps && !ps.disabled) { e.preventDefault(); ps.click(); } return; }
      if (e.key === '+' || e.key === '=') { const p10 = $('#q-plus10'); if (p10 && !p10.disabled) { e.preventDefault(); p10.click(); } return; }
      if (e.key === 'Escape') { const c = $('#q-cancel'); if (c && !c.disabled) { e.preventDefault(); c.click(); } }
      return;
    }
    if (modalType === 'cards' && !aiTurn) {
      const ok = $('#card-ok');
      if (ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ok.click(); return; }
      if (/^[1-3]$/.test(e.key)) { const c = $(`.card[data-k="${+e.key - 1}"]`); if (c && !c.disabled) { e.preventDefault(); c.click(); } return; }
      return;
    }
    if (modalType === 'teampick' && !aiTurn) {
      if (/^[1-5]$/.test(e.key)) { const btns = $$('.team-pick [data-t]'); if (btns[+e.key - 1]) { e.preventDefault(); btns[+e.key - 1].click(); } }
      return;
    }
    if (modalType === 'dice' || modalType === 'mission') {
      if (e.key === 'Enter' || e.key === ' ') { const b = $('#dice-ok') || $('#mission-ok'); if (b && !b.closest('.hidden')) { e.preventDefault(); b.click(); } }
      return;
    }
    if (e.key === 'Escape' && (modalType === 'info' || modalType === 'manage' || modalType === 'settings')) closeModal();
    return;
  }

  if ($('#screen-game').classList.contains('active') && S) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const tiles = $$('#board .tile');
      if (!tiles.length) return;
      e.preventDefault();
      const cur = document.activeElement && document.activeElement.closest('#board .tile');
      const N = boardN(S);
      const idx = cur ? +cur.dataset.i : -1;
      if (idx < 0) {
        const target = tiles.find(t => t.classList.contains('target') || t.classList.contains('closed')) || tiles[0];
        target.focus();
        return;
      }
      const r = (idx / N) | 0;
      const c = idx % N;
      let nr = r;
      let nc = c;
      if (e.key === 'ArrowUp') nr = (r - 1 + N) % N;
      else if (e.key === 'ArrowDown') nr = (r + 1) % N;
      else if (e.key === 'ArrowLeft') nc = (c - 1 + N) % N;
      else if (e.key === 'ArrowRight') nc = (c + 1) % N;
      if (tiles[nr * N + nc]) tiles[nr * N + nc].focus();
      return;
    }
    if (e.key === 'Escape' && S.pending && S.pending.type === 'bomb' && S.pending.aim != null) { delete S.pending.aim; render(); return; }
    if ((e.key === 'z' || e.key === 'Z') && !busy) { e.preventDefault(); $('#g-undo').click(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  }
});

/* ================= 이벤트 · 배경 · 공유 링크 처리 ================= */
function refreshTitle() {
  const s = load('bq_save', null);
  const btn = $('#btn-continue');
  if (s && !s.over && Array.isArray(s.tiles) && s.tiles.length) {
    const n = s.size || Math.round(Math.sqrt(s.tiles.length)) || 5;
    const left = s.tiles.filter(t => !t.opened).length;
    const isSolo = s.settings?.playMode === 'solo' || (Array.isArray(s.teams) && s.teams.some(t => t.isAI));
    btn.innerHTML = `<span>⏯ 이어하기</span><span class="cont-meta">${isSolo ? '🤖 1인 vs PC · ' : ''}${esc(s.setName || '진행 중인 게임')} · ${n}×${n} · ${s.round || 1}라운드 · 남은 ${left}칸</span>`;
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

$('#title-blocks').innerHTML = '<div class="tile closed"></div>' + TEAM_PRESETS.slice(0, 4).map((t, k) => `<div class="tile owned pat${k}" style="--f:${t.color};--s:${t.dark}"><span class="temo">${t.emoji}</span></div>`).join('');
$('#btn-new').onclick = () => { sfx('click'); ac(); setup.settings.playMode = 'team'; saveSetup(); setAdvOpen(false); renderSetup(); show('setup'); };
$('#btn-solo').onclick = () => { sfx('click'); ac(); setup.settings.playMode = 'solo'; saveSetup(); setAdvOpen(false); renderSetup(); show('setup'); };
$('#btn-continue').onclick = () => { sfx('click'); resumeGame(); };
$('#btn-code-join').onclick = $('#btn-code-join2').onclick = () => { sfx('click'); openCodeJoinModal(); };
$('#btn-live-join').onclick = () => { sfx('click'); openLiveJoinModal(); };
$('#btn-library').onclick = $('#btn-library2').onclick = () => { sfx('click'); openPublicLibraryModal(); };
$('#btn-hof').onclick = $('#r-hof-view').onclick = () => { sfx('click'); openHallOfFameModal(); };
$('#btn-editor').onclick = () => { sfx('click'); openEditor('title'); };
$('#btn-editor2').onclick = () => { sfx('click'); openEditor('setup'); };
$('#btn-howto').onclick = $('#btn-howto2').onclick = () => { sfx('click'); openHowto(); };
$$('[data-go]').forEach(b => b.onclick = () => { sfx('click'); show(b.dataset.go); });

$('#btn-start').onclick = async () => {
  const old = load('bq_save', null);
  if (old && !old.over && old.tiles && !(await confirmModal({ title: '새 게임을 시작할까요?', desc: '진행 중이던 이전 게임 기록은 지워집니다.', okText: '새 게임 시작', danger: true }))) return;
  ac();
  startGame();
};
$('#board').addEventListener('click', e => { const b = e.target.closest('.tile'); if (b) pickTile(+b.dataset.i); });
$('#board').addEventListener('mouseover', e => {
  if (isPCBusyTurn() || !S || !S.pending || S.pending.type !== 'bomb') return;
  const N = boardN(S);
  const b = e.target.closest('.tile.target');
  if (!b) return;
  $$('.tile.blast').forEach(x => x.classList.remove('blast'));
  const i = +b.dataset.i;
  [i, ...neighbors(i, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('blast'); });
});
$('#board').addEventListener('mouseleave', () => {
  if (isPCBusyTurn() || !S || !S.pending || S.pending.type !== 'bomb') return;
  $$('.tile.blast').forEach(x => x.classList.remove('blast'));
  if (S.pending.aim != null) {
    const N = boardN(S);
    [S.pending.aim, ...neighbors(S.pending.aim, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('blast'); });
  }
});
$('#banner').addEventListener('click', async e => {
  if (e.target.id === 'go-result') { showResult(); return; }
  if (e.target.id === 'confirm-bomb' && !busy && S && S.pending && S.pending.type === 'bomb' && S.pending.aim != null) { await detonateBomb(S.pending.aim); return; }
  if (e.target.id !== 'skip-pending' || busy) return;
  if (!(await confirmModal({ title: '카드 효과를 건너뛸까요?', desc: '이번 카드 효과를 쓰지 않고 다음 차례로 넘어갑니다.' }))) return;
  addLog(`${S.teams[S.turn].name} 카드 효과 건너뜀`);
  finishAction();
});
$('#arena').addEventListener('click', e => {
  const mg = e.target.closest('[data-manage]');
  if (mg && S) {
    if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
    sfx('click');
    openTeamManage(+mg.dataset.manage);
    return;
  }
  const b = e.target.closest('[data-adj]');
  if (!b || !S) return;
  const actor = S.settings.playMode === 'solo' ? '수동 조정' : '선생님';
  const k = +b.dataset.adj;
  const v = +b.dataset.v;
  S.teams[k].bonus += v;
  addLog(`${actor}: ${S.teams[k].name} ${v > 0 ? '+' : ''}${v}점`);
  sfx(v > 0 ? 'coin' : 'click');
  render();
});

$('#g-home').onclick = async () => {
  if (await confirmModal({ title: '처음 화면으로 갈까요?', desc: '게임은 자동 저장되어 ‘이어하기’로 계속할 수 있어요.' })) {
    gameSession++;
    aiFocusTile = -1;
    if (annFinish) annFinish();
    closeModal();
    closeHostLiveRoom();
    show('title');
  }
};
$('#g-bgm').onclick = () => { AU.bgm = !AU.bgm; AU.bgm ? bgmStart() : bgmStop(); saveAudio(); renderTop(); };
$('#g-sfx').onclick = () => { AU.sfx = !AU.sfx; saveAudio(); renderTop(); sfx('click'); };
$('#g-vol').onclick = () => { AU.vol = AU.vol <= 0.5 ? 1 : AU.vol <= 1.1 ? 1.7 : 0.4; saveAudio(); renderTop(); toast(`음량: ${volLabel()}`); sfx('click'); };
$('#g-undo').onclick = async () => {
  if (busy) return;
  if (!undoStack.length) { toast('되돌릴 수 있는 기록이 없어요'); return; }
  if (!(await confirmModal({ title: '한 단계 되돌릴까요?', desc: '바로 전 칸을 고르기 전 상태로 돌아갑니다.' }))) return;
  gameSession++;
  aiFocusTile = -1;
  S = JSON.parse(undoStack.pop());
  closeModal();
  lastScores = null;
  render();
  toast('↶ 한 단계 되돌렸어요');
};
$('#g-log').onclick = () => {
  if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  openModal(`<p class="m-title">📜 게임 기록</p><div class="log-list">${S.log.length ? S.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('') : '<div>아직 기록이 없어요.</div>'}</div><div class="m-actions"><button class="pbtn gold" id="m-close">닫기</button></div>`, '', 'info');
  $('#m-close').onclick = closeModal;
};
$('#g-help').onclick = openHowto;
$('#g-end').onclick = async () => {
  if (busy) return;
  if (await confirmModal({ title: '지금 점수로 게임을 끝낼까요?', desc: '최종 결과 화면으로 이동합니다.', okText: '끝내기', danger: true })) {
    gameOver(S && S.settings.playMode === 'solo' ? '게임을 마쳤어요' : '선생님이 게임을 마쳤어요');
  }
};
$('#r-again').onclick = () => {
  ac();
  if (S) startGame({ settings: { ...S.settings }, customQuestions: S.customQuestions || null, setId: S.setId, setName: S.setName, shareCode: S.shareCode, teams: S.teams.map(t => ({ name: t.name, emoji: t.emoji, isAI: t.isAI, aiLevel: t.aiLevel })) });
  else startGame();
};
$('#r-review').onclick = openReviewModal;
$('#r-hof-save').onclick = () => {
  if (!S || S.hofSaved) return;
  const { scores, order } = computeStanding(S);
  const wIdx = order[0];
  const rIdx = order[1];
  const winTeam = S.teams[wIdx];
  const runTeam = rIdx != null ? S.teams[rIdx] : null;
  addHallOfFameEntry({
    setName: S.setName,
    playMode: S.settings.playMode,
    boardSize: boardN(S),
    winnerName: winTeam.name,
    winnerEmoji: winTeam.emoji,
    winnerScore: scores[wIdx],
    runnerUp: runTeam ? `2위 ${runTeam.name} (${scores[rIdx]}점)` : ''
  });
  S.hofSaved = true;
  save();
  $('#r-hof-save').disabled = true;
  $('#r-hof-save').textContent = '✅ 명예의 전당 기록됨';
  sfx('coin');
  toast('🏆 명예의 전당에 기록했어요!');
};
$('#r-board').onclick = () => { show('game'); render(); };
window.addEventListener('resize', () => { if (S && $('#screen-game').classList.contains('active')) { renderTop(); renderBingoLines(); } });

function drawBg(theme = 'forest') {
  const bg = $('#bg');
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

async function checkSharedLaunch() {
  const params = new URLSearchParams(location.search || '');
  const roomParam = normalizeRoomCode(params.get('room') || '');
  if (roomParam) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    openLiveJoinModal();
    setTimeout(() => {
      const inp = $('#lj-code');
      if (inp) inp.value = roomParam;
    }, 30);
    return;
  }

  const codeParam = normalizeCode(params.get('code') || '');
  if (codeParam) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    try {
      const row = await fetchSharedSet(codeParam);
      if (row) {
        await openSharedSetPrompt({ name: row.title, rawText: row.content, count: row.question_count, shareCode: row.code });
        return;
      }
      toast(`❌ 공유 코드(${codeParam})를 찾을 수 없어요`);
    } catch {
      toast('⚠️ 공유 코드를 불러오지 못했어요 (네트워크 확인)');
    }
  }

  const h = location.hash || '';
  if (!h.startsWith('#set=')) return;
  const token = h.slice(5);
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  try {
    const payload = await decodeSetShare(token);
    const name = String(payload?.n || '공유 문제 세트').trim().slice(0, 30) || '공유 문제 세트';
    const rawText = String(payload?.t || '');
    const parsed = parseQuestions(rawText).list;
    await openSharedSetPrompt({ name, rawText, count: parsed.length });
  } catch {
    toast('공유 링크가 손상되었거나 지원되지 않아요');
  }
}

/* ================= 오프라인 상태 · PWA 업데이트 ================= */
function syncOnlineBadge() {
  const pill = $('#offline-pill');
  if (pill) pill.classList.toggle('hidden', navigator.onLine !== false);
}
window.addEventListener('online', syncOnlineBadge);
window.addEventListener('offline', syncOnlineBadge);
syncOnlineBadge();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const showUpdate = worker => {
        const banner = $('#pwa-banner');
        if (!banner || !worker) return;
        banner.classList.remove('hidden');
        $('#pwa-apply').onclick = () => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
        $('#pwa-dismiss').onclick = () => banner.classList.add('hidden');
      };
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    } catch {}
  });
}

if (AU.bgm) {
  const startSavedBgm = () => { if (AU.bgm && !AU.timer) bgmStart(); };
  window.addEventListener('pointerdown', startSavedBgm, { once: true });
  window.addEventListener('keydown', startSavedBgm, { once: true });
}
window.addEventListener('hashchange', checkSharedLaunch);
applyTheme(setup.settings.theme);
applyMotion(setup.settings.reduceMotion);
renderSetup();
refreshTitle();
checkSharedLaunch();
