import { formatRichText, isSafeImageUrl, matchShortAnswer } from '../core/questions.js';
import { boardN, score } from '../core/engine.js';
import { makeQRSvg } from '../utils/qr.js';
import { createLiveChannel, normalizeRoomCode } from '../utils/realtime.js';
import { sfx } from '../utils/audio.js';
import { $, esc, app, actions, show, toast, openModal, closeModal, isPCBusyTurn } from './shared.js';

function genRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function statusBadgeText(st) {
  if (st === 'connected') return '🟢 연결됨';
  if (st === 'reconnecting') return '🟠 재연결 중...';
  if (st === 'error') return '🔴 연결 오류';
  return '🟡 연결 중';
}

export function broadcastLiveState() {
  const liveRoom = app.liveRoom;
  const S = app.S;
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

export function broadcastLiveQuestion(payload) {
  const liveRoom = app.liveRoom;
  if (!liveRoom) return;
  liveRoom.qIndex = payload.qIndex;
  liveRoom.currentQPayload = payload;
  liveRoom.qAnswers.clear();
  liveRoom.ch.send('question', payload);
}

export function broadcastLiveQuestionResult(payload) {
  const liveRoom = app.liveRoom;
  if (!liveRoom) return;
  liveRoom.ch.send('question_result', payload);
}

export function broadcastLiveQuestionClosed() {
  const liveRoom = app.liveRoom;
  if (!liveRoom) return;
  liveRoom.qIndex = -1;
  liveRoom.currentQPayload = null;
  liveRoom.ch.send('question_closed', {});
}

export function getTopTileVote() {
  const liveRoom = app.liveRoom;
  const S = app.S;
  if (!liveRoom || !liveRoom.tileVotes.size || !S) return null;
  const counts = new Map();
  for (const idx of liveRoom.tileVotes.values()) {
    if (S.tiles[idx] && !S.tiles[idx].opened) counts.set(idx, (counts.get(idx) || 0) + 1);
  }
  if (!counts.size) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { idx: best[0], count: best[1] };
}

export function refreshLiveHostUI() {
  const liveRoom = app.liveRoom;
  const S = app.S;
  const btn = $('#g-live');
  if (btn) {
    btn.classList.toggle('live-on', !!liveRoom);
    btn.textContent = liveRoom ? `📡 방 ${liveRoom.code} (${liveRoom.students.size})` : '📡 실시간 방';
  }
  if ($('#hl-cnt') && liveRoom) $('#hl-cnt').textContent = String(liveRoom.students.size);
  if ($('#hl-status') && liveRoom) $('#hl-status').textContent = statusBadgeText(liveRoom.status);

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

export function closeHostLiveRoom() {
  if (!app.liveRoom) return;
  try { app.liveRoom.ch.send('room_closed', {}); } catch {}
  app.liveRoom.ch.close();
  app.liveRoom = null;
  refreshLiveHostUI();
  if (app.S && actions.renderBanner) actions.renderBanner();
}

function startHostLiveRoom() {
  if (app.liveRoom) return;
  const code = genRoomCode();
  const room = {
    code,
    students: new Set(),
    tileVotes: new Map(),
    qAnswers: new Map(),
    qIndex: -1,
    currentQPayload: null,
    status: 'connecting',
    ch: null
  };
  room.ch = createLiveChannel(code, {
    onStatus(st) {
      room.status = st;
      refreshLiveHostUI();
      if (st === 'connected') {
        broadcastLiveState();
        if (room.qIndex >= 0 && room.currentQPayload) room.ch.send('question', room.currentQPayload);
      }
    },
    onMessage(ev, pl) {
      const S = app.S;
      if (ev === 'student_join') {
        const who = String(pl.alias || '학생').slice(0, 16);
        room.students.add(who);
        refreshLiveHostUI();
        broadcastLiveState();
        if (room.qIndex >= 0 && room.currentQPayload) room.ch.send('question', room.currentQPayload);
      } else if (ev === 'sync_req') {
        broadcastLiveState();
        if (room.qIndex >= 0 && room.currentQPayload) room.ch.send('question', room.currentQPayload);
      } else if (ev === 'tile_vote') {
        const who = String(pl.alias || '학생').slice(0, 16);
        const idx = Number(pl.tile);
        if (Number.isInteger(idx) && idx >= 0 && idx < (S ? S.tiles.length : 25)) {
          room.students.add(who);
          room.tileVotes.set(who, idx);
          if (S && $('#screen-game').classList.contains('active') && actions.renderBanner) actions.renderBanner();
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
  app.liveRoom = room;
  refreshLiveHostUI();
}

export function openHostLiveModal() {
  if (!app.S) return;
  if (isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  if (!app.liveRoom) startHostLiveRoom();
  const liveRoom = app.liveRoom;
  const baseUrl = location.href.split('#')[0].split('?')[0];
  const joinUrl = `${baseUrl}?room=${liveRoom.code}`;
  const qrSvg = makeQRSvg(joinUrl);
  openModal(`
    <p class="m-title">📡 실시간 교실 방</p>
    <p class="m-desc">학생들이 휴대폰·태블릿에서 칸 투표와 문제 응답에 바로 참여해요.</p>
    <div class="cloud-code-box">
      <div style="font-size:13px;font-weight:800">참여 중인 학생: <b id="hl-cnt">${liveRoom.students.size}</b>명 · 연결: <b id="hl-status">${statusBadgeText(liveRoom.status)}</b></div>
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

function liveResultBannerHtml(res) {
  if (!res) return '';
  if (!res.answered) {
    return `<div class="live-res-banner info">📢 결과 공개: 정답은 <b>${esc(res.correctAnswer)}</b></div>`;
  }
  return res.mineOk
    ? `<div class="live-res-banner ok">⭕ 정답! (정답: <b>${esc(res.correctAnswer)}</b>)</div>`
    : `<div class="live-res-banner bad">❌ 아쉬워요! 정답은 <b>${esc(res.correctAnswer)}</b></div>`;
}

function renderLiveStudentScreen() {
  const sl = app.studentLive;
  if (!sl) return;
  const stEl = $('#ls-status');
  const metaEl = $('#ls-meta');
  const stageEl = $('#ls-stage');
  $('#ls-room-title').textContent = `📡 실시간 방 · ${sl.code}`;
  stEl.textContent = statusBadgeText(sl.status);
  stEl.className = 'live-status ' + (sl.status === 'connected' ? 'ok' : (sl.status === 'reconnecting' ? 'warn' : (sl.status === 'error' ? 'err' : '')));

  const scorePill = sl.total > 0 ? `<span class="ls-score-pill">⭕ ${sl.correct} / ${sl.total}</span>` : '';
  const rs = sl.state;
  if (!rs) {
    metaEl.innerHTML = `<span>참여자: ${esc(sl.alias)} · 교실 화면의 신호를 기다리는 중...</span>${scorePill}`;
    stageEl.innerHTML = '<div class="hint" style="text-align:center;padding:24px">선생님 화면과 연결되면 이곳에 빙고판과 문제가 나타납니다.</div>';
    return;
  }
  metaEl.innerHTML = `<span>👤 ${esc(sl.alias)}</span><span>· ${rs.round}R · ${esc(rs.turnEmoji)} ${esc(rs.turnName)} 차례</span>${scorePill}`;

  if (rs.over) {
    stageEl.innerHTML = `<div class="set-info" style="text-align:center">🏁 경기가 종료되었습니다!<br>${(rs.teams || []).map(t => `${t.emoji} ${esc(t.name)} <b>${t.score}점</b>`).join(' · ')}${sl.total > 0 ? `<br><br>나의 최종 기록: <b>${sl.correct} / ${sl.total}문제 정답</b>` : ''}</div>`;
    return;
  }

  const q = sl.question;
  if (q) {
    const qRes = sl.lastResult && sl.lastResult.qIndex === q.qIndex ? sl.lastResult : null;
    const imgHtml = q.img && isSafeImageUrl(q.img) ? `<img class="q-img" src="${esc(q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';
    if (q.isMc && Array.isArray(q.opts)) {
      stageEl.innerHTML = `
        ${imgHtml}
        <div class="q-text" style="font-size:20px;padding:8px 4px 12px">${formatRichText(q.q)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${q.opts.map((o, k) => {
            let cls = sl.pickedAns === o ? 'picked' : '';
            if (qRes) {
              if (o === qRes.correctAnswer) cls += ' right';
              else if (sl.pickedAns === o) cls += ' wrong';
            }
            return `<button type="button" class="live-opt-btn ${cls}" data-lopt="${esc(o)}" ${qRes ? 'disabled' : ''}><b>${'①②③④⑤⑥'[k]}</b> ${formatRichText(o)}</button>`;
          }).join('')}
        </div>
        ${qRes ? liveResultBannerHtml(qRes)
          : `<p class="hint" style="text-align:center">${sl.pickedAns ? `✅ “${esc(sl.pickedAns)}” 전송 완료!` : '정답이라고 생각하는 보기를 눌러 보세요'}</p>`}`;
      stageEl.querySelectorAll('[data-lopt]').forEach(b => b.onclick = () => {
        if (qRes) return;
        sl.pickedAns = b.dataset.lopt;
        sl.ch.send('q_answer', { alias: sl.alias, qIndex: q.qIndex, answer: sl.pickedAns });
        sfx('click');
        renderLiveStudentScreen();
      });
    } else {
      stageEl.innerHTML = `
        ${imgHtml}
        <div class="q-text" style="font-size:20px;padding:8px 4px 12px">${formatRichText(q.q)}</div>
        <form id="ls-sa-form" class="q-sa-form">
          <input id="ls-sa-inp" placeholder="정답 입력" value="${esc(sl.pickedAns || '')}" autocomplete="off" ${qRes ? 'disabled' : ''}>
          <button type="submit" class="pbtn gold" ${qRes ? 'disabled' : ''}>전송</button>
        </form>
        ${qRes ? liveResultBannerHtml(qRes)
          : `<p class="hint" style="text-align:center">${sl.pickedAns ? `✅ “${esc(sl.pickedAns)}” 전송 완료!` : '답안을 입력해 선생님 화면으로 보낼 수 있어요'}</p>`}`;
      $('#ls-sa-form').onsubmit = e => {
        e.preventDefault();
        if (qRes) return;
        const val = $('#ls-sa-inp').value.trim();
        if (!val) return;
        sl.pickedAns = val;
        sl.ch.send('q_answer', { alias: sl.alias, qIndex: q.qIndex, answer: val });
        sfx('click');
        renderLiveStudentScreen();
      };
    }
    return;
  }

  const N = rs.size || 5;
  stageEl.innerHTML = `
    ${sl.lastResult ? liveResultBannerHtml(sl.lastResult) : ''}
    <p class="hint" style="text-align:center;margin:4px 0 8px">열리지 않은 번호 칸을 눌러 다음 도전 칸에 투표하세요!</p>
    <div class="live-grid" style="--ln:${N}">
      ${(rs.tiles || []).map((t, i) => `<button type="button" class="live-tile-btn ${t.opened ? 'opened' : ''} ${sl.votedTile === i ? 'voted' : ''}" data-ltile="${i}" ${t.opened ? 'disabled' : ''}>${t.opened ? (t.owner >= 0 && rs.teams[t.owner] ? rs.teams[t.owner].emoji : '·') : (i + 1)}</button>`).join('')}
    </div>`;
  stageEl.querySelectorAll('[data-ltile]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.ltile;
    sl.votedTile = idx;
    sl.ch.send('tile_vote', { alias: sl.alias, tile: idx });
    sfx('click');
    renderLiveStudentScreen();
    toast(`📡 ${idx + 1}번 칸에 투표했어요!`);
  });
}

function leaveStudentLiveRoom() {
  if (app.studentLive) {
    app.studentLive.ch.close();
    app.studentLive = null;
  }
  show('title');
}

function joinStudentLiveRoom(code, alias) {
  if (app.studentLive) app.studentLive.ch.close();
  const cleanAlias = (alias || '학생').trim().slice(0, 12) || '학생';
  const sl = {
    code,
    alias: cleanAlias,
    status: 'connecting',
    state: null,
    question: null,
    votedTile: -1,
    pickedAns: '',
    correct: 0,
    total: 0,
    lastScoredQ: -1,
    lastResult: null,
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
        sl.lastResult = null;
        renderLiveStudentScreen();
      } else if (ev === 'question_result') {
        const answered = !!(sl.pickedAns && String(sl.pickedAns).trim());
        let mineOk = false;
        if (answered) {
          mineOk = sl.question?.isMc
            ? sl.pickedAns === pl.correctAnswer
            : matchShortAnswer(sl.pickedAns, pl.correctAnswer, sl.question?.q || '');
          if (sl.lastScoredQ !== pl.qIndex) {
            sl.lastScoredQ = pl.qIndex;
            sl.total++;
            if (mineOk) sl.correct++;
          }
        }
        sl.lastResult = {
          qIndex: pl.qIndex,
          correctAnswer: pl.correctAnswer || '',
          answered,
          mineOk
        };
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
  app.studentLive = sl;
  show('live-student');
  renderLiveStudentScreen();
}

export function openLiveJoinModal() {
  openModal(`
    <p class="m-title">📡 실시간 교실 방 참여</p>
    <p class="m-desc">선생님 화면에 표시된 6자리 방 코드와 내 이름을 입력하세요.</p>
    <form id="lj-form" class="tm-grid" style="margin-top:12px">
      <input id="lj-code" class="ed-field" maxlength="8" placeholder="6자리 방 코드 (예: K4M8P2)" style="text-align:center;text-transform:uppercase;letter-spacing:4px">
      <input id="lj-alias" class="ed-field" maxlength="12" value="${esc(app.setup.solo.name === '나' ? '' : app.setup.solo.name)}" placeholder="내 이름 또는 학번">
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

export function initLive() {
  actions.openHostLiveModal = openHostLiveModal;
  actions.closeHostLiveRoom = closeHostLiveRoom;
  actions.openLiveJoinModal = openLiveJoinModal;
  actions.broadcastLiveState = broadcastLiveState;
  actions.broadcastLiveQuestion = broadcastLiveQuestion;
  actions.broadcastLiveQuestionResult = broadcastLiveQuestionResult;
  actions.broadcastLiveQuestionClosed = broadcastLiveQuestionClosed;
  actions.refreshLiveHostUI = refreshLiveHostUI;
  actions.getTopTileVote = getTopTileVote;
  $('#ls-exit').onclick = leaveStudentLiveRoom;
}
