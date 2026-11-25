import { TEAM_PRESETS, DEFAULT_SETTINGS, AI_CONF, SOLO_MISSIONS, REWARDS, MISSIONS, TEAM_TARGET } from '../data/sets.js';
import { isSafeImageUrl, parseQuestions, serializeQuestions, matchShortAnswer, getSpeechSpec, makeChosungHint, formatRichText } from '../core/questions.js';
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
} from '../core/engine.js';
import { load, store, savedSets, getSet, loadSoloStats, recordSetMastery, addHallOfFameEntry, recordWrongQuestion, resolveWrongQuestion } from '../utils/storage.js';
import { AU, saveAudio, volLabel, ac, sfx, vibrate, bgmStart, bgmStop, setBgmStyle, speakText, isTtsSupported } from '../utils/audio.js';
import { submitReviewResult } from '../utils/cloud.js';
import { printQuestionSheet } from './print.js';
import {
  $,
  $$,
  esc,
  sleep,
  isReducedMotion,
  app,
  actions,
  saveSetup,
  applyTheme,
  applyMotion,
  show,
  toast,
  announce,
  confetti,
  shakeBoard,
  recordSoloResult,
  soloStatsHTML,
  scheduleAutoNext,
  stopTimer,
  startQuestionTimer,
  openModal,
  closeModal,
  confirmModal,
  isAISessionAlive,
  isPCBusyTurn,
  waitConfirmClear,
  skipAIWait,
  aiWait,
  saveGame,
  teamTag,
  addLog,
  pushUndo
} from './shared.js';

function triggerTileFx(indices, cls) {
  if (isReducedMotion()) return;
  indices.forEach(idx => app.tileFx.set(idx, cls));
  setTimeout(() => {
    indices.forEach(idx => { if (app.tileFx.get(idx) === cls) app.tileFx.delete(idx); });
    const boardEl = $('#board');
    if (boardEl) {
      indices.forEach(idx => {
        const el = boardEl.querySelector(`.tile[data-i="${idx}"]`);
        if (el) el.classList.remove(cls);
      });
    }
  }, 600);
}

export function closeMoreMenu() {
  const m = $('#more-menu');
  if (m) { m.classList.add('hidden'); $('#g-more').setAttribute('aria-expanded', 'false'); }
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('전체화면을 열 수 없어요'));
    else toast('이 브라우저에서는 전체화면을 지원하지 않아요');
  } else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

export function startGame(opts = null) {
  app.gameSession++;
  app.aiFocusTile = -1;
  app.aiFastTurn = false;
  app.tileFx.clear();
  app.prevRenderedLines = new Set();

  const st = opts && opts.settings ? { ...DEFAULT_SETTINGS, ...opts.settings } : { ...app.setup.settings };
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
      mkTeam({ name: (app.setup.solo.name || '').trim() || '나', emoji: app.setup.solo.emoji || '🦊' }, 0, false),
      mkTeam({ name: 'PC', emoji: '🤖' }, 1, true, st.aiLevel || 'normal')
    ];
  } else {
    teams = app.setup.teams.slice(0, st.teamCount).map((t, k) => mkTeam(t, k, false));
  }

  const setName = (opts && opts.setName) || (activeSet ? activeSet.name : '퀴즈');
  const setId = (opts && opts.setId) || (activeSet ? activeSet.id : st.setId);
  const shareCode = (opts && opts.shareCode) || (activeSet ? activeSet.shareCode || null : null);

  app.S = {
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
    stealReturnTurn: null,
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
  app.undoStack = [];
  app.lastScores = null;
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

export function resumeGame() {
  const S = load('bq_save', null);
  app.S = S;
  if (!S || !Array.isArray(S.tiles) || !S.teams) return;
  app.gameSession++;
  app.aiFocusTile = -1;
  app.aiFastTurn = false;
  app.tileFx.clear();
  app.prevRenderedLines = new Set();
  const rootN = Math.round(Math.sqrt(S.tiles.length));
  S.size = [3, 4, 5].includes(S.size) ? S.size : ([3, 4, 5].includes(rootN) ? rootN : 5);
  S.settings = { ...DEFAULT_SETTINGS, ...(S.settings || {}), boardSize: S.size };
  if (!S.settings.playMode) S.settings.playMode = S.teams.some(t => t.isAI) ? 'solo' : 'team';
  if (S.stealReturnTurn === undefined) S.stealReturnTurn = null;
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
  app.undoStack = [];
  app.lastScores = null;
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

export function render() {
  if (!app.S) return;
  renderBoard();
  renderTeams();
  renderTop();
  renderBanner();
  saveGame();
  if (app.liveRoom && actions.broadcastLiveState) actions.broadcastLiveState();
}

export function renderBingoLines() {
  const S = app.S;
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
    const isNew = !app.prevRenderedLines.has(key);
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
  app.prevRenderedLines = nextSet;
  svg.innerHTML = out.join('');
}

function renderBoard() {
  const S = app.S;
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
    if (i === app.aiFocusTile) cls += ' ai-focus';
    if (bombAim && bombAim.has(i)) cls += ' blast';
    if (app.tileFx.has(i)) cls += ' ' + app.tileFx.get(i);

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
  const S = app.S;
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
    if (app.lastScores && app.lastScores[k] !== undefined && app.lastScores[k] !== scores[k]) {
      const d = scores[k] - app.lastScores[k];
      const f = document.createElement('div');
      f.className = 'float ' + (d > 0 ? 'p' : 'm');
      f.textContent = (d > 0 ? '+' : '') + d;
      el.appendChild(f);
      el.classList.add('pop');
    }
  });
  app.lastScores = scores;
}

