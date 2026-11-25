import { AI_CONF, SOLO_MISSIONS, REWARDS, MISSIONS, TEAM_TARGET } from '../data/sets.js';
import { formatRichText, isOXQuestion, normalizeOX } from '../core/questions.js';
import { pick, shuffle, getLines, neighbors, boardN, lineOwners, score, validTargets, scoreTileForAI, chooseAITile, isCatchupEligible } from '../core/engine.js';
import { sfx, vibrate } from '../utils/audio.js';
import {
  $,
  esc,
  sleep,
  isReducedMotion,
  app,
  actions,
  toast,
  announce,
  shakeBoard,
  openModal,
  closeModal,
  isAISessionAlive,
  waitConfirmClear,
  skipAIWait,
  aiWait,
  saveGame,
  teamTag,
  addLog
} from './shared.js';

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
  if (i < 0) { actions.endTurn(); return; }
  await runAIQuestion(i, sid);
}

async function runAIQuestion(i, sid) {
  const S = app.S;
  app.aiFocusTile = i;
  sfx('open');
  if (actions.renderBoard) actions.renderBoard();
  await aiWait(380, 150);
  await waitConfirmClear(sid);
  app.aiFocusTile = -1;
  if (!isAISessionAlive(sid)) { if (actions.renderBoard) actions.renderBoard(); return; }
  const tile = S.tiles[i];
  const team = S.teams[S.turn];
  if (!tile.q) {
    await announce('🍀 행운 칸!', '🤖 PC가 문제 없이 이 칸을 차지해요', 'gold', S.settings.aiFast || isReducedMotion() ? 450 : 1100);
    if (!isAISessionAlive(sid)) return;
    await actions.resolveCorrect(i, true);
    return;
  }
  const q = tile.q;
  const isOX = isOXQuestion(q);
  const opts = isOX ? ['O', 'X'] : (q.opts ? shuffle([...q.opts]) : null);
  const longCls = q.q.length > 65 ? ' long' : '';
  const box = openModal(`
    <div class="q-head" style="--c:${team.color}">
      <span>🤖 PC 도전! (${(AI_CONF[team.aiLevel || 'normal'] || AI_CONF.normal).label})</span>
      <div class="q-head-r"><span class="q-no">${i + 1}번 문제${tile.fails ? ` · ${tile.fails}번 틀린 문제` : ''}</span></div>
    </div>
    <div class="q-text${longCls}">${formatRichText(q.q)}</div>
    ${opts ? `<div class="q-opts">${opts.map((o, k) => `<button class="q-opt" data-k="${k}" disabled><b>${isOX ? (o === 'O' ? '⭕' : '❌') : '①②③④⑤⑥'[k]}</b>${formatRichText(o)}</button>`).join('')}</div>`
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
    const targetAns = isOX ? normalizeOX(q.a) : q.a;
    const rightIdx = opts.findIndex(o => (isOX ? normalizeOX(o) : o) === targetAns);
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
  if (ok) await actions.resolveCorrect(i);
  else actions.resolveWrong(i);
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
    actions.triggerTileFx([chosen], 'just-claimed');
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
      actions.triggerTileFx([chosen], 'just-stolen');
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
      actions.render();
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
      actions.triggerTileFx([first, second], 'just-stolen');
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
    actions.render();
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

export function showCards() {
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
    actions.render();
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
    if (tileIdx >= 0) actions.triggerTileFx([tileIdx], 'shield-pop');
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
      if (validTargets(S, p).length) { S.pending = p; actions.render(); if (T.isAI) runAIPending(app.gameSession); return; }
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
        actions.render();
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

export async function finishAction() {
  const sid = app.gameSession;
  app.S.pending = null;
  actions.render();
  await actions.checkBingo();
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  if (actions.checkBingoGoalWin()) return;
  actions.endTurn();
}

export async function detonateBomb(i) {
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
  actions.render();
  sfx('bomb');
  vibrate([50, 30, 50]);
  shakeBoard();
  [i, ...neighbors(i, N)].forEach(k => { const el = $(`.tile[data-i="${k}"]`); if (el) el.classList.add('boom'); });
  addLog(`${T.name} 💣 ${i + 1}번 칸 폭탄 → ${n}칸 파괴`);
  await announce('💥 쾅!', n ? `다른 팀 칸 ${n}개가 빈 땅이 됐어요` : '방패에 막혔어요!', 'bad', 1500);
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  finishAction();
}

export async function handleTarget(i) {
  const S = app.S;
  const p = S.pending;
  if (!validTargets(S, p).includes(i)) {
    if (p.type === 'swap' && p.step === 2 && i === p.first) { p.step = 1; delete p.first; actions.render(); }
    return;
  }
  const me = S.turn;
  const T = S.teams[me];
  const tile = S.tiles[i];
  if (p.type === 'grab') {
    tile.owner = me;
    tile.opened = true;
    actions.triggerTileFx([i], 'just-claimed');
    sfx('grab');
    addLog(`${T.name} 🚩 ${i + 1}번 칸 땅따먹기`);
    if (tile.golden) toast('⭐ 황금 칸을 차지했어요!');
  } else if (p.type === 'steal') {
    const o = tile.owner;
    if (!blocked(o, i)) {
      tile.owner = me;
      T.stats.steals++;
      actions.triggerTileFx([i], 'just-stolen');
      sfx('steal');
      toast(`🗡️ ${S.teams[o].name}의 ${i + 1}번 칸을 빼앗았어요!`);
      addLog(`${T.name} 🗡️ ${S.teams[o].name}의 ${i + 1}번 칸 뺏기`);
    }
  } else if (p.type === 'swap') {
    if (p.step === 1) { p.step = 2; p.first = i; sfx('click'); actions.render(); return; }
    const o = tile.owner;
    if (!blocked(o, i)) {
      S.tiles[p.first].owner = o;
      tile.owner = me;
      T.stats.steals++;
      actions.triggerTileFx([p.first, i], 'just-stolen');
      sfx('steal');
      toast(`🔄 ${p.first + 1}번 ↔ ${i + 1}번 칸을 바꿨어요!`);
      addLog(`${T.name} 🔄 ${p.first + 1}번 ↔ ${S.teams[o].name}의 ${i + 1}번`);
    }
  } else if (p.type === 'bomb') {
    if (p.aim !== i) { p.aim = i; sfx('click'); actions.render(); return; }
    await detonateBomb(i);
    return;
  }
  finishAction();
}

export function pickTeam(r) {
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

export async function applyTeamEffect(r, k) {
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
      actions.render();
      await announce('🔀 점수 체인지!', `${teamTag(me)} ${sb}점 ↔ ${teamTag(k)} ${sa}점`, 'blue', 2000);
      if (sid !== app.gameSession || !app.S || app.S.over) return;
    }
  }
  finishAction();
}

export function initRewards() {
  actions.scheduleAITurn = scheduleAITurn;
  actions.showCards = showCards;
  actions.handleTarget = handleTarget;
  actions.pickTeam = pickTeam;
  actions.applyTeamEffect = applyTeamEffect;
  actions.detonateBomb = detonateBomb;
  actions.finishAction = finishAction;
}
