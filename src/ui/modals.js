import { REWARDS, COMMUNITY_STARTER_SETS } from '../data/sets.js';
import { parseQuestions, serializeQuestions, formatRichText } from '../core/questions.js';
import {
  savedSets,
  store,
  loadMyCloudCodes,
  loadHallOfFame,
  clearHallOfFame,
  loadWrongBank,
  removeWrongQuestion,
  clearWrongBank,
  isWeakDue,
  loadSoloStats,
  loadLearningLog,
  computeStudyStreak,
  computeAchievements,
  loadLibLiked,
  toggleLibLiked,
  loadLibReported,
  markLibReported
} from '../utils/storage.js';
import {
  normalizeCode,
  fetchSharedSet,
  fetchClassAnalytics,
  fetchPublicLibrary,
  interactPublicLibrary,
  deletePublicLibraryItem
} from '../utils/cloud.js';
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
  isPCBusyTurn,
  renderImgTag
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
    if (aliasEl && aliasEl.value.trim()) app.setup.solo.name = aliasEl.value.trim().slice(0, 12);
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
    const code = normalizeCode($('#code-join-input').value);
    const msgEl = $('#code-join-msg');
    if (!code) { msgEl.textContent = '⚠️ 영문·숫자 6자리 코드를 정확히 입력해 주세요.'; return; }
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
  let sortBy = 'recent';
  let qText = '';
  let merged = [...COMMUNITY_STARTER_SETS];
  openModal(`
    <p class="m-title">🏛️ 공개 문제 창고</p>
    <p class="m-desc">수업에 바로 쓸 수 있는 추천·공유 세트를 골라 보세요.</p>
    <div class="set-picker-bar" style="margin-top:12px">
      <input type="search" class="set-search" id="lib-search" placeholder="🔍 단원·과목·작성자 검색">
      <div class="lib-sort-row">
        <div class="set-filter-chips" id="lib-filters"></div>
        <div class="ed-tabs" style="margin:0" id="lib-sorts">
          <button type="button" class="on" data-lsort="recent">🆕 최신순</button>
          <button type="button" data-lsort="popular">❤️ 추천순</button>
          <button type="button" data-lsort="downloads">📥 인기순</button>
        </div>
      </div>
    </div>
    <div class="lib-grid" id="lib-grid"></div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'wide', 'info');
  $('#m-close').onclick = closeModal;

  const subjects = ['all', '상식', '과학', '수학', '사회', '국어', '영어', '정보', '안전', '기타'];
  const drawLib = () => {
    const fEl = $('#lib-filters');
    const gEl = $('#lib-grid');
    if (!fEl || !gEl) return;
    fEl.innerHTML = subjects.map(s => `<button type="button" class="set-filter-btn ${subjFilter === s ? 'on' : ''}" data-lsubj="${s}">${s === 'all' ? '전체' : s}</button>`).join('');
    $$('#lib-sorts [data-lsort]').forEach(b => b.classList.toggle('on', b.dataset.lsort === sortBy));
    const q = qText.trim().toLowerCase();
    const liked = new Set(loadLibLiked());
    const reported = new Set(loadLibReported());
    let list = merged.filter(it => {
      if (reported.has(it.id)) return false;
      if (subjFilter !== 'all' && it.subject !== subjFilter) return false;
      if (q && !`${it.title} ${it.subject} ${it.grade} ${it.author_alias}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortBy === 'popular') list = [...list].sort((a, b) => (Number(b.likes_count) || 0) - (Number(a.likes_count) || 0));
    else if (sortBy === 'downloads') list = [...list].sort((a, b) => (Number(b.downloads_count) || 0) - (Number(a.downloads_count) || 0));
    gEl.innerHTML = list.length ? list.map((it, idx) => {
      const isCloud = !String(it.id || '').startsWith('lib_');
      const likeCnt = (Number(it.likes_count) || 0) + (liked.has(it.id) && !isCloud ? 1 : 0);
      const dlCnt = Number(it.downloads_count) || 0;
      return `
      <div class="lib-card">
        <div class="lib-card-title">${esc(it.title)}</div>
        <div class="lib-card-meta">${esc(it.subject)} · ${esc(it.grade)} · ${it.question_count}문제 · ${esc(it.author_alias)}${dlCnt ? ` · 📥 ${dlCnt}` : ''}</div>
        <div class="lib-card-foot">
          <button type="button" class="pbtn sm gold" data-libpick="${idx}">📥 가져오기</button>
          <button type="button" class="lib-act-btn ${liked.has(it.id) ? 'on' : ''}" data-liblike="${esc(it.id)}" title="추천">❤️ ${likeCnt}</button>
          ${isCloud ? `<button type="button" class="lib-act-btn" data-libreport="${esc(it.id)}" title="신고">🚩</button><button type="button" class="lib-act-btn" data-libdel="${esc(it.id)}" title="PIN으로 삭제">🗑️</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="hint" style="grid-column:1/-1;text-align:center;padding:18px">조건에 맞는 세트가 없어요.</div>';
    gEl._list = list;
  };
  $('#lib-search').addEventListener('input', e => { qText = e.target.value; drawLib(); });
  $('#lib-sorts').addEventListener('click', e => {
    const b = e.target.closest('[data-lsort]');
    if (!b) return;
    sortBy = b.dataset.lsort;
    drawLib();
  });
  $('#lib-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-lsubj]');
    if (!b) return;
    subjFilter = b.dataset.lsubj;
    drawLib();
  });
  $('#lib-grid').addEventListener('click', async e => {
    const likeBtn = e.target.closest('[data-liblike]');
    if (likeBtn) {
      const id = likeBtn.dataset.liblike;
      const res = toggleLibLiked(id);
      sfx('click');
      if (res.liked && !id.startsWith('lib_')) {
        interactPublicLibrary(id, 'like');
        const it = merged.find(x => x.id === id);
        if (it) it.likes_count = (Number(it.likes_count) || 0) + 1;
      }
      drawLib();
      return;
    }
    const repBtn = e.target.closest('[data-libreport]');
    if (repBtn) {
      const id = repBtn.dataset.libreport;
      if (!(await confirmModal({ title: '이 세트를 신고할까요?', desc: '부적절한 내용이 포함된 경우 내 목록에서 숨기고 신고를 전송합니다.', okText: '신고', danger: true }))) return;
      markLibReported(id);
      interactPublicLibrary(id, 'report');
      toast('🚩 신고를 접수하고 목록에서 숨겼어요');
      drawLib();
      return;
    }
    const delBtn = e.target.closest('[data-libdel]');
    if (delBtn) {
      const id = delBtn.dataset.libdel;
      const pin = window.prompt('등록 시 설정한 삭제 비밀번호(PIN)를 입력하세요:');
      if (!pin) return;
      const ok = await deletePublicLibraryItem(id, pin.trim());
      if (ok) {
        merged = merged.filter(x => x.id !== id);
        drawLib();
        toast('🗑️ 공개 창고에서 삭제했어요');
      } else {
        toast('⚠️ 비밀번호가 다르거나 삭제 권한이 없어요');
      }
      return;
    }
    const b = e.target.closest('[data-libpick]');
    if (!b) return;
    const gEl = $('#lib-grid');
    const item = gEl && gEl._list ? gEl._list[+b.dataset.libpick] : null;
    if (!item) return;
    if (!String(item.id || '').startsWith('lib_')) interactPublicLibrary(item.id, 'download');
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
    const now = Date.now();
    const list = loadWrongBank().slice().sort((a, b) => (isWeakDue(b, now) - isWeakDue(a, now)) || ((b.misses || 1) - (a.misses || 1)));
    const dueCount = list.filter(x => isWeakDue(x, now)).length;
    const box = openModal(`
      <p class="m-title">🔥 누적 약점 오답 보관함 (${list.length})</p>
      <p class="m-desc">지금 복습할 문제 <b>${dueCount}개</b> · 맞히면 복습 간격(1일→3일→7일)이 늘어나고 정복돼요!</p>
      <div class="rev-top" style="justify-content:space-between">
        <span class="hint" style="margin:0">${list.length ? '복습 시기가 온 문제부터 위에 보여요' : '완벽해요!'}</span>
        ${list.length ? `<button type="button" class="pbtn sm white" id="wb-hide">${hideAns ? '👀 정답 보기' : '🙈 정답 가리기'}</button>` : ''}
      </div>
      <div class="rev-list" id="wb-list">${list.length ? list.map(it => {
        const due = isWeakDue(it, now);
        const daysLeft = it.nextReviewAt ? Math.max(1, Math.ceil((Date.parse(it.nextReviewAt) - now) / 86400000)) : 0;
        const srsTag = due ? '<span class="rev-badge" style="background:#fef3c7;color:#92400e">🔔 지금 복습!</span>' : `<span class="rev-badge ok">⏳ ${daysLeft}일 후 복습</span>`;
        return `
        <div class="rev-item">
          <div class="rev-meta" style="justify-content:space-between">
            <span style="display:flex;gap:6px;flex-wrap:wrap"><span class="rev-badge">✖ ${it.misses || 1}회 틀림</span>${srsTag}</span>
            <button type="button" class="pbtn sm white" data-wbdel="${esc(it.key)}" title="목록에서 빼기">✓ 정복</button>
          </div>
          ${renderImgTag(it.img, 'q-img', '문제 그림', 'max-height:140px')}
          <div class="rev-q">${formatRichText(it.q)}</div>
          <div class="rev-a ${hideAns ? 'blur' : ''}">정답: ${formatRichText(it.a)}</div>
          ${it.explain ? `<div class="rev-ex">💡 ${formatRichText(it.explain)}</div>` : ''}
        </div>`;
      }).join('')
      : '<div class="hint" style="text-align:center;padding:24px">아직 누적된 오답이 없어요! 게임을 플레이하며 틀린 문제가 자동으로 이곳에 모입니다.</div>'}</div>
      <div class="m-actions">
        ${list.length ? '<button type="button" class="pbtn ok" id="wb-play">🎯 약점 문제로 바로 게임하기</button><button type="button" class="pbtn white" id="wb-print">🖨️ 약점 오답지 인쇄</button><button type="button" class="pbtn bad" id="wb-clear">🗑️ 비우기</button>' : ''}
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
        const prioritized = cur.slice().sort((a, b) => (isWeakDue(b) - isWeakDue(a)) || ((b.misses || 1) - (a.misses || 1)));
        closeModal();
        ac();
        const st = app.setup.settings;
        const sz = prioritized.length > 16 ? 5 : (prioritized.length <= 9 ? 3 : 4);
        actions.startGame({
          settings: { ...st, boardSize: sz, golden: Math.min(st.golden, 2), roundLimit: 0, bingoGoal: 0 },
          customQuestions: prioritized.map(x => ({ q: x.q, a: x.a, opts: x.opts ? [...x.opts] : null, explain: x.explain || '', img: x.img || '' })),
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

export function openLearningReportModal() {
  const st = loadSoloStats();
  const log = loadLearningLog();
  const streak = computeStudyStreak(log.days);
  const totalSolved = (log.totalCorrect || 0) + (log.totalWrong || 0);
  const acc = totalSolved ? Math.round((log.totalCorrect * 100) / totalSolved) : 0;
  const subjs = Object.entries(log.subjects || {});
  const badges = computeAchievements(st, log);
  const unlockedCount = badges.filter(b => b.unlocked).length;

  openModal(`
    <p class="m-title">📈 나의 학습 리포트 & 배지 도감</p>
    <p class="m-desc">꾸준히 퀴즈를 풀며 연속 학습일과 도전과제 배지를 모아 보세요!</p>
    <div class="rep-grid">
      <div class="dash-stat"><b>🔥 ${streak}일</b><small>연속 학습</small></div>
      <div class="dash-stat"><b>${log.gamesPlayed}판</b><small>총 완료 게임</small></div>
      <div class="dash-stat"><b>${totalSolved}문제</b><small>누적 풀이</small></div>
      <div class="dash-stat"><b>${acc}%</b><small>누적 정답률</small></div>
    </div>
    <h4 style="margin:12px 0 6px">📚 과목별 정답률</h4>
    ${subjs.length ? `<div class="dash-missed">${subjs.map(([name, s]) => {
      const tot = (s.correct || 0) + (s.wrong || 0);
      const p = tot ? Math.round((s.correct * 100) / tot) : 0;
      return `<div class="dash-missed-row"><div style="font-weight:800;font-size:13.5px">${esc(name)} · ${p}% (${s.correct}/${tot}문제 · ${s.games}판)</div><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.max(6, p)}%;background:linear-gradient(90deg,#22c55e,#16a34a)"></div></div></div>`;
    }).join('')}</div>`
    : '<div class="hint">게임을 한 판 이상 끝내면 과목별 정답률이 자동으로 기록돼요.</div>'}
    <h4 style="margin:14px 0 6px">🏅 도전과제 배지 (${unlockedCount} / ${badges.length})</h4>
    <div class="badge-grid" id="rep-badges">
      ${badges.map(b => `<div class="ach-card ${b.unlocked ? 'on' : ''}"><div class="ai">${b.icon}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'wide', 'info');
  $('#m-close').onclick = closeModal;
}

