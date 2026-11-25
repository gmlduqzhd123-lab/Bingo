import { TEAM_PRESETS, DEFAULT_SETTINGS, AI_CONF, REWARDS } from '../data/sets.js';
import { parseQuestions } from '../core/questions.js';
import { shuffle, getLines, neighbors, emptyStats, boardN, lineOwners, tileCount, bingoCount, score, computeStanding, assignJeopardyPoints } from '../core/engine.js';
import { load, getSet, addHallOfFameEntry, selectPooledQuestions } from '../utils/storage.js';
import { AU, saveAudio, volLabel, ac, sfx, bgmStart, bgmStop, setBgmStyle } from '../utils/audio.js';
import { $, $$, esc, app, actions, applyTheme, applyMotion, applyBigScreen, show, toast, announce, closeModal, confirmModal, saveGame, teamTag, addLog } from './shared.js';
import { initBoard, render, renderTop, renderBingoLines, closeMoreMenu, toggleFullscreen, openQuickSettings, openTeamManage } from './board.js';
import { initQuestion, pickTile } from './question.js';
import { initRewards, scheduleAITurn, showCards, applyTeamEffect, pickTeam, detonateBomb, finishAction } from './rewards.js';
import { initResult, gameOver, showResult, openReviewModal } from './result.js';

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
  const setId = (opts && opts.setId) || (activeSet ? activeSet.id : st.setId);
  const qs = customQs
    ? (() => { const a = [...parsed]; if (st.shuffle) shuffle(a); return a.slice(0, total); })()
    : selectPooledQuestions(setId, parsed, total, { shuffleEnabled: st.shuffle, noRepeat: st.poolNoRepeat !== false, shuffleFn: shuffle });

  const tiles = Array.from({ length: total }, (_, i) => ({
    q: qs[i] || null,
    owner: -1,
    opened: false,
    golden: false,
    fails: 0,
    pts: qs[i] && Number(qs[i].pts) > 0 ? Number(qs[i].pts) : 0
  }));
  if (st.jeopardyPts) assignJeopardyPoints(tiles, N);
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
  const shareCode = (opts && opts.shareCode) || (activeSet ? activeSet.shareCode || null : null);

  app.S = {
    v: 4,
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
    weakCleared: 0,
    learnRecorded: false,
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
  applyBigScreen(st.bigScreen);
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
  applyBigScreen(S.settings.bigScreen);
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

export function initGame() {
  initBoard();
  initQuestion();
  initRewards();
  initResult();
  actions.startGame = startGame;
  actions.resumeGame = resumeGame;

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
    else if (act === 'keys' && actions.openShortcutsModal) actions.openShortcutsModal();
    else if (act === 'help' && actions.openHowto) actions.openHowto();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.more-wrap')) closeMoreMenu();
  });

  $('#board').addEventListener('click', e => { const b = e.target.closest('.tile'); if (b) pickTile(+b.dataset.i); });
  $('#board').addEventListener('mouseover', e => {
    const S = app.S;
    if (!S || S.teams[S.turn]?.isAI || !S.pending || S.pending.type !== 'bomb') return;
    const N = boardN(S);
    const b = e.target.closest('.tile.target');
    if (!b) return;
    $$('.tile.blast').forEach(x => x.classList.remove('blast'));
    const i = +b.dataset.i;
    [i, ...neighbors(i, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('blast'); });
  });
  $('#board').addEventListener('mouseleave', () => {
    const S = app.S;
    if (!S || S.teams[S.turn]?.isAI || !S.pending || S.pending.type !== 'bomb') return;
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
      if (S.teams[S.turn]?.isAI && !S.over) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
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
    if (S.teams[S.turn]?.isAI && !S.over) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
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

export { render, renderTop, toggleFullscreen };