export function renderTop() {
  const S = app.S;
  if (!S) return;
  const { scores, order, rank } = computeStanding(S);
  $('#rankbar').innerHTML = order.map(k => {
    const r = rank(k);
    return `<div class="rk ${r === 1 ? 'first' : ''}"><span class="e">${S.teams[k].emoji}</span>${r}위</div>`;
  }).join('');
  const mob = $('#mob-scores');
  if (mob) {
    mob.classList.toggle('many-teams', S.teams.length >= 5);
    mob.innerHTML = order.map(k => {
      const t = S.teams[k];
      const r = rank(k);
      const b = bingoCount(S, k);
      const badges = `${t.shield ? '🛡️' : ''}${t.freeze ? '❄️' : ''}${t.double ? '✨' : ''}${(t.combo || 0) >= 2 ? `🔥${t.combo}` : ''}`;
      return `<button type="button" class="ms-chip${k === S.turn && !S.over ? ' turn' : ''}" data-manage="${k}" style="--c:${t.color};--d:${t.dark}" title="눌러서 점수·차례 관리">${r}위 ${t.emoji} ${esc(t.name)} <b class="ms-sc">${scores[k]}점</b>${b ? ` · 🎯${b}` : ''}${badges ? ` <span>${badges}</span>` : ''}</button>`;
    }).join('');
    if (S.teams.length >= 5) {
      const turnChip = mob.querySelector('.ms-chip.turn');
      if (turnChip && turnChip.scrollIntoView) {
        try { turnChip.scrollIntoView({ behavior: isReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); } catch {}
      }
    }
  }
  const lim = S.settings.roundLimit;
  $('#round').innerHTML = `<b>${S.round}</b><span class="hide-sm">라운드</span><span class="show-sm-inline">R</span>${lim ? ` <span style="font-size:13px;opacity:.75">/ ${lim}</span>` : ''}`;
  const showR = $('#round').querySelector('.show-sm-inline');
  if (showR) showR.style.display = window.innerWidth <= 900 ? 'inline' : 'none';
  $('#g-bgm').classList.toggle('off', !AU.bgm);
  $('#g-sfx').classList.toggle('off', !AU.sfx);
  $('#g-vol').textContent = volLabel();
  $('#g-undo').disabled = !app.undoStack.length;
  $('#undo-cnt').textContent = `(${app.undoStack.length})`;
  const fsOn = !!document.fullscreenElement;
  $('#g-fs').textContent = fsOn ? '⛶ 창모드' : '⛶ 전체화면';
  if (actions.refreshLiveHostUI) actions.refreshLiveHostUI();
  const mBgm = $('[data-more="bgm"]');
  const mSfx = $('[data-more="sfx"]');
  const mVol = $('[data-more="vol"]');
  const mFs = $('[data-more="fs"]');
  if (mBgm) mBgm.textContent = AU.bgm ? '♫ 음악 (켜짐)' : '♫ 음악 (꺼짐)';
  if (mSfx) mSfx.textContent = AU.sfx ? '♪ 효과음 (켜짐)' : '♪ 효과음 (꺼짐)';
  if (mVol) mVol.textContent = `${volLabel()} (음량)`;
  if (mFs) mFs.textContent = fsOn ? '⛶ 전체화면 끄기' : '⛶ 전체화면';
}

export function renderBanner() {
  const S = app.S;
  if (!S) return;
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
  const voteTop = !S.pending && actions.getTopTileVote ? actions.getTopTileVote() : null;
  const voteTag = voteTop ? `<button type="button" class="live-vote-pill live-vote-btn" id="banner-vote-pick" data-vote-idx="${voteTop.idx}" title="눌러서 ${voteTop.idx + 1}번 칸 바로 열기">📡 투표 1위: ${voteTop.idx + 1}번 (${voteTop.count}명) ▶</button>` : '';
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

function openQuickSettings() {
  const S = app.S;
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
      <div class="opt-row"><label for="qs-combo">🔥 3연속 콤보 보너스 (+5점)</label><input type="checkbox" id="qs-combo"></div>
      ${!isSolo && st.wrongMode === 'keep' ? '<div class="opt-row"><label for="qs-steal">⚡ 오답 스틸 찬스</label><input type="checkbox" id="qs-steal"></div>' : ''}
      <div class="opt-row"><label for="qs-hint50">💡 힌트 찬스 허용</label><input type="checkbox" id="qs-hint50"></div>
      <div class="opt-row"><label for="qs-motion">애니메이션 줄이기</label><input type="checkbox" id="qs-motion"></div>
      ${isSolo ? '<div class="opt-row"><label for="qs-aifast">⏩ PC 차례 빠르게</label><input type="checkbox" id="qs-aifast"></div>' : ''}
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">적용하고 닫기</button></div>`, 'narrow', 'settings');

  $('#qs-theme').value = st.theme || 'forest';
  $('#qs-bgm').value = st.bgmStyle || 'upbeat';
  $('#qs-timer').value = String(st.timer || 0);
  $('#qs-ttsauto').checked = !!st.ttsAuto;
  $('#qs-ttsrate').value = String(st.ttsRate || 1);
  $('#qs-autonext').checked = !!st.autoNext;
  $('#qs-reach').checked = !!st.reachHint;
  $('#qs-combo').checked = !!st.comboBonus;
  if ($('#qs-steal')) $('#qs-steal').checked = !!st.stealOnWrong;
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
    st.comboBonus = $('#qs-combo').checked;
    if ($('#qs-steal')) st.stealOnWrong = $('#qs-steal').checked;
    st.hint5050 = $('#qs-hint50').checked;
    st.reduceMotion = $('#qs-motion').checked;
    if ($('#qs-aifast')) st.aiFast = $('#qs-aifast').checked;
    Object.assign(app.setup.settings, {
      theme: st.theme, bgmStyle: st.bgmStyle, timer: st.timer,
      ttsAuto: st.ttsAuto, ttsRate: st.ttsRate, autoNext: st.autoNext,
      reachHint: st.reachHint, comboBonus: st.comboBonus, stealOnWrong: st.stealOnWrong,
      hint5050: st.hint5050, reduceMotion: st.reduceMotion, aiFast: st.aiFast
    });
    saveSetup();
    applyTheme(st.theme);
    applyMotion(st.reduceMotion);
    setBgmStyle(st.bgmStyle);
    render();
  };
  ['#qs-theme', '#qs-bgm', '#qs-timer', '#qs-ttsauto', '#qs-ttsrate', '#qs-autonext', '#qs-reach', '#qs-combo', '#qs-steal', '#qs-hint50', '#qs-motion', '#qs-aifast'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', sync);
  });
  $('#m-close').onclick = closeModal;
}

