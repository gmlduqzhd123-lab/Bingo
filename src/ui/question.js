import { matchShortAnswer, getSpeechSpec, makeChosungHint, formatRichText, isOXQuestion, normalizeOX } from '../core/questions.js';
import { shuffle, boardN, lineOwners, bingoCount } from '../core/engine.js';
import { store, recordWrongQuestion, resolveWrongQuestion } from '../utils/storage.js';
import { sfx, vibrate, speakText, isTtsSupported } from '../utils/audio.js';
import {
  $,
  esc,
  sleep,
  app,
  actions,
  toast,
  announce,
  confetti,
  scheduleAutoNext,
  stopTimer,
  startQuestionTimer,
  openModal,
  closeModal,
  teamTag,
  addLog,
  pushUndo,
  renderImgTag
} from './shared.js';

export function pickTile(i) {
  const S = app.S;
  if (app.busy || !S || S.over || $('#modal').classList.contains('show') || S.teams[S.turn]?.isAI) return;
  if (S.pending) { if (actions.handleTarget) actions.handleTarget(i); return; }
  const t = S.tiles[i];
  if (t.opened) { toast(t.owner >= 0 ? `이미 ${S.teams[t.owner].name}의 땅이에요` : '빈 땅은 🚩땅따먹기 카드로만 차지할 수 있어요'); return; }
  pushUndo();
  sfx('open');
  if (!t.q) { luckyTile(i); return; }
  openQuestion(i);
}

export async function luckyTile(i) {
  const sid = app.gameSession;
  await announce('🍀 행운 칸!', '문제 없이 이 칸을 차지해요', 'gold', 1600);
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  resolveCorrect(i, true);
}

export function checkBingoGoalWin() {
  const S = app.S;
  const goal = S && S.settings && +S.settings.bingoGoal;
  if (!goal || S.over) return false;
  const winners = S.teams.map((_, k) => k).filter(k => bingoCount(S, k) >= goal);
  if (!winners.length) return false;
  S.goalWinners = winners;
  if (actions.gameOver) actions.gameOver(`🎯 ${winners.map(k => S.teams[k].name).join('·')} 빙고 ${goal}줄 달성!`);
  return true;
}