export function openShortcutsModal() {
  if ($('#screen-game').classList.contains('active') && isPCBusyTurn()) { toast('🤖 PC 차례가 끝난 뒤 열어 주세요'); return; }
  openModal(`
    <p class="m-title">⌨️ 키보드 단축키 안내</p>
    <p class="m-desc">수업 중 키보드로 빠르게 조작할 수 있어요.</p>
    <table class="kbd-table">
      <tr><th>상황</th><th>키</th><th>기능</th></tr>
      <tr><td>게임 보드</td><td><kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd></td><td>칸 사이 이동 · <kbd>Enter</kbd> 열기</td></tr>
      <tr><td>객관식 · OX</td><td><kbd>1</kbd>~<kbd>6</kbd> / <kbd>O</kbd>·<kbd>X</kbd></td><td>보기 또는 ⭕/❌ 바로 선택</td></tr>
      <tr><td>주관식(팀)</td><td><kbd>Space</kbd> / <kbd>O</kbd> / <kbd>X</kbd></td><td>정답 보기 · 맞음 · 틀림</td></tr>
      <tr><td>타이머</td><td><kbd>P</kbd> / <kbd>+</kbd></td><td>일시정지 · 10초 추가</td></tr>
      <tr><td>보상 · 다음</td><td><kbd>1</kbd>~<kbd>3</kbd> / <kbd>Enter</kbd></td><td>카드 고르기 · 다음으로</td></tr>
      <tr><td>게임 화면</td><td><kbd>Z</kbd> / <kbd>F</kbd> / <kbd>?</kbd></td><td>되돌리기 · 전체화면 · 단축키 표</td></tr>
    </table>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
}

export function howtoHTML() {
  const rw = REWARDS.map(r => `<div class="rw ${r.kind}"><span class="i">${r.icon}</span><div><b>${r.name}</b>${r.strong ? ' <small>(강력)</small>' : ''}<br>${r.id === 'mission' ? '팀이 함께 재미있는 미션을 해요.' : r.desc}</div></div>`).join('');
  return `<div class="howto">
    <h2>❓ 게임 방법</h2>
    <h4>1. 게임 시작 · 1인·팀 대결 · OX · 듣기 평가 · 실시간 방</h4>
    <ul><li>기본 세트 10종과 <b>학급 프로파일 저장</b>, <b>🏫 1~6모둠</b> 프리셋으로 수업 준비를 5초 만에 끝낼 수 있어요.</li>
    <li>정답이 <code>O/X</code>인 문제는 대형 ⭕/❌ 화면이 열리고, <b>🎧 듣기 평가 모드</b>로 영단어 듣기 퀴즈도 진행해요.</li>
    <li><b>📡 실시간 방</b>에서 학생들이 팀을 고르고 <b>🔔 선착순 버저</b>, 칸 투표, 답안 제출, 👏 응원 리액션에 참여해요.</li></ul>
    <h4>2. 배점 차등(제퍼디) · 스틸·콤보 · 전자칠판 모드</h4>
    <ul><li><b>💎 제퍼디 배점 차등</b>을 켜면 칸별 10/20/30점으로 전략이 깊어지고, <b>⚡ 오답 스틸</b>·<b>🔥 3연속 +5점</b>으로 역전의 재미가 커져요.</li>
    <li><b>🖥️ 전자칠판 대형 모드</b>와 경기 후 <b>🖼️ 결과 카드(.png) 저장</b>, <b>📈 학습 리포트(연속 학습일·배지 도감)</b>를 지원해요.</li></ul>
    <h4>3. 보상 카드 (정답을 맞히면 1·2·3 카드 중 고르기)</h4>
    <div class="rw-grid">${rw}</div>
    <h4>4. 선생님용 편의 기능 · 공유 코드 · 인쇄</h4>
    <ul><li>편집기에서 <b>📊 엑셀 양식(.csv)</b>, <b>🧹 형식 정리</b>, <b>IndexedDB 고화질 그림 첨부</b>, <b>3종 학습지·빙고판 인쇄</b>를 쓸 수 있어요.</li>
    <li>단축키 표는 언제든 <kbd>?</kbd> 키를 눌러 확인할 수 있어요.</li></ul>
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
  actions.openLearningReportModal = openLearningReportModal;
  actions.openShortcutsModal = openShortcutsModal;
  actions.openHowto = openHowto;
}
