import { REWARDS, COMMUNITY_STARTER_SETS } from '../data/sets.js';
import { parseQuestions, serializeQuestions, formatRichText, isSafeImageUrl } from '../core/questions.js';
import {
  savedSets,
  store,
  loadMyCloudCodes,
  loadHallOfFame,
  clearHallOfFame,
  loadWrongBank,
  removeWrongQuestion,
  clearWrongBank
} from '../utils/storage.js';
import { normalizeCode, fetchSharedSet, fetchClassAnalytics, fetchPublicLibrary } from '../utils/cloud.js';
import { sfx, ac } from '../utils/audio.js';
import { printQuestionSheet } from './print.js';
import {
  $,
  $$,
  esc,
  app,
  actions,
  show,
  toast,
  saveSetup,
  downloadCsv,
  openModal,
  closeModal,
  confirmModal,
  isPCBusyTurn
} from './shared.js';

export async function openSharedSetPrompt({ name, rawText, count, shareCode = null }) {
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
  if (wasInGame) { app.gameSession++; app.aiFocusTile = -1; }
  let skipResume = false;
  const resumePausedPC = () => {
    if (!skipResume && wasInGame && $('#screen-game').classList.contains('active') && app.S && !app.S.over && app.S.teams[app.S.turn]?.isAI && actions.scheduleAITurn) {
      actions.scheduleAITurn();
    }
  };
  openModal(`
    <p class="m-title">📦 공유된 문제 세트</p>
    <p class="m-desc" style="font-weight:800;margin-bottom:6px">“${esc(name)}”${shareCode ? ` <small>(${esc(shareCode)})</small>` : ''}</p>
    <p class="m-desc">총 <b>${parsed.length}문제</b>가 들어 있어요. 바로 풀어 볼까요?</p>
    ${shareCode ? `<div class="q-sa-form" style="margin:12px auto 4px"><input id="sh-alias" maxlength="12" value="${esc(app.setup.solo.name === '나' ? '' : app.setup.solo.name)}" placeholder="내 학번 또는 이름 (예: 5반 김철수)"></div>` : ''}
    <div class="m-actions">
      <button type="button" class="pbtn ok big" id="sh-solo">🤖 저장하고 1인 플레이 (vs PC)</button>
      <button type="button" class="pbtn gold" id="sh-save">💾 내 문제 세트에 저장</button>
      <button type="button" class="pbtn white" id="m-close">닫기</button>
    </div>`, 'narrow', 'info', resumePausedPC);
  $('#sh-solo').onclick = () => {
    skipResume = true;
    const aliasEl = $('#sh-alias');
    if (aliasEl && aliasEl.value.trim()) {
      app.setup.solo.name = aliasEl.value.trim().slice(0, 12);
    }
    const id = saveShared();
    closeModal();
    app.setup.settings.playMode = 'solo';
    app.setup.settings.setId = id;
    if (count <= 9) app.setup.settings.boardSize = 3;
    else if (count <= 16) app.setup.settings.boardSize = 4;
    saveSetup();
    if (actions.setAdvOpen) actions.setAdvOpen(false);
    if (actions.renderSetup) actions.renderSetup();
    show('setup');
    toast(`💾 “${name}” 저장 완료! 바로 시작해 보세요`);
  };
  $('#sh-save').onclick = () => {
    const id = saveShared();
    app.setup.settings.setId = id;
    saveSetup();
    closeModal();
    toast(`💾 “${name}” 세트를 저장했어요`);
    if ($('#screen-editor').classList.contains('active') && actions.renderSetList) actions.renderSetList();
    if ($('#screen-setup').classList.contains('active') && actions.renderSetup) actions.renderSetup();
  };
  $('#m-close').onclick = closeModal;
}

