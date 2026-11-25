import { formatRichText, isSafeImageUrl, matchShortAnswer } from '../core/questions.js';
import { boardN, score } from '../core/engine.js';
import { makeQRSvg } from '../utils/qr.js';
import { createLiveChannel, normalizeRoomCode } from '../utils/realtime.js';
import { inlineIdbImagesInText } from '../utils/imageStore.js';
import { sfx } from '../utils/audio.js';
import { $, $$, esc, app, actions, show, toast, openModal, closeModal, isPCBusyTurn, saveSetup } from './shared.js';

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

function showReactionChip(alias, emoji) {
  const feed = $('#live-react-feed');
  if (!feed) return;
  const chip = document.createElement('div');
  chip.className = 'live-react-chip';
  chip.textContent = `${emoji} ${alias}`;
  feed.appendChild(chip);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => chip.remove(), 2400);
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
    turn: S.turn,
    playMode: S.settings.playMode,
    buzzerMode: !!S.settings.liveBuzzer,
    turnName: S.teams[S.turn]?.name || '',
    turnEmoji: S.teams[S.turn]?.emoji || '',
    tiles: S.tiles.map(t => ({ owner: t.owner, opened: t.opened })),
    teams: S.teams.map((t, k) => ({ name: t.name, emoji: t.emoji, color: t.color, score: score(S, k) }))
  });
}