export async function checkBingo() {
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
  if (actions.render) actions.render();
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

export async function endTurn() {
  const S = app.S;
  const sid = app.gameSession;
  S.pending = null;
  S.phase = null;
  if (app.liveRoom) app.liveRoom.tileVotes.clear();
  if (!S.tiles.some(t => !t.opened)) {
    if (actions.render) actions.render();
    await sleep(300);
    if (sid !== app.gameSession || !app.S || app.S.over) return;
    if (actions.gameOver) actions.gameOver('모든 칸이 열렸어요');
    return;
  }
  if (S.extra) {
    S.extra = false;
    if (actions.render) actions.render();
    toast(`⏩ ${S.teams[S.turn].name} 한 번 더!`);
    sfx('turn');
    app.aiFastTurn = false;
    if (!S.over && S.teams[S.turn]?.isAI && actions.scheduleAITurn) actions.scheduleAITurn();
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
        if (actions.render) actions.render();
        if (actions.gameOver) actions.gameOver(`${S.settings.roundLimit}라운드가 모두 끝났어요`);
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
  if (actions.render) actions.render();
  sfx('turn');
  app.aiFastTurn = false;
  if (!S.over && S.teams[S.turn]?.isAI && actions.scheduleAITurn) actions.scheduleAITurn();
}

export async function resolveCorrect(i, lucky = false) {
  const S = app.S;
  const sid = app.gameSession;
  const me = S.turn;
  const tile = S.tiles[i];
  const team = S.teams[me];
  tile.owner = me;
  tile.opened = true;
  S.lastTile = i;
  if (actions.triggerTileFx) actions.triggerTileFx([i], 'just-claimed');
  if (lucky) {
    team.stats.lucky++;
  } else {
    team.stats.correct++;
    team.combo = (team.combo || 0) + 1;
    team.stats.maxCombo = Math.max(team.stats.maxCombo || 0, team.combo);
    if (!team.isAI && tile.q) {
      const wr = resolveWrongQuestion(tile.q.q, S.setId === '__weak_bank__');
      if (wr.cleared) {
        S.weakCleared = (S.weakCleared || 0) + 1;
        toast('✨ 약점 문제를 정복했어요!');
      }
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
    const basePts = Number(tile.pts) > 0 ? Number(tile.pts) : S.settings.tilePts;
    team.bonus += basePts * (tile.golden ? 2 : 1);
    team.double = false;
    toast('✨ 2배 찬스 발동! 칸 점수를 한 번 더 받아요');
  }
  addLog(`${team.emoji} ${team.name}: ${i + 1}번 칸 ${lucky ? '행운 칸으로 차지' : '정답! 차지'}${tile.golden ? ' (⭐황금 칸)' : ''}`);
  if (actions.render) actions.render();
  if (tile.golden) {
    sfx('gold');
    await announce('⭐ 황금 칸!', `${i + 1}번 칸은 2칸만큼 점수가 돼요`, 'gold');
    if (sid !== app.gameSession || !app.S || app.S.over) return;
  }
  await checkBingo();
  if (sid !== app.gameSession || !app.S || app.S.over) return;
  if (checkBingoGoalWin()) return;
  if (S.settings.rewards && actions.showCards) actions.showCards();
  else endTurn();
}

export function resolveWrong(i, opts = null) {
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

export function openQuestion(i, stealOpts = null) {
  const S = app.S;
  const tile = S.tiles[i];
  const q = tile.q;
  const isSteal = !!(stealOpts && stealOpts.stealer != null);
  const actorIdx = isSteal ? stealOpts.stealer : S.turn;
  const origTurn = isSteal ? stealOpts.origTurn : S.turn;
  const team = S.teams[actorIdx];
  const isOX = isOXQuestion(q);
  const opts = isOX ? ['O', 'X'] : (q.opts ? shuffle([...q.opts]) : null);
  const isSolo = S.settings.playMode === 'solo';
  const isSoloSA = !isOX && !opts && isSolo && !team.isAI;
  const canHintMC = !!(!isOX && opts && opts.length >= 4 && S.settings.hint5050 && (team.hintsLeft || 0) > 0);
  const canHintSA = !!(!isOX && !opts && S.settings.hint5050 && (team.hintsLeft || 0) > 0 && makeChosungHint(q.a));
  const longCls = q.q.length > 65 ? ' long' : '';
  const isListening = !!(S.settings.listeningMode || q.listen);
  const speechSrc = q.listen && q.listen !== 'auto' ? q.listen : q.q;
  const speech = getSpeechSpec(speechSrc);
  const ttsBtn = isTtsSupported() ? '<button type="button" class="q-tts-btn" id="q-tts" title="문제 읽어주기">🔊 읽기</button>' : '';
  const imgHtml = renderImgTag(q.img, 'q-img', '문제 그림');
  const tilePts = Number(tile.pts) > 0 ? Number(tile.pts) : 0;

  if (app.liveRoom && actions.broadcastLiveQuestion) {
    actions.broadcastLiveQuestion({ qIndex: i, q: q.q, opts, isMc: !!opts, img: q.img || '' });
  }

  let bodyOptsHtml = '';
  if (isOX) {
    bodyOptsHtml = `<div class="q-ox-grid">
      <button type="button" class="q-ox-btn ox-o" data-ox="O">⭕<small>그렇다 (O) <kbd class="kh">O/1</kbd></small></button>
      <button type="button" class="q-ox-btn ox-x" data-ox="X">❌<small>아니다 (X) <kbd class="kh">X/2</kbd></small></button>
    </div>`;
  } else if (opts) {
    bodyOptsHtml = `<div class="q-opts">${opts.map((o, k) => `<button class="q-opt" data-k="${k}"><b>${'①②③④⑤⑥'[k]}</b>${formatRichText(o)}<kbd class="kh">${k + 1}</kbd></button>`).join('')}</div>`;
  } else {
    bodyOptsHtml = `${isSoloSA ? '<form class="q-sa-form" id="q-sa-form"><input type="text" id="q-sa-input" placeholder="정답을 입력하고 Enter" autocomplete="off"><button type="submit" class="pbtn gold" id="q-sa-submit">제출</button></form>' : ''}<div class="q-answer" id="q-answer">정답: <b>${formatRichText(q.a)}</b></div>`;
  }

  let stolen = false;
  const box = openModal(`
    <div class="q-head" style="--c:${team.color}">
      <span>${isSteal ? `⚡ 스틸 도전! ${teamTag(actorIdx)}` : `${teamTag(actorIdx)} 도전!`}</span>
      <div class="q-head-r">
        ${ttsBtn}
        <button type="button" class="q-fbtn" id="q-fdec" title="글자 작게">A-</button>
        <button type="button" class="q-fbtn" id="q-finc" title="글자 크게">A+</button>
        <span class="q-no">${i + 1}번${tilePts ? ` · ${tilePts}점` : ''}${tile.fails ? ` · ${tile.fails}실패` : ''}</span>
      </div>
    </div>
    ${S.settings.timer ? `<div class="q-timer-wrap">
      <div class="q-timer" id="q-timer"><div id="q-bar"></div><span id="q-sec">${S.settings.timer}초</span></div>
      <button type="button" class="pbtn sm white" id="q-pause" title="일시정지 (P)">⏸</button>
      <button type="button" class="pbtn sm white" id="q-plus10" title="10초 추가 (+)">+10초</button>
    </div>` : ''}
    ${imgHtml}
    ${isListening ? '<div class="q-listen-bar"><button type="button" class="pbtn sm blue" id="q-listen-play">🔊 음성 듣기</button><button type="button" class="pbtn sm white" id="q-listen-peek">👁️ 지문 보기</button></div>' : ''}
    <div class="q-text${longCls}${isListening ? ' listen-masked' : ''}" id="q-text-box">${formatRichText(q.q)}</div>
    <div id="q-hint-box" class="q-hint-box hidden"></div>
    ${bodyOptsHtml}
    ${q.explain ? `<div class="q-explain hidden" id="q-explain">💡 <b>해설:</b> ${formatRichText(q.explain)}</div>` : ''}
    <div id="live-resp-box" class="live-resp-box hidden"></div>
    <div class="q-msg" id="q-msg"></div>
    <div id="q-steal-wrap"></div>
    <div class="q-actions" id="q-actions">
      ${isOX || opts ? '' : (isSoloSA ? '<button class="pbtn white" id="q-reveal">👀 정답 확인 (직접 채점)</button>' : '<button class="pbtn gold" id="q-reveal">👀 정답 보기<kbd class="kh">Space</kbd></button><button class="pbtn ok" id="q-ok">⭕ 맞혔어요<kbd class="kh">O</kbd></button><button class="pbtn bad" id="q-no">❌ 틀렸어요<kbd class="kh">X</kbd></button>')}
      ${canHintMC ? `<button type="button" class="pbtn blue" id="q-hint">💡 50:50 찬스 (${team.hintsLeft})</button>` : ''}
      ${canHintSA ? `<button type="button" class="pbtn blue" id="q-sa-hint">💡 초성·철자 힌트 (${team.hintsLeft})</button>` : ''}
      ${isSteal ? '<button type="button" class="pbtn ghost" id="q-steal-skip">↩ 스틸 건너뛰기</button>' : (isSolo ? '' : '<button class="pbtn ghost" id="q-cancel">↩ 문제 닫기 (다른 칸 고르기)<kbd class="kh">Esc</kbd></button>')}
    </div>`, '', 'question', () => {
      if (!stolen && actions.broadcastLiveQuestionClosed) actions.broadcastLiveQuestionClosed();
    });

  box.style.setProperty('--qscale', app.qScale);
  if (actions.refreshLiveHostUI) actions.refreshLiveHostUI();
  if ($('#q-tts')) $('#q-tts').onclick = () => speakText(speech.text, speech.lang, S.settings.ttsRate || 1);
  if ($('#q-listen-play')) $('#q-listen-play').onclick = () => speakText(speech.text, speech.lang, S.settings.ttsRate || 1);
  if ($('#q-listen-peek')) {
    $('#q-listen-peek').onclick = () => {
      const tb = $('#q-text-box');
      if (!tb) return;
      tb.classList.toggle('revealed');
      $('#q-listen-peek').textContent = tb.classList.contains('revealed') ? '🙈 지문 가리기' : '👁️ 지문 보기';
    };
  }
  if ((S.settings.ttsAuto || isListening) && isTtsSupported()) {
    setTimeout(() => { if ($('#modal').classList.contains('show')) speakText(speech.text, speech.lang, S.settings.ttsRate || 1); }, 120);
  }
  $('#q-fdec').onclick = () => { app.qScale = Math.max(0.8, +(app.qScale - 0.1).toFixed(2)); box.style.setProperty('--qscale', app.qScale); store('bq_qscale', app.qScale); };
  $('#q-finc').onclick = () => { app.qScale = Math.min(1.35, +(app.qScale + 0.1).toFixed(2)); box.style.setProperty('--qscale', app.qScale); store('bq_qscale', app.qScale); };

  if ($('#live-resp-box')) {
    $('#live-resp-box').addEventListener('click', e => {
      const ab = e.target.closest('[data-live-apply-opt]');
      if (!ab) return;
      const ans = ab.dataset.liveApplyOpt;
      const oxTarget = normalizeOX(ans);
      if (isOX && oxTarget) {
        const b = box.querySelector(`.q-ox-btn[data-ox="${oxTarget}"]`);
        if (b && !b.disabled) b.click();
        return;
      }
      const matchBtn = [...box.querySelectorAll('.q-opt')].find(b => opts[+b.dataset.k] === ans);
      if (matchBtn && !matchBtn.disabled) matchBtn.click();
    });
  }

  let answered = false;
  let proceeded = false;
  const revealExplain = () => {
    const ex = $('#q-explain');
    if (ex) ex.classList.remove('hidden');
    const tb = $('#q-text-box');
    if (tb && tb.classList.contains('listen-masked')) tb.classList.add('revealed');
  };

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
    box.querySelectorAll('.q-opt,.q-ox-btn,#q-reveal,#q-ok,#q-no,#q-cancel,#q-steal-skip,#q-pause,#q-plus10,#q-sa-input,#q-sa-submit,#q-hint,#q-sa-hint').forEach(b => { b.disabled = true; });
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
    if (S.settings.autoNext && !q.explain && !canSteal) scheduleAutoNext(() => goNextNow(ok), delay);
  };

  if ($('#q-hint')) {
    $('#q-hint').onclick = () => {
      if (answered || (team.hintsLeft || 0) <= 0) return;
      const wrongBtns = [...box.querySelectorAll('.q-opt')].filter(b => opts[+b.dataset.k] !== q.a && !b.disabled);
      if (wrongBtns.length < 2) return;
      shuffle(wrongBtns).slice(0, 2).forEach(b => { b.disabled = true; b.classList.add('eliminated'); });
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

  const revealMC = () => {
    if (isOX) {
      const rightOx = normalizeOX(q.a);
      box.querySelectorAll('.q-ox-btn').forEach(b => { if (b.dataset.ox === rightOx) b.classList.add('right'); });
      return;
    }
    box.querySelectorAll('.q-opt').forEach(b => { if (opts[+b.dataset.k] === q.a) b.classList.add('right'); });
  };

  if (isOX) {
    const rightOx = normalizeOX(q.a);
    box.querySelectorAll('.q-ox-btn').forEach(b => b.onclick = () => {
      if (answered) return;
      const ok = b.dataset.ox === rightOx;
      b.classList.add(ok ? 'right' : 'wrong');
      if (ok) { sfx('correct'); vibrate(20); $('#q-msg').textContent = '⭕ 정답!'; }
      else { sfx('wrong'); vibrate([30, 40, 30]); $('#q-msg').textContent = '❌ 아쉬워요!'; if (S.settings.wrongMode === 'reveal') revealMC(); }
      finish(ok, ok ? 900 : 1500);
    });
  } else if (opts) {
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
        sfx('correct'); vibrate(20); $('#q-msg').textContent = '⭕ 정답!'; finish(true, 900);
      } else {
        answered = true; stopTimer(); sfx('wrong'); vibrate([30, 40, 30]);
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
      answered = true; stopTimer(); sfx('flip'); $('#q-answer').classList.add('show'); revealExplain();
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

  if ($('#q-cancel')) $('#q-cancel').onclick = () => { if (answered) return; stopTimer(); closeModal(); app.undoStack.pop(); if (actions.renderTop) actions.renderTop(); };
  if ($('#q-steal-skip')) $('#q-steal-skip').onclick = () => { if (answered) return; stopTimer(); closeModal(); S.turn = origTurn; endTurn(); };

  if (S.settings.timer) {
    let totalMs = S.settings.timer * 1000;
    let leftMs = totalMs;
    let paused = false;
    let lastTick = Date.now();
    let lastSec = Math.ceil(leftMs / 1000);
    const updateBar = () => {
      const bar = $('#q-bar'); const wrap = $('#q-timer'); const secEl = $('#q-sec');
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
        stopTimer(); sfx('wrong'); $('#q-msg').textContent = '⏰ 시간 종료!';
        if (isOX || opts) { if (S.settings.wrongMode === 'reveal') revealMC(); finish(false, 1600); }
        else if (isSoloSA) { $('#q-answer').classList.add('show'); finish(false, 1600); }
        else { $('#q-answer').classList.add('show'); revealExplain(); }
      }
    }, 100);
  }
}

export function initQuestion() {
  actions.pickTile = pickTile;
  actions.luckyTile = luckyTile;
  actions.openQuestion = openQuestion;
  actions.resolveCorrect = resolveCorrect;
  actions.resolveWrong = resolveWrong;
  actions.checkBingo = checkBingo;
  actions.checkBingoGoalWin = checkBingoGoalWin;
  actions.endTurn = endTurn;
}