export function openCodeJoinModal() {
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

export async function openPublicLibraryModal() {
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

export function openHallOfFameModal() {
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

export function openAnalyticsLookupModal() {
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

export async function openAnalyticsModal(rawCode, title = '') {
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

export function openWeakBankModal() {
  let hideAns = false;
  const draw = () => {
    const list = loadWrongBank();
    const box = openModal(`
      <p class="m-title">🔥 누적 약점 오답 보관함 (${list.length})</p>
      <p class="m-desc">게임에서 틀렸던 문제가 누적돼요. 다시 맞히면 오답 횟수가 줄고 정복됩니다!</p>
      <div class="rev-top" style="justify-content:space-between">
        <span class="hint" style="margin:0">${list.length ? '틀린 횟수가 많은 문제부터 보여요' : '완벽해요!'}</span>
        ${list.length ? `<button type="button" class="pbtn sm white" id="wb-hide">${hideAns ? '👀 정답 보기' : '🙈 정답 가리기'}</button>` : ''}
      </div>
      <div class="rev-list" id="wb-list">${list.length ? list.map(it => `
        <div class="rev-item">
          <div class="rev-meta" style="justify-content:space-between">
            <span class="rev-badge">✖ ${it.misses || 1}회 틀림</span>
            <button type="button" class="pbtn sm white" data-wbdel="${esc(it.key)}" title="목록에서 빼기">✓ 정복</button>
          </div>
          ${it.img && isSafeImageUrl(it.img) ? `<img class="q-img" style="max-height:140px" src="${esc(it.img)}" alt="문제 그림" onerror="this.style.display='none'">` : ''}
          <div class="rev-q">${formatRichText(it.q)}</div>
          <div class="rev-a ${hideAns ? 'blur' : ''}">정답: ${formatRichText(it.a)}</div>
          ${it.explain ? `<div class="rev-ex">💡 ${formatRichText(it.explain)}</div>` : ''}
        </div>`).join('')
      : '<div class="hint" style="text-align:center;padding:24px">아직 누적된 오답이 없어요! 게임을 플레이하며 틀린 문제가 자동으로 이곳에 모입니다.</div>'}</div>
      <div class="m-actions">
        ${list.length ? `<button type="button" class="pbtn ok" id="wb-play">🎯 약점 문제로 바로 게임하기</button><button type="button" class="pbtn white" id="wb-print">🖨️ 약점 오답지 인쇄</button><button type="button" class="pbtn bad" id="wb-clear">🗑️ 비우기</button>` : ''}
        <button type="button" class="pbtn gold" id="m-close">닫기</button>
      </div>`, 'wide', 'info');

    if ($('#wb-hide')) $('#wb-hide').onclick = () => { hideAns = !hideAns; draw(); };
    box.querySelectorAll('[data-wbdel]').forEach(b => b.onclick = () => {
      removeWrongQuestion(b.dataset.wbdel);
      if (actions.refreshTitle) actions.refreshTitle();
      if (actions.renderSetup) actions.renderSetup();
      sfx('click');
      draw();
    });
    if ($('#wb-play')) {
      $('#wb-play').onclick = () => {
        const cur = loadWrongBank();
        if (!cur.length) return;
        closeModal();
        ac();
        const st = app.setup.settings;
        const sz = cur.length > 16 ? 5 : (cur.length <= 9 ? 3 : 4);
        actions.startGame({
          settings: { ...st, boardSize: sz, golden: Math.min(st.golden, 2), roundLimit: 0, bingoGoal: 0 },
          customQuestions: cur.map(x => ({ q: x.q, a: x.a, opts: x.opts ? [...x.opts] : null, explain: x.explain || '', img: x.img || '' })),
          setId: '__weak_bank__',
          setName: '🔥 내 약점 오답 복습'
        });
      };
    }
    if ($('#wb-print')) {
      $('#wb-print').onclick = () => {
        const cur = loadWrongBank();
        printQuestionSheet({
          title: '내 약점 오답 노트',
          subtitle: `누적 약점 ${cur.length}문제 집중 복습`,
          questions: cur,
          includeAnswers: true
        });
      };
    }
    if ($('#wb-clear')) {
      $('#wb-clear').onclick = async () => {
        if (!(await confirmModal({ title: '누적 약점 보관함을 비울까요?', okText: '비우기', danger: true }))) return;
        clearWrongBank();
        if (actions.refreshTitle) actions.refreshTitle();
        if (actions.renderSetup) actions.renderSetup();
        draw();
        toast('약점 보관함을 비웠어요');
      };
    }
    $('#m-close').onclick = closeModal;
  };
  draw();
}

export function howtoHTML() {
  const rw = REWARDS.map(r => `<div class="rw ${r.kind}"><span class="i">${r.icon}</span><div><b>${r.name}</b>${r.strong ? ' <small>(강력)</small>' : ''}<br>${r.id === 'mission' ? '팀이 함께 재미있는 미션을 해요.' : r.desc}</div></div>`).join('');
  return `<div class="howto">
    <h2>❓ 게임 방법</h2>
    <h4>1. 게임 시작 · 1인 플레이 & 2~6팀 대결 · 실시간 방</h4>
    <ul><li>처음 화면에서 <b>🤖 1인 플레이 (vs PC)</b>, <b>👥 팀 대결(최대 6팀)</b>, <b>📡 실시간 방 참여</b>, <b>🏛️ 공개 문제 창고</b>, <b>🔥 약점 오답 보관함</b>을 바로 열 수 있어요.</li>
    <li>팀 대결 중 상단의 <b>📡 실시간 방</b>을 열면 학생들이 스마트폰으로 칸 투표·답안 제출·즉시 정오답 피드백에 참여하고, <b>투표 1위 배지</b>를 눌러 칸을 바로 열 수 있어요.</li></ul>
    <h4>2. 점수 계산 · 스틸·콤보 · 힌트 · 읽어주기</h4>
    <ul><li><b>총점 = 칸 점수 × 칸 수 + 빙고 점수 × 빙고 줄 수 + 보너스 점수</b></li>
    <li><b>⚡ 오답 스틸 찬스</b>를 켜면 팀 대결에서 틀린 문제를 다른 팀이 바로 이어받아 도전할 수 있고, <b>🔥 3연속 콤보 보너스</b>로 3연속 이상 정답마다 +5점을 추가로 얻어요.</li>
    <li>객관식 <b>💡 50:50 찬스</b>, 주관식 <b>💡 초성·철자 힌트</b>, <b>🔊 읽어주기(자동/속도 조절)</b>와 <b>⚡ 역전 보정</b>을 지원해요.</li></ul>
    <h4>3. 보상 카드 (정답을 맞히면 1·2·3 카드 중 고르기)</h4>
    <div class="rw-grid">${rw}</div>
    <h4>4. 선생님용 편의 기능 · 공유 코드 · 인쇄 · 단축키</h4>
    <ul><li><b>🔗 코드·QR 공유</b>로 6자리 공유 코드·QR을 만들고, <b>📊 학급 복습 현황</b>에서 결과 조회 및 <b>CSV 다운로드</b>가 가능해요.</li>
    <li>편집기에서 <b>🧹 형식 자동 정리</b>, <b>그림 파일·Ctrl+V 붙여넣기</b>, <b>유형 일괄 변환·섞기·삭제</b>, <b>학생용/교사용/종이 빙고판 인쇄</b>를 지원해요.</li>
    <li>단축키: 객관식 <code>1~4</code> · 주관식 <code>Space</code>/<code>O</code>/<code>X</code> · 일시정지 <code>P</code> · +10초 <code>+</code> · 되돌리기 <code>Z</code> · 전체화면 <code>F</code></li></ul>
    <div class="m-actions"><button class="pbtn gold" id="m-close">닫기</button></div></div>`;
}

export function openHowto() {
  if ($('#screen-game').classList.contains('active') && isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  openModal(howtoHTML(), 'wide', 'info');
  $('#m-close').onclick = closeModal;
}

export function initModals() {
  actions.openSharedSetPrompt = openSharedSetPrompt;
  actions.openCodeJoinModal = openCodeJoinModal;
  actions.openPublicLibraryModal = openPublicLibraryModal;
  actions.openHallOfFameModal = openHallOfFameModal;
  actions.openAnalyticsLookupModal = openAnalyticsLookupModal;
  actions.openAnalyticsModal = openAnalyticsModal;
  actions.openWeakBankModal = openWeakBankModal;
  actions.openHowto = openHowto;
}