function openTeamManage(k) {
  const S = app.S;
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
    app.gameSession++;
    app.aiFocusTile = -1;
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

function pickTile(i) {
  const S = app.S;
  if (app.busy || !S || S.over || $('#modal').classList.contains('show') || S.teams[S.turn]?.isAI) return;
  if (S.pending) { handleTarget(i); return; }
  const t = S.tiles[i];
  if (t.opened) { toast(t.owner >= 0 ? `이미 ${S.teams[t.owner].name}의 땅이에요` : '빈 땅은 🚩땅따먹기 카드로만 차지할 수 있어요'); return; }
  pushUndo();
  sfx('open');
  if (!t.q) { luckyTile(i); return; }
  openQuestion(i);
}

async function luckyTile(i) {
  const sid = app.gameSession;
  await announce('🍀 행운 칸!', '문제 없이 이 칸을 차지해요', 'gold', 1600);
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  resolveCorrect(i, true);
}

function openQuestion(i, stealOpts = null) {
  const S = app.S;
  const tile = S.tiles[i];
  const q = tile.q;
  const isSteal = !!(stealOpts && stealOpts.stealer != null);
  const actorIdx = isSteal ? stealOpts.stealer : S.turn;
  const origTurn = isSteal ? stealOpts.origTurn : S.turn;
  const team = S.teams[actorIdx];
  const opts = q.opts ? shuffle([...q.opts]) : null;
  const isSolo = S.settings.playMode === 'solo';
  const isSoloSA = !opts && isSolo && !team.isAI;
  const canHintMC = !!(opts && opts.length >= 4 && S.settings.hint5050 && (team.hintsLeft || 0) > 0);
  const canHintSA = !!(!opts && S.settings.hint5050 && (team.hintsLeft || 0) > 0 && makeChosungHint(q.a));
  const longCls = q.q.length > 65 ? ' long' : '';
  const speech = getSpeechSpec(q.q);
  const ttsBtn = isTtsSupported() ? '<button type="button" class="q-tts-btn" id="q-tts" title="문제 읽어주기">🔊 읽기</button>' : '';
  const imgHtml = q.img && isSafeImageUrl(q.img) ? `<img class="q-img" src="${esc(q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';

  if (app.liveRoom && actions.broadcastLiveQuestion) {
    actions.broadcastLiveQuestion({ qIndex: i, q: q.q, opts, isMc: !!opts, img: q.img || '' });
  }

  let stolen = false;
  const box = openModal(`
    <div class="q-head" style="--c:${team.color}">
      <span>${isSteal ? `⚡ 스틸 도전! ${teamTag(actorIdx)}` : `${teamTag(actorIdx)} 도전!`}</span>
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
      : `${isSoloSA ? '<form class="q-sa-form" id="q-sa-form"><input type="text" id="q-sa-input" placeholder="정답을 입력하고 Enter" autocomplete="off"><button type="submit" class="pbtn gold" id="q-sa-submit">제출</button></form>' : ''}
         <div class="q-answer" id="q-answer">정답: <b>${formatRichText(q.a)}</b></div>`}
    ${q.explain ? `<div class="q-explain hidden" id="q-explain">💡 <b>해설:</b> ${formatRichText(q.explain)}</div>` : ''}
    <div id="live-resp-box" class="live-resp-box hidden"></div>
    <div class="q-msg" id="q-msg"></div>
    <div id="q-steal-wrap"></div>
    <div class="q-actions" id="q-actions">
      ${opts ? '' : (isSoloSA ? '<button class="pbtn white" id="q-reveal">👀 정답 확인 (직접 채점)</button>' : '<button class="pbtn gold" id="q-reveal">👀 정답 보기<kbd class="kh">Space</kbd></button><button class="pbtn ok" id="q-ok">⭕ 맞혔어요<kbd class="kh">O</kbd></button><button class="pbtn bad" id="q-no">❌ 틀렸어요<kbd class="kh">X</kbd></button>')}
      ${canHintMC ? `<button type="button" class="pbtn blue" id="q-hint">💡 50:50 찬스 (${team.hintsLeft})</button>` : ''}
      ${canHintSA ? `<button type="button" class="pbtn blue" id="q-sa-hint">💡 초성·철자 힌트 (${team.hintsLeft})</button>` : ''}
      ${isSteal ? '<button type="button" class="pbtn ghost" id="q-steal-skip">↩ 스틸 건너뛰기</button>' : (isSolo ? '' : '<button class="pbtn ghost" id="q-cancel">↩ 문제 닫기 (다른 칸 고르기)<kbd class="kh">Esc</kbd></button>')}
    </div>`, '', 'question', () => {
      if (!stolen && actions.broadcastLiveQuestionClosed) actions.broadcastLiveQuestionClosed();
    });

  box.style.setProperty('--qscale', app.qScale);
  if (actions.refreshLiveHostUI) actions.refreshLiveHostUI();
  if ($('#q-tts')) $('#q-tts').onclick = () => speakText(speech.text, speech.lang, S.settings.ttsRate || 1);
  if (S.settings.ttsAuto && isTtsSupported()) {
    setTimeout(() => { if ($('#modal').classList.contains('show')) speakText(speech.text, speech.lang, S.settings.ttsRate || 1); }, 120);
  }
  $('#q-fdec').onclick = () => { app.qScale = Math.max(0.8, +(app.qScale - 0.1).toFixed(2)); box.style.setProperty('--qscale', app.qScale); store('bq_qscale', app.qScale); };
  $('#q-finc').onclick = () => { app.qScale = Math.min(1.35, +(app.qScale + 0.1).toFixed(2)); box.style.setProperty('--qscale', app.qScale); store('bq_qscale', app.qScale); };

  let answered = false;
  let proceeded = false;
  const revealExplain = () => { const ex = $('#q-explain'); if (ex) ex.classList.remove('hidden'); };

  const goNextNow = ok => {
    if (proceeded) return;
    proceeded = true;
    closeModal();
    if (!ok && actions.broadcastLiveQuestionResult) {
      actions.broadcastLiveQuestionResult({ qIndex: i, correctAnswer: q.a, ok: false, teamName: team.name });
    }
    if (isSteal) {
      if (ok) {
        S.stealReturnTurn = origTurn;
        S.turn = actorIdx;
        S.teams[actorIdx].stats.steals++;
        addLog(`${team.emoji} ${team.name}: ⚡ ${i + 1}번 칸 오답 스틸 성공!`);
        resolveCorrect(i);
      } else {
        resolveWrong(i, { isStealFail: true, stealer: actorIdx, origTurn });
      }
      return;
    }
    ok ? resolveCorrect(i) : resolveWrong(i);
  };

  const finish = (ok, delay) => {
    if (answered) return;
    answered = true;
    stopTimer();
    box.querySelectorAll('.q-opt,#q-reveal,#q-ok,#q-no,#q-cancel,#q-steal-skip,#q-pause,#q-plus10,#q-sa-input,#q-sa-submit,#q-hint,#q-sa-hint').forEach(b => { b.disabled = true; });
    revealExplain();

    const canSteal = !ok && !isSolo && !isSteal && S.settings.wrongMode === 'keep' && S.settings.stealOnWrong && S.teams.length >= 2;
    if (!canSteal && actions.broadcastLiveQuestionResult) {
      actions.broadcastLiveQuestionResult({ qIndex: i, correctAnswer: q.a, ok, teamName: team.name });
    }
    if (canSteal) {
      const others = S.teams.map((tm, k) => ({ tm, k })).filter(x => x.k !== origTurn);
      $('#q-steal-wrap').innerHTML = `
        <div class="q-steal-box">
          <div class="q-steal-title">⚡ 다른 팀 스틸 찬스! 바로 도전할 팀을 누르세요</div>
          <div class="q-steal-btns">${others.map(x => `<button type="button" class="pbtn sm" style="background:${x.tm.color};color:#fff" data-steal-team="${x.k}">${x.tm.emoji} ${esc(x.tm.name)}</button>`).join('')}</div>
        </div>`;
      $('#q-steal-wrap').querySelectorAll('[data-steal-team]').forEach(b => b.onclick = () => {
        if (proceeded) return;
        proceeded = true;
        stolen = true;
        const origTeam = S.teams[origTurn];
        tile.fails++;
        origTeam.stats.wrong++;
        origTeam.combo = 0;
        if (!origTeam.isAI && tile.q) recordWrongQuestion(tile.q);
        addLog(`${origTeam.emoji} ${origTeam.name}: ${i + 1}번 문제 오답 → ${S.teams[+b.dataset.stealTeam].name} 스틸 도전`);
        closeModal();
        openQuestion(i, { stealer: +b.dataset.stealTeam, origTurn });
      });
    }

    const nextLbl = ok && S.settings.rewards ? '🎁 보상 카드 뽑기 ▶' : (canSteal ? '스틸 없이 다음 차례 ▶' : '다음으로 ▶');
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
    if (S.settings.autoNext && !q.explain && !canSteal) {
      scheduleAutoNext(() => goNextNow(ok), delay);
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
        act.innerHTML = '<button type="button" class="pbtn ok" id="q-sa-override">⭕ 사실 맞았어요<kbd class="kh">O</kbd></button><button type="button" class="pbtn bad" id="q-sa-confirm-no">❌ 틀림으로 진행 ▶<kbd class="kh">X</kbd></button>';
        $('#q-sa-override').onclick = () => { sfx('correct'); if (actions.broadcastLiveQuestionResult) actions.broadcastLiveQuestionResult({ qIndex: i, correctAnswer: q.a, ok: true, teamName: team.name }); goNextNow(true); };
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
      act.innerHTML = '<button type="button" class="pbtn ok" id="q-sa-override">⭕ 맞혔어요<kbd class="kh">O</kbd></button><button type="button" class="pbtn bad" id="q-sa-confirm-no">❌ 틀렸어요 ▶<kbd class="kh">X</kbd></button>';
      $('#q-sa-override').onclick = () => { sfx('correct'); if (actions.broadcastLiveQuestionResult) actions.broadcastLiveQuestionResult({ qIndex: i, correctAnswer: q.a, ok: true, teamName: team.name }); goNextNow(true); };
      $('#q-sa-confirm-no').onclick = () => goNextNow(false);
      $('#q-sa-confirm-no').focus();
    };
  } else {
    $('#q-reveal').onclick = () => { sfx('flip'); $('#q-answer').classList.add('show'); revealExplain(); };
    $('#q-ok').onclick = () => { $('#q-answer').classList.add('show'); sfx('correct'); vibrate(20); $('#q-msg').textContent = '⭕ 정답!'; finish(true, 900); };
    $('#q-no').onclick = () => { sfx('wrong'); $('#q-msg').textContent = '❌ 아쉬워요!'; if (S.settings.wrongMode === 'reveal') $('#q-answer').classList.add('show'); finish(false, S.settings.wrongMode === 'reveal' ? 1800 : 900); };
  }

  if ($('#q-cancel')) {
    $('#q-cancel').onclick = () => { if (answered) return; stopTimer(); closeModal(); app.undoStack.pop(); renderTop(); };
  }
  if ($('#q-steal-skip')) {
    $('#q-steal-skip').onclick = () => { if (answered) return; stopTimer(); closeModal(); S.turn = origTurn; endTurn(); };
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
    startQuestionTimer(() => {
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
  const S = app.S;
  const goal = S && S.settings && +S.settings.bingoGoal;
  if (!goal || S.over) return false;
  const winners = S.teams.map((_, k) => k).filter(k => bingoCount(S, k) >= goal);
  if (!winners.length) return false;
  S.goalWinners = winners;
  gameOver(`🎯 ${winners.map(k => S.teams[k].name).join('·')} 빙고 ${goal}줄 달성!`);
  return true;
}

async function resolveCorrect(i, lucky = false) {
  const S = app.S;
  const sid = app.gameSession;
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
    if (!team.isAI && tile.q) {
      const wr = resolveWrongQuestion(tile.q.q, S.setId === '__weak_bank__');
      if (wr.cleared) toast('✨ 약점 문제를 정복했어요!');
    }
    if (team.combo >= 3) {
      sfx('combo');
      if (S.settings.comboBonus) {
        team.bonus += 5;
        toast(`🔥 ${team.name} ${team.combo}연속 정답! (+5점 보너스)`);
        addLog(`${team.emoji} ${team.name}: 🔥 ${team.combo}연속 보너스 +5점`);
      } else {
        toast(`🔥 ${team.name} ${team.combo}연속 정답!`);
      }
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
    if (sid !== app.gameSession || !app.S || app.S.over) return;
  }
  await checkBingo();
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  if (checkBingoGoalWin()) return;
  if (S.settings.rewards) showCards();
  else endTurn();
}

function resolveWrong(i, opts = null) {
  const S = app.S;
  const tile = S.tiles[i];
  const actorIdx = opts && opts.isStealFail ? opts.stealer : S.turn;
  const team = S.teams[actorIdx];
  tile.fails++;
  team.stats.wrong++;
  team.combo = 0;
  if (!team.isAI && tile.q) recordWrongQuestion(tile.q);
  if (S.settings.wrongMode === 'reveal') tile.opened = true;
  addLog(`${team.emoji} ${team.name}: ${i + 1}번 문제 오답${S.settings.wrongMode === 'reveal' ? ' → 빈 땅' : ''}`);
  if (opts && opts.isStealFail) {
    S.turn = opts.origTurn;
    S.stealReturnTurn = null;
  }
  endTurn();
}

async function checkBingo() {
  const S = app.S;
  const sid = app.gameSession;
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
    if (sid !== app.gameSession || !app.S) return;
    sfx('bingo');
    vibrate([40, 30, 60]);
    confetti();
    addLog(`🎯 ${S.teams[t].name} 빙고 ${gained[t]}줄!`);
    await announce('BINGO!', `${teamTag(+t)} 빙고 ${gained[t]}줄 · +${gained[t] * S.settings.bingoPts}점`, 'bingo', 2300);
    if (sid !== app.gameSession || !app.S) return;
  }
}

async function endTurn() {
  const S = app.S;
  const sid = app.gameSession;
  S.pending = null;
  S.phase = null;
  if (app.liveRoom) app.liveRoom.tileVotes.clear();
  if (!S.tiles.some(t => !t.opened)) {
    render();
    await sleep(300);
    if (sid !== app.gameSession || !app.S || app.S.over) return;
    gameOver('모든 칸이 열렸어요');
    return;
  }
  if (S.extra) {
    S.extra = false;
    render();
    toast(`⏩ ${S.teams[S.turn].name} 한 번 더!`);
    sfx('turn');
    app.aiFastTurn = false;
    if (!S.over && S.teams[S.turn]?.isAI) scheduleAITurn();
    return;
  }
  if (S.stealReturnTurn != null) {
    S.turn = S.stealReturnTurn;
    S.stealReturnTurn = null;
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
  app.aiFastTurn = false;
  if (!S.over && S.teams[S.turn]?.isAI) scheduleAITurn();
}

async function submitSoloCloudIfNeeded(manualRetry = false) {
  const S = app.S;
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
      saveGame();
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
  const S = app.S;
  app.gameSession++;
  const sid = app.gameSession;
  app.aiFocusTile = -1;
  app.aiFastTurn = false;
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
  if (sid !== app.gameSession) return;
  showResult();
  submitSoloCloudIfNeeded();
}

export function scheduleAITurn() {
  const sid = app.gameSession;
  const delay = app.S?.settings?.aiFast ? 90 : (isReducedMotion() ? 120 : 260);
  setTimeout(() => { if (isAISessionAlive(sid)) runAITurn(sid); }, delay);
}

async function runAITurn(sid) {
  while (app.busy && sid === app.gameSession) await sleep(80);
  await waitConfirmClear(sid);
  if (!isAISessionAlive(sid)) return;
  const S = app.S;
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
  const S = app.S;
  app.aiFocusTile = i;
  sfx('open');
  renderBoard();
  await aiWait(380, 150);
  await waitConfirmClear(sid);
  app.aiFocusTile = -1;
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
  box.style.setProperty('--qscale', app.qScale);
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
  const S = app.S;
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

function drawCards(n = 3) {
  const S = app.S;
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
  const S = app.S;
  S.phase = 'cards';
  saveGame();
  const cards = drawCards(3);
  const isAI = !!(S.teams[S.turn] && S.teams[S.turn].isAI);
  const box = openModal(`
    <div class="cards-title">${isAI ? '🤖 PC가 카드를 고르고 있어요...' : `${teamTag(S.turn)} 정답 보상! 카드를 한 장 고르세요`}</div>
    <div class="cards">${cards.map((c, k) => `<button class="card" data-k="${k}" aria-label="${k + 1}번 카드"><div class="card-inner"><div class="card-back"><span class="cnum">${k + 1}</span><small class="cq">?</small></div>${cardFront(c)}</div></button>`).join('')}</div>
    <div class="cards-foot" id="cards-foot">${isAI ? '<button type="button" class="pbtn sm white" id="ai-skip">⏩ 빠르게<kbd class="kh">Space</kbd></button>' : ''}</div>`, 'wide', 'cards');
  if (isAI) {
    const sid = app.gameSession;
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
    const sid = app.gameSession;
    const c = cards[+b.dataset.k];
    b.classList.add('flipped', 'chosen');
    sfx('flip');
    box.querySelectorAll('.card').forEach(x => { x.disabled = true; });
    setTimeout(() => {
      if (sid !== app.gameSession || !$('#cards-foot')) return;
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
    const sid = app.gameSession;
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const d = 1 + ((Math.random() * 6) | 0);
    openModal(`
      <p class="m-title">🎲 행운 주사위</p>
      <p class="m-desc">${teamTag(app.S.turn)} 주사위를 굴려요! (눈 × 5점)</p>
      <div class="dice-face roll" id="dice-face">⚀</div>
      <div class="q-msg" id="dice-msg">데굴데굴...</div>
      <div class="m-actions ${T.isAI ? '' : 'hidden'}" id="dice-act">${T.isAI ? '<button type="button" class="pbtn sm white" id="ai-skip">⏩ 빠르게<kbd class="kh">Space</kbd></button>' : '<button type="button" class="pbtn gold big" id="dice-ok">확인<kbd class="kh">Enter</kbd></button>'}</div>`, 'narrow', 'dice');
    if (T.isAI && $('#ai-skip')) $('#ai-skip').onclick = skipAIWait;
    const steps = app.aiFastTurn ? 1 : (isReducedMotion() ? 2 : (T.isAI ? 6 : 10));
    for (let k = 0; k < steps; k++) {
      const el = $('#dice-face');
      if (sid !== app.gameSession || !el) { res(false); return; }
      el.textContent = faces[(Math.random() * 6) | 0];
      sfx('tick');
      await sleep(70 + k * 18);
      if (sid !== app.gameSession || !$('#dice-face')) { res(false); return; }
    }
    const el = $('#dice-face');
    if (sid !== app.gameSession || !el) { res(false); return; }
    el.classList.remove('roll');
    el.textContent = faces[d - 1];
    T.bonus += d * 5;
    sfx('coin');
    render();
    $('#dice-msg').textContent = `🎉 ${d}이 나왔어요! (+${d * 5}점 획득)`;
    if (T.isAI) {
      await aiWait(700, 220);
      await waitConfirmClear(sid);
      if (sid !== app.gameSession) { res(false); return; }
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
    const S = app.S;
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
  const tm = app.S.teams[t];
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
  app.S.teams[app.S.turn].bonus += 10;
  sfx('coin');
  toast(`${r.icon} 쓸 수 있는 칸이 없어서 보너스 +10점으로 바뀌었어요`);
}

async function applyReward(r) {
  const S = app.S;
  const sid = app.gameSession;
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
      if (validTargets(S, p).length) { S.pending = p; render(); if (T.isAI) runAIPending(app.gameSession); return; }
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
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  finishAction();
}

async function finishAction() {
  const sid = app.gameSession;
  app.S.pending = null;
  render();
  await checkBingo();
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  if (checkBingoGoalWin()) return;
  endTurn();
}

async function detonateBomb(i) {
  const S = app.S;
  const sid = app.gameSession;
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
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  finishAction();
}

async function handleTarget(i) {
  const S = app.S;
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
  const S = app.S;
  S.phase = 'team:' + r.id;
  saveGame();
  const others = S.teams.map((_, k) => k).filter(k => k !== S.turn);
  const box = openModal(`
    <p class="m-title">${r.icon} ${r.name}</p><p class="m-desc">${esc(r.desc)}</p>
    <p class="m-desc" style="margin-top:6px;font-weight:800">${teamTag(S.turn)}, 어느 팀을 고를까요?</p>
    <div class="team-pick">${others.map((k, idx) => { const t = S.teams[k]; return `<button data-t="${k}" style="--c:${t.color}"><span style="font-size:42px">${t.emoji}</span>${esc(t.name)}<small>${score(S, k)}점 <kbd class="kh">${idx + 1}</kbd></small>${t.shield && r.id !== 'gift' ? '<span class="sh">🛡️ 방패 있음</span>' : ''}</button>`; }).join('')}</div>`, 'narrow', 'teampick');
  box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { closeModal(); applyTeamEffect(r, +b.dataset.t); });
}

async function applyTeamEffect(r, k) {
  const S = app.S;
  const sid = app.gameSession;
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
      if (sid !== app.gameSession || !app.S || app.S.over) return;
    }
  }
  finishAction();
}

function showResult() {
  const S = app.S;
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
  $('#res-table').innerHTML = '<tr><th>팀</th><th>순위</th><th>칸</th><th>빙고</th><th>보너스</th><th>총점</th><th>칭찬 배지</th></tr>' +
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
  const S = app.S;
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
      const prev = app.S;
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
      const base = (app.S.setName || '복습').replace(/\s*\(오답 복습\)$/, '');
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
      const safe = ((app.S.setName || '복습').replace(/\s*\(오답 복습\)$/, '') || '오답노트').replace(/[\\/:*?"<>|]/g, '_');
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
        title: `${app.S.setName || '복습'} · 오답 노트`,
        subtitle: `틀린 문제 ${missed.length}개 복습 학습지`,
        questions: missed.map(t => t.q),
        includeAnswers: true
      });
    };
  }
  $('#m-close').onclick = closeModal;
  draw();
}

export function initGame() {
  actions.startGame = startGame;
  actions.resumeGame = resumeGame;
  actions.render = render;
  actions.renderTop = renderTop;
  actions.renderBanner = renderBanner;
  actions.renderBingoLines = renderBingoLines;
  actions.scheduleAITurn = scheduleAITurn;
  actions.closeMoreMenu = closeMoreMenu;
  actions.toggleFullscreen = toggleFullscreen;

  document.addEventListener('fullscreenchange', () => { if (app.S) renderTop(); });
  $('#g-fs').onclick = toggleFullscreen;
  $('#g-settings').onclick = openQuickSettings;
  $('#g-live').onclick = () => { if (actions.openHostLiveModal) actions.openHostLiveModal(); };
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
    if (act === 'live' && actions.openHostLiveModal) actions.openHostLiveModal();
    else if (act === 'settings') openQuickSettings();
    else if (act === 'bgm') $('#g-bgm').click();
    else if (act === 'sfx') $('#g-sfx').click();
    else if (act === 'vol') $('#g-vol').click();
    else if (act === 'log') $('#g-log').click();
    else if (act === 'fs') toggleFullscreen();
    else if (act === 'help' && actions.openHowto) actions.openHowto();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.more-wrap')) closeMoreMenu();
  });

  $('#board').addEventListener('click', e => { const b = e.target.closest('.tile'); if (b) pickTile(+b.dataset.i); });
  $('#board').addEventListener('mouseover', e => {
    const S = app.S;
    if (isPCBusyTurn() || !S || !S.pending || S.pending.type !== 'bomb') return;
    const N = boardN(S);
    const b = e.target.closest('.tile.target');
    if (!b) return;
    $$('.tile.blast').forEach(x => x.classList.remove('blast'));
    const i = +b.dataset.i;
    [i, ...neighbors(i, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('blast'); });
  });
  $('#board').addEventListener('mouseleave', () => {
    const S = app.S;
    if (isPCBusyTurn() || !S || !S.pending || S.pending.type !== 'bomb') return;
    $$('.tile.blast').forEach(x => x.classList.remove('blast'));
    if (S.pending.aim != null) {
      const N = boardN(S);
      [S.pending.aim, ...neighbors(S.pending.aim, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('blast'); });
    }
  });
  $('#banner').addEventListener('click', async e => {
    const S = app.S;
    const vp = e.target.closest('#banner-vote-pick');
    if (vp) { pickTile(+vp.dataset.voteIdx); return; }
    if (e.target.id === 'go-result') { showResult(); return; }
    if (e.target.id === 'confirm-bomb' && !app.busy && S && S.pending && S.pending.type === 'bomb' && S.pending.aim != null) { await detonateBomb(S.pending.aim); return; }
    if (e.target.id !== 'skip-pending' || app.busy) return;
    if (!(await confirmModal({ title: '카드 효과를 건너뛸까요?', desc: '이번 카드 효과를 쓰지 않고 다음 차례로 넘어갑니다.' }))) return;
    addLog(`${S.teams[S.turn].name} 카드 효과 건너뜀`);
    finishAction();
  });
  $('#arena').addEventListener('click', e => {
    const S = app.S;
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
      app.gameSession++;
      app.aiFocusTile = -1;
      if (app.annFinish) app.annFinish();
      closeModal();
      if (actions.closeHostLiveRoom) actions.closeHostLiveRoom();
      show('title');
    }
  };
  $('#g-bgm').onclick = () => { AU.bgm = !AU.bgm; AU.bgm ? bgmStart() : bgmStop(); saveAudio(); renderTop(); };
  $('#g-sfx').onclick = () => { AU.sfx = !AU.sfx; saveAudio(); renderTop(); sfx('click'); };
  $('#g-vol').onclick = () => { AU.vol = AU.vol <= 0.5 ? 1 : AU.vol <= 1.1 ? 1.7 : 0.4; saveAudio(); renderTop(); toast(`음량: ${volLabel()}`); sfx('click'); };
  $('#g-undo').onclick = async () => {
    if (app.busy) return;
    if (!app.undoStack.length) { toast('되돌릴 수 있는 기록이 없어요'); return; }
    if (!(await confirmModal({ title: '한 단계 되돌릴까요?', desc: '바로 전 칸을 고르기 전 상태로 돌아갑니다.' }))) return;
    app.gameSession++;
    app.aiFocusTile = -1;
    app.S = JSON.parse(app.undoStack.pop());
    closeModal();
    app.lastScores = null;
    render();
    toast('↶ 한 단계 되돌렸어요');
  };
  $('#g-log').onclick = () => {
    const S = app.S;
    if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
    openModal(`<p class="m-title">📜 게임 기록</p><div class="log-list">${S.log.length ? S.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('') : '<div>아직 기록이 없어요.</div>'}</div><div class="m-actions"><button class="pbtn gold" id="m-close">닫기</button></div>`, '', 'info');
    $('#m-close').onclick = closeModal;
  };
  $('#g-help').onclick = () => { if (actions.openHowto) actions.openHowto(); };
  $('#g-end').onclick = async () => {
    if (app.busy) return;
    if (await confirmModal({ title: '지금 점수로 게임을 끝낼까요?', desc: '최종 결과 화면으로 이동합니다.', okText: '끝내기', danger: true })) {
      gameOver(app.S && app.S.settings.playMode === 'solo' ? '게임을 마쳤어요' : '선생님이 게임을 마쳤어요');
    }
  };
  $('#r-again').onclick = () => {
    ac();
    const S = app.S;
    if (S) startGame({ settings: { ...S.settings }, customQuestions: S.customQuestions || null, setId: S.setId, setName: S.setName, shareCode: S.shareCode, teams: S.teams.map(t => ({ name: t.name, emoji: t.emoji, isAI: t.isAI, aiLevel: t.aiLevel })) });
    else startGame();
  };
  $('#r-review').onclick = openReviewModal;
  $('#r-hof-save').onclick = () => {
    const S = app.S;
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
    saveGame();
    $('#r-hof-save').disabled = true;
    $('#r-hof-save').textContent = '✅ 명예의 전당 기록됨';
    sfx('coin');
    toast('🏆 명예의 전당에 기록했어요!');
  };
  $('#r-board').onclick = () => { show('game'); render(); };
  window.addEventListener('resize', () => {
    if (app.S && $('#screen-game').classList.contains('active')) { renderTop(); renderBingoLines(); }
  });
}
