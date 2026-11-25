import { AI_CONF } from '../data/sets.js';
import { serializeQuestions, formatRichText } from '../core/questions.js';
import { boardN, tileCount, bingoCount, score, computeStanding, computeAwards, computeSetStars } from '../core/engine.js';
import { store, savedSets, getSet, loadSoloStats, recordSetMastery, recordLearningSession } from '../utils/storage.js';
import { sfx, ac } from '../utils/audio.js';
import { submitReviewResult } from '../utils/cloud.js';
import { exportResultCardPng } from '../utils/exportCard.js';
import { printQuestionSheet } from './print.js';
import { $, esc, app, actions, show, toast, announce, confetti, recordSoloResult, soloStatsHTML, openModal, closeModal, saveGame, renderImgTag } from './shared.js';

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

export async function gameOver(reason) {
  const S = app.S;
  app.gameSession++;
  const sid = app.gameSession;
  app.aiFocusTile = -1;
  app.aiFastTurn = false;
  S.over = true;
  S.pending = null;
  S.phase = null;
  closeModal();

  if (!S.learnRecorded) {
    S.learnRecorded = true;
    const setObj = S.setId && S.setId !== '__weak_bank__' ? getSet(S.setId) : null;
    const subj = (setObj && setObj.subject) || (S.setId === '__weak_bank__' ? '오답복습' : '일반');
    const humans = S.teams.filter(t => !t.isAI);
    const cSum = humans.reduce((s, t) => s + (t.stats?.correct || 0), 0);
    const wSum = humans.reduce((s, t) => s + (t.stats?.wrong || 0), 0);
    const mBingo = humans.reduce((m, t) => Math.max(m, t.stats?.maxBingo || 0), 0);
    recordLearningSession({ subject: subj, correct: cSum, wrong: wSum, maxBingo: mBingo, weakCleared: S.weakCleared || 0 });
  }

  if (S.settings.playMode === 'solo' && !S.statRecorded) {
    S.statRecorded = true;
    const sr = recordSoloResult();
    S.lastNewlyCleared = sr.newlyCleared;
    const { rank } = computeStanding(S);
    const st = S.teams[0].stats || {};
    const stars = computeSetStars(rank(0) < rank(1), st.correct || 0, st.wrong || 0);
    if (stars > 0 && S.setId) recordSetMastery(S.setId, stars, score(S, 0));
  }
  if (actions.render) actions.render();
  sfx('fanfare');
  await announce('🏁 게임 끝!', reason, '', 2000);
  if (sid !== app.gameSession) return;
  showResult();
  submitSoloCloudIfNeeded();
}

export function showResult() {
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

export function openReviewModal() {
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
        ${renderImgTag(t.q.img, 'q-img', '문제 그림', 'max-height:150px')}
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
      actions.startGame({
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

export function initResult() {
  actions.gameOver = gameOver;
  actions.showResult = showResult;
  actions.openReviewModal = openReviewModal;

  if ($('#r-export-png')) {
    $('#r-export-png').onclick = () => {
      const S = app.S;
      if (!S) return;
      const { scores, order, rank } = computeStanding(S);
      const awards = computeAwards(S, order, scores, rank);
      const standings = order.map(k => ({
        name: S.teams[k].name,
        emoji: S.teams[k].emoji,
        color: S.teams[k].color,
        rank: rank(k),
        score: scores[k],
        tiles: tileCount(S, k),
        bingos: bingoCount(S, k),
        award: awards[k]
      }));
      exportResultCardPng({
        setName: S.setName,
        boardSize: boardN(S),
        headline: $('#res-headline').textContent,
        theme: S.settings.theme,
        standings
      });
      sfx('coin');
      toast('🖼️ 결과 카드 이미지를 저장했어요!');
    };
  }
}