export async function broadcastLiveQuestion(payload) {
  const liveRoom = app.liveRoom;
  if (!liveRoom) return;
  const out = { ...payload };
  if (out.img && out.img.startsWith('idb://')) {
    try { out.img = await inlineIdbImagesInText(out.img); } catch {}
  }
  liveRoom.qIndex = out.qIndex;
  liveRoom.currentQPayload = out;
  liveRoom.qAnswers.clear();
  liveRoom.buzzes = [];
  liveRoom.ch.send('question', out);
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
  liveRoom.buzzes = [];
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

function renderHostRosterHtml(room, S) {
  const list = [...room.students.values()];
  if (!list.length) return '<p class="hint" style="margin:6px 0">아직 입장한 학생이 없어요.</p>';
  return `<div class="set-list" style="max-height:140px;overflow:auto;margin-top:6px">${list.map(st => {
    const tm = st.teamIdx >= 0 && S?.teams[st.teamIdx] ? `${S.teams[st.teamIdx].emoji}${esc(S.teams[st.teamIdx].name)}` : '팀 미선택';
    return `<div class="item"><div class="nm">👤 ${esc(st.alias)} <span class="n">· ${tm}</span></div><button type="button" class="pbtn sm bad" data-kick="${esc(st.alias)}">내보내기</button></div>`;
  }).join('')}</div>`;
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
  if ($('#hl-roster') && liveRoom) $('#hl-roster').innerHTML = renderHostRosterHtml(liveRoom, S);

  const respBox = $('#live-resp-box');
  if (respBox && liveRoom && liveRoom.qIndex >= 0) {
    const total = liveRoom.qAnswers.size;
    const buzzHtml = liveRoom.buzzes && liveRoom.buzzes.length
      ? `<div class="live-buzz-box">🔔 선착순 버저: ${liveRoom.buzzes.slice(0, 3).map((b, idx) => `<span><b>${idx + 1}등</b> ${esc(b.teamLabel ? `${b.teamLabel} ` : '')}${esc(b.alias)}</span>`).join(' · ')}</div>`
      : '';
    respBox.classList.remove('hidden');
    const q = S?.tiles[liveRoom.qIndex]?.q;
    if (q && q.opts) {
      const counts = new Map();
      const turnCounts = new Map();
      for (const rec of liveRoom.qAnswers.values()) {
        counts.set(rec.answer, (counts.get(rec.answer) || 0) + 1);
        if (S && rec.teamIdx === S.turn) turnCounts.set(rec.answer, (turnCounts.get(rec.answer) || 0) + 1);
      }
      const turnTotal = [...turnCounts.values()].reduce((a, b) => a + b, 0);
      const topTurn = [...turnCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const turnTeam = S && S.teams[S.turn];
      respBox.innerHTML = `${buzzHtml}
        <b>📡 학생 실시간 응답 (${total}명${turnTotal && turnTeam ? ` · ${turnTeam.emoji} ${esc(turnTeam.name)} ${turnTotal}명` : ''})</b>
        <div class="live-resp-bar">${[...counts.entries()].map(([k, v]) => `<span class="live-resp-pill">${esc(k)}: ${v}명</span>`).join('') || '<span>응답을 기다리는 중...</span>'}
        ${topTurn ? `<button type="button" class="pbtn sm gold" data-live-apply-opt="${esc(topTurn[0])}">✅ ${esc(turnTeam?.name || '현재팀')} 1위 적용 (${esc(topTurn[0])})</button>` : ''}</div>`;
    } else {
      const list = [...liveRoom.qAnswers.entries()].slice(-5);
      respBox.innerHTML = `${buzzHtml}
        <b>📡 학생 실시간 답안 (${total}명)</b>
        <div class="live-resp-bar">${list.map(([stu, rec]) => `<span class="live-resp-pill">${esc(stu)}: ${esc(rec.answer)}</span>`).join('') || '<span>답안을 기다리는 중...</span>'}</div>`;
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
    students: new Map(),
    kicked: new Set(),
    tileVotes: new Map(),
    qAnswers: new Map(),
    buzzes: [],
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
      const who = String(pl.alias || '학생').slice(0, 16);
      if (room.kicked.has(who)) {
        room.ch.send('student_kicked', { alias: who });
        return;
      }
      if (ev === 'student_join') {
        const prev = room.students.get(who);
        const tIdx = pl.teamIdx != null ? Number(pl.teamIdx) : (prev ? prev.teamIdx : -1);
        room.students.set(who, { alias: who, teamIdx: tIdx, lastSeen: Date.now() });
        refreshLiveHostUI();
        broadcastLiveState();
        if (room.qIndex >= 0 && room.currentQPayload) room.ch.send('question', room.currentQPayload);
      } else if (ev === 'team_pick') {
        const st = room.students.get(who) || { alias: who, teamIdx: -1, lastSeen: Date.now() };
        st.teamIdx = Number(pl.teamIdx);
        st.lastSeen = Date.now();
        room.students.set(who, st);
        refreshLiveHostUI();
      } else if (ev === 'sync_req') {
        broadcastLiveState();
        if (room.qIndex >= 0 && room.currentQPayload) room.ch.send('question', room.currentQPayload);
      } else if (ev === 'tile_vote') {
        const idx = Number(pl.tile);
        if (Number.isInteger(idx) && idx >= 0 && idx < (S ? S.tiles.length : 25)) {
          if (!room.students.has(who)) room.students.set(who, { alias: who, teamIdx: Number(pl.teamIdx ?? -1), lastSeen: Date.now() });
          room.tileVotes.set(who, idx);
          if (S && $('#screen-game').classList.contains('active') && actions.renderBanner) actions.renderBanner();
        }
      } else if (ev === 'q_answer') {
        const st = room.students.get(who) || { alias: who, teamIdx: Number(pl.teamIdx ?? -1), lastSeen: Date.now() };
        if (pl.teamIdx != null) st.teamIdx = Number(pl.teamIdx);
        room.students.set(who, st);
        if (pl.qIndex === room.qIndex) {
          room.qAnswers.set(who, { answer: String(pl.answer || '').slice(0, 40), teamIdx: st.teamIdx });
          refreshLiveHostUI();
        }
      } else if (ev === 'buzzer') {
        if (pl.qIndex === room.qIndex && !room.buzzes.some(b => b.alias === who)) {
          const st = room.students.get(who);
          const tIdx = pl.teamIdx != null ? Number(pl.teamIdx) : (st ? st.teamIdx : -1);
          const tm = S && S.teams[tIdx];
          const teamLabel = tm ? `${tm.emoji} ${tm.name}` : '';
          room.buzzes.push({ alias: who, teamIdx: tIdx, teamLabel, at: Date.now() });
          if (room.buzzes.length === 1) sfx('hint');
          refreshLiveHostUI();
        }
      } else if (ev === 'reaction') {
        const emo = ['👏', '🔥', '😮', '🎉'].includes(pl.emoji) ? pl.emoji : '👏';
        showReactionChip(who, emo);
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
  const box = openModal(`
    <p class="m-title">📡 실시간 교실 방</p>
    <p class="m-desc">학생들이 팀 선택·칸 투표·문제 응답·선착순 버저·응원 리액션에 참여해요.</p>
    <div class="cloud-code-box">
      <div style="font-size:13px;font-weight:800">참여 중인 학생: <b id="hl-cnt">${liveRoom.students.size}</b>명 · 연결: <b id="hl-status">${statusBadgeText(liveRoom.status)}</b></div>
      <div class="cloud-code-val">${esc(liveRoom.code)}</div>
      <div style="font-size:13px">학생 화면에서 <b>📡 실시간 방</b>을 누르거나 아래 QR을 스캔하세요</div>
    </div>
    <div class="opt-row" style="margin-top:8px"><label for="hl-buzzer">🔔 선착순 버저 모드<small>학생 폰에 ‘도전 버저!’ 버튼을 띄워 빠른 순위를 매겨요</small></label><input type="checkbox" id="hl-buzzer" ${app.S.settings.liveBuzzer ? 'checked' : ''}></div>
    <div id="hl-roster">${renderHostRosterHtml(liveRoom, app.S)}</div>
    <div class="share-qr-box">${qrSvg || ''}</div>
    <div class="share-url-row">
      <input id="hl-url" readonly value="${esc(joinUrl)}">
      <button type="button" class="pbtn gold sm" id="hl-copy">📋 주소 복사</button>
    </div>
    <div class="m-actions">
      <button type="button" class="pbtn bad" id="hl-stop">방 닫기</button>
      <button type="button" class="pbtn gold" id="m-close">계속 진행</button>
    </div>`, 'narrow', 'info');
  $('#hl-buzzer').onchange = e => {
    app.S.settings.liveBuzzer = e.target.checked;
    app.setup.settings.liveBuzzer = e.target.checked;
    saveSetup();
    broadcastLiveState();
  };
  box.addEventListener('click', e => {
    const kb = e.target.closest('[data-kick]');
    if (!kb) return;
    const alias = kb.dataset.kick;
    liveRoom.kicked.add(alias);
    liveRoom.students.delete(alias);
    liveRoom.tileVotes.delete(alias);
    liveRoom.qAnswers.delete(alias);
    liveRoom.ch.send('student_kicked', { alias });
    refreshLiveHostUI();
    toast(`${alias} 학생을 내보냈어요`);
  });
  $('#hl-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl); toast('📋 참여 주소를 복사했어요!'); }
    catch { toast(`방 코드: ${liveRoom.code}`); }
  };
  $('#hl-stop').onclick = () => { closeHostLiveRoom(); closeModal(); toast('실시간 방을 닫았어요'); };
  $('#m-close').onclick = closeModal;
}

function liveResultBannerHtml(res) {
  if (!res) return '';
  if (!res.answered) return `<div class="live-res-banner info">📢 결과 공개: 정답은 <b>${esc(res.correctAnswer)}</b></div>`;
  return res.mineOk
    ? `<div class="live-res-banner ok">⭕ 정답! (정답: <b>${esc(res.correctAnswer)}</b>)</div>`
    : `<div class="live-res-banner bad">❌ 아쉬워요! 정답은 <b>${esc(res.correctAnswer)}</b></div>`;
}

function renderLiveStudentScreen() {
  const sl = app.studentLive;
  if (!sl) return;
  const stEl = $('#ls-status');
  const metaEl = $('#ls-meta');
  const teamBar = $('#ls-team-bar');
  const stageEl = $('#ls-stage');
  $('#ls-room-title').textContent = `📡 실시간 방 · ${sl.code}`;
  stEl.textContent = statusBadgeText(sl.status);
  stEl.className = 'live-status ' + (sl.status === 'connected' ? 'ok' : (sl.status === 'reconnecting' ? 'warn' : (sl.status === 'error' ? 'err' : '')));

  const scorePill = sl.total > 0 ? `<span class="ls-score-pill">⭕ ${sl.correct} / ${sl.total}</span>` : '';
  const rs = sl.state;
  if (!rs) {
    metaEl.innerHTML = `<span>참여자: ${esc(sl.alias)} · 교실 화면의 신호를 기다리는 중...</span>${scorePill}`;
    if (teamBar) teamBar.classList.add('hidden');
    stageEl.innerHTML = '<div class="hint" style="text-align:center;padding:24px">선생님 화면과 연결되면 이곳에 빙고판과 문제가 나타납니다.</div>';
    return;
  }
  metaEl.innerHTML = `<span>👤 ${esc(sl.alias)}</span><span>· ${rs.round}R · ${esc(rs.turnEmoji)} ${esc(rs.turnName)} 차례</span>${scorePill}`;

  if (teamBar) {
    if (rs.playMode !== 'solo' && Array.isArray(rs.teams) && rs.teams.length > 1) {
      teamBar.classList.remove('hidden');
      teamBar.innerHTML = '<span>내 팀:</span>' + rs.teams.map((t, k) => `<button type="button" class="ls-tbtn ${sl.teamIdx === k ? 'on' : ''}" data-lsteam="${k}" style="--c:${esc(t.color || '#2f7de1')}">${esc(t.emoji)} ${esc(t.name)}</button>`).join('');
      teamBar.querySelectorAll('[data-lsteam]').forEach(b => b.onclick = () => {
        sl.teamIdx = +b.dataset.lsteam;
        sl.ch.send('team_pick', { alias: sl.alias, teamIdx: sl.teamIdx });
        sfx('click');
        renderLiveStudentScreen();
      });
    } else {
      teamBar.classList.add('hidden');
    }
  }

  if (rs.over) {
    stageEl.innerHTML = `<div class="set-info" style="text-align:center">🏁 경기가 종료되었습니다!<br>${(rs.teams || []).map(t => `${t.emoji} ${esc(t.name)} <b>${t.score}점</b>`).join(' · ')}${sl.total > 0 ? `<br><br>나의 최종 기록: <b>${sl.correct} / ${sl.total}문제 정답</b>` : ''}</div>`;
    return;
  }

  const q = sl.question;
  if (q) {
    const qRes = sl.lastResult && sl.lastResult.qIndex === q.qIndex ? sl.lastResult : null;
    const imgHtml = q.img && isSafeImageUrl(q.img) ? `<img class="q-img" src="${esc(q.img)}" alt="문제 그림" onerror="this.style.display='none'">` : '';
    const buzzHtml = rs.buzzerMode
      ? `<button type="button" class="ls-buzz-btn" id="ls-buzz-btn" ${sl.buzzedQ === q.qIndex || qRes ? 'disabled' : ''}>${sl.buzzedQ === q.qIndex ? '🔔 버저 누름 완료!' : '🔔 선착순 도전 버저!'}</button>`
      : '';
    if (q.isMc && Array.isArray(q.opts)) {
      stageEl.innerHTML = `
        ${buzzHtml}
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
        sl.ch.send('q_answer', { alias: sl.alias, teamIdx: sl.teamIdx, qIndex: q.qIndex, answer: sl.pickedAns });
        sfx('click');
        renderLiveStudentScreen();
      });
    } else {
      stageEl.innerHTML = `
        ${buzzHtml}
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
        sl.ch.send('q_answer', { alias: sl.alias, teamIdx: sl.teamIdx, qIndex: q.qIndex, answer: val });
        sfx('click');
        renderLiveStudentScreen();
      };
    }
    if ($('#ls-buzz-btn')) {
      $('#ls-buzz-btn').onclick = () => {
        if (sl.buzzedQ === q.qIndex) return;
        sl.buzzedQ = q.qIndex;
        sl.ch.send('buzzer', { alias: sl.alias, teamIdx: sl.teamIdx, qIndex: q.qIndex });
        sfx('hint');
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
    sl.ch.send('tile_vote', { alias: sl.alias, teamIdx: sl.teamIdx, tile: idx });
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
    teamIdx: -1,
    status: 'connecting',
    state: null,
    question: null,
    votedTile: -1,
    pickedAns: '',
    buzzedQ: -1,
    correct: 0,
    total: 0,
    lastScoredQ: -1,
    lastResult: null,
    lastReactAt: 0,
    ch: null
  };
  sl.ch = createLiveChannel(code, {
    onStatus(st) {
      sl.status = st;
      renderLiveStudentScreen();
      if (st === 'connected') {
        sl.ch.send('student_join', { alias: sl.alias, teamIdx: sl.teamIdx });
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
        sl.lastResult = { qIndex: pl.qIndex, correctAnswer: pl.correctAnswer || '', answered, mineOk };
        renderLiveStudentScreen();
      } else if (ev === 'question_closed') {
        sl.question = null;
        sl.pickedAns = '';
        renderLiveStudentScreen();
      } else if (ev === 'student_kicked' && pl.alias === sl.alias) {
        toast('선생님에 의해 방에서 나갔습니다');
        leaveStudentLiveRoom();
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
  if ($('#ls-react-bar')) {
    $('#ls-react-bar').addEventListener('click', e => {
      const b = e.target.closest('[data-react]');
      const sl = app.studentLive;
      if (!b || !sl) return;
      const now = Date.now();
      if (now - (sl.lastReactAt || 0) < 1800) { toast('잠시 후 다시 눌러 주세요'); return; }
      sl.lastReactAt = now;
      sl.ch.send('reaction', { alias: sl.alias, emoji: b.dataset.react });
      sfx('click');
    });
  }
}
