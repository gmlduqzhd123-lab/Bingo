import { AI_CONF } from '../data/sets.js';
import { getLines, neighbors, boardN, lineOwners, tileCount, bingoCount, score, computeStanding, validTargets, computeReachMap } from '../core/engine.js';
import { AU, volLabel, sfx, setBgmStyle } from '../utils/audio.js';
import {
  $,
  $$,
  esc,
  isReducedMotion,
  app,
  actions,
  saveSetup,
  applyTheme,
  applyMotion,
  applyBigScreen,
  toast,
  openModal,
  closeModal,
  isPCBusyTurn,
  addLog,
  saveGame
} from './shared.js';

export function triggerTileFx(indices, cls) {
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

export function renderBoard() {
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

    const tilePts = Number(t.pts) > 0 ? Number(t.pts) : 0;
    const ptsBadge = tilePts ? `<span class="tpts">${tilePts}점</span>` : '';
    const label = t.owner >= 0 ? `${i + 1}번 ${S.teams[t.owner].name} 땅` : t.opened ? `${i + 1}번 빈 땅` : `${i + 1}번 문제${tilePts ? ` (${tilePts}점)` : ''}`;
    const inner = `<span class="tnum">${i + 1}</span>` + ptsBadge +
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

export function renderTeams() {
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
    b.innerHTML = '<span>🏁 게임이 끝났어요!</span><button type="button" class="pbtn sm gold" id="go-result">🏆 결과 다시 보기</button>';
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

export function render() {
  if (!app.S) return;
  renderBoard();
  renderTeams();
  renderTop();
  renderBanner();
  saveGame();
  if (app.liveRoom && actions.broadcastLiveState) actions.broadcastLiveState();
}

export function openQuickSettings() {
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
      <div class="opt-row"><label for="qs-listen">🎧 듣기 평가 모드</label><input type="checkbox" id="qs-listen"></div>
      <div class="opt-row"><label for="qs-bigscreen">🖥️ 전자칠판 대형 모드</label><input type="checkbox" id="qs-bigscreen"></div>
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
  $('#qs-listen').checked = !!st.listeningMode;
  $('#qs-bigscreen').checked = !!st.bigScreen;
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
    st.listeningMode = $('#qs-listen').checked;
    st.bigScreen = $('#qs-bigscreen').checked;
    st.autoNext = $('#qs-autonext').checked;
    st.reachHint = $('#qs-reach').checked;
    st.comboBonus = $('#qs-combo').checked;
    if ($('#qs-steal')) st.stealOnWrong = $('#qs-steal').checked;
    st.hint5050 = $('#qs-hint50').checked;
    st.reduceMotion = $('#qs-motion').checked;
    if ($('#qs-aifast')) st.aiFast = $('#qs-aifast').checked;
    Object.assign(app.setup.settings, {
      theme: st.theme, bgmStyle: st.bgmStyle, timer: st.timer,
      ttsAuto: st.ttsAuto, ttsRate: st.ttsRate, listeningMode: st.listeningMode,
      bigScreen: st.bigScreen, autoNext: st.autoNext, reachHint: st.reachHint,
      comboBonus: st.comboBonus, stealOnWrong: st.stealOnWrong,
      hint5050: st.hint5050, reduceMotion: st.reduceMotion, aiFast: st.aiFast
    });
    saveSetup();
    applyTheme(st.theme);
    applyMotion(st.reduceMotion);
    applyBigScreen(st.bigScreen);
    setBgmStyle(st.bgmStyle);
    render();
  };
  ['#qs-theme', '#qs-bgm', '#qs-timer', '#qs-ttsauto', '#qs-ttsrate', '#qs-listen', '#qs-bigscreen', '#qs-autonext', '#qs-reach', '#qs-combo', '#qs-steal', '#qs-hint50', '#qs-motion', '#qs-aifast'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', sync);
  });
  $('#m-close').onclick = closeModal;
}

export function openTeamManage(k) {
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
    if (S.teams[S.turn]?.isAI && actions.scheduleAITurn) actions.scheduleAITurn();
  };
  $('#m-close').onclick = closeModal;
}

export function initBoard() {
  actions.triggerTileFx = triggerTileFx;
  actions.render = render;
  actions.renderBoard = renderBoard;
  actions.renderTop = renderTop;
  actions.renderBanner = renderBanner;
  actions.renderBingoLines = renderBingoLines;
  actions.closeMoreMenu = closeMoreMenu;
  actions.toggleFullscreen = toggleFullscreen;
  actions.openQuickSettings = openQuickSettings;
  actions.openTeamManage = openTeamManage;
}
