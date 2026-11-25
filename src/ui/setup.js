import { TEAM_PRESETS, EMOJIS, MODE_PRESETS, REWARDS } from '../data/sets.js';
import { parseQuestions } from '../core/questions.js';
import { shuffle } from '../core/engine.js';
import {
  allSets,
  getSet,
  loadFavorites,
  toggleFavorite,
  loadSoloStats,
  saveSoloStats,
  loadSetMastery,
  loadWrongBank,
  loadClassProfiles,
  saveClassProfile,
  deleteClassProfile
} from '../utils/storage.js';
import { sfx, setBgmStyle } from '../utils/audio.js';
import {
  $,
  $$,
  esc,
  app,
  actions,
  saveSetup,
  applyTheme,
  applyMotion,
  applyBigScreen,
  toast,
  soloStatsHTML,
  openModal,
  closeModal,
  confirmModal
} from './shared.js';

let setFilter = 'all';
let setQuery = '';
let emoTargetIdx = null;
let selectedProfileId = '';

function isPresetMatch(p) {
  return Object.entries(p.vals).every(([k, v]) => app.setup.settings[k] === v);
}

function renderPresets() {
  $('#preset-bar').innerHTML = MODE_PRESETS.map(p => `<button type="button" class="preset-btn ${isPresetMatch(p) ? 'on' : ''}" data-preset="${p.id}"><b>${p.label}</b><small>${p.desc}</small></button>`).join('');
}

function renderClassProfiles() {
  const sel = $('#cls-prof-select');
  const del = $('#cls-prof-del');
  if (!sel) return;
  const list = loadClassProfiles();
  if (selectedProfileId && !list.some(p => p.id === selectedProfileId)) selectedProfileId = '';
  sel.innerHTML = `<option value="">🏫 저장된 학급 불러오기… (${list.length})</option>` +
    list.map(p => `<option value="${esc(p.id)}" ${p.id === selectedProfileId ? 'selected' : ''}>${esc(p.name)} (${p.teamCount}팀 · ${p.boardSize}×${p.boardSize})</option>`).join('');
  if (del) del.classList.toggle('hidden', !selectedProfileId);
}

export function setAdvOpen(open) {
  $('#adv-panel').classList.toggle('hidden', !open);
  $('#btn-adv').setAttribute('aria-expanded', String(!!open));
  $('#adv-arrow').textContent = open ? '▴' : '▾';
}

export function closeEmoPicker() {
  emoTargetIdx = null;
  $('#emo-picker').classList.remove('show');
}

function openEmoPicker(k, btn) {
  if (emoTargetIdx === k && $('#emo-picker').classList.contains('show')) { closeEmoPicker(); return; }
  emoTargetIdx = k;
  const pk = $('#emo-picker');
  const setup = app.setup;
  if (k === 'solo') {
    const cur = setup.solo.emoji || '🦊';
    pk.innerHTML = `<div class="emo-grid">${EMOJIS.map(e => `<button type="button" class="emo-opt ${e === cur ? 'cur' : ''}" data-pickemo="${e}">${e}</button>`).join('')}</div>`;
  } else {
    const activeTeams = setup.teams.slice(0, setup.settings.teamCount);
    pk.innerHTML = `<div class="emo-grid">${EMOJIS.map(e => {
      const owner = activeTeams.findIndex(t => t.emoji === e);
      return `<button type="button" class="emo-opt ${owner === k ? 'cur' : ''}" data-pickemo="${e}" title="${owner >= 0 ? `${owner + 1}팀 사용 중 (누르면 서로 바꿈)` : '선택'}">${e}${owner >= 0 && owner !== k ? `<span class="used-tag">${owner + 1}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  pk.classList.add('show');
  const r = btn.getBoundingClientRect();
  const w = pk.offsetWidth || 280;
  const h = pk.offsetHeight || 210;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
  const top = r.bottom + h + 10 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6);
  pk.style.left = left + 'px';
  pk.style.top = top + 'px';
}

function renderSetPicker() {
  const st = app.setup.settings;
  const sets = allSets();
  if (!sets.some(s => s.id === st.setId)) st.setId = 'sample';
  $('#set-select').innerHTML = sets.map(s => `<option value="${esc(s.id)}" ${s.id === st.setId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  const favs = loadFavorites();
  const mastery = loadSetMastery();
  const subjects = ['상식', '과학', '수학', '사회', '국어', '영어', '정보', '안전'];
  const filterTabs = [
    { id: 'all', label: '전체' },
    { id: 'fav', label: `⭐ 즐겨찾기${favs.length ? ` (${favs.length})` : ''}` },
    ...subjects.map(s => ({ id: s, label: s })),
    { id: 'custom', label: '내 세트' }
  ];
  $('#set-filters').innerHTML = filterTabs.map(f => `<button type="button" class="set-filter-btn ${setFilter === f.id ? 'on' : ''}" data-sfilter="${f.id}">${f.label}</button>`).join('');

  const q = setQuery.trim().toLowerCase();
  const filtered = sets.filter(s => {
    if (setFilter === 'fav' && !favs.includes(s.id)) return false;
    if (setFilter === 'custom' && s.builtin) return false;
    if (subjects.includes(setFilter) && s.subject !== setFilter) return false;
    if (q) {
      const hay = `${s.name} ${s.subject || ''} ${s.grade || ''} ${s.shareCode || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const ordered = [...filtered].sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0));
  $('#set-cards').innerHTML = ordered.length
    ? ordered.map(s => {
        const cnt = parseQuestions(s.text).list.length;
        const isFav = favs.includes(s.id);
        const m = mastery[s.id];
        const starsHtml = m && m.stars ? `<span class="set-stars" title="최고 ${m.bestScore}점">${'★'.repeat(m.stars)}${'☆'.repeat(3 - m.stars)}</span>` : '';
        const tag = s.builtin ? `${s.subject || '기본'}${s.grade ? '·' + s.grade : ''}` : (s.shareCode ? `☁️ ${s.shareCode}` : '내 세트');
        return `
          <div class="set-card ${s.id === st.setId ? 'on' : ''}" data-pickset="${esc(s.id)}" role="button" tabindex="0">
            <button type="button" class="set-pin ${isFav ? 'on' : ''}" data-pin="${esc(s.id)}" title="${isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}" aria-label="즐겨찾기">${isFav ? '⭐' : '☆'}</button>
            <div class="set-card-title">${esc(s.name)}</div>
            <div class="set-card-meta"><span>${esc(tag)}</span><span>· ${cnt}문제</span>${starsHtml}</div>
          </div>`;
      }).join('')
    : '<div class="hint" style="grid-column:1/-1;text-align:center;padding:14px">조건에 맞는 문제 세트가 없어요.</div>';
}

export function renderSetup() {
  const setup = app.setup;
  const st = setup.settings;
  applyTheme(st.theme);
  applyMotion(st.reduceMotion);
  applyBigScreen(st.bigScreen);
  renderPresets();
  const isSolo = st.playMode === 'solo';
  $('#play-mode').innerHTML = [
    { id: 'solo', label: '🤖 1인 vs PC' },
    { id: 'team2', label: '👥 2팀' },
    { id: 'team3', label: '👥 3팀' },
    { id: 'team4', label: '👥 4팀' },
    { id: 'team5', label: '👥 5팀' },
    { id: 'team6', label: '👥 6팀' }
  ].map(m => {
    const on = m.id === 'solo' ? isSolo : (!isSolo && st.teamCount === +m.id.slice(4));
    return `<button type="button" data-mode="${m.id}" class="${on ? 'on' : ''}">${m.label}</button>`;
  }).join('');
  $('#solo-box').classList.toggle('hidden', !isSolo);
  $('#team-box').classList.toggle('hidden', isSolo);
  if (isSolo) {
    $('#ai-level').innerHTML = [
      { id: 'easy', label: '🌱 쉬움' },
      { id: 'normal', label: '⚡ 보통' },
      { id: 'hard', label: '🔥 어려움' }
    ].map(l => `<button type="button" data-ailevel="${l.id}" class="${st.aiLevel === l.id ? 'on' : ''}">${l.label}</button>`).join('');
    $('#solo-row').innerHTML = `
      <div class="team-row" style="--c:${TEAM_PRESETS[0].color}">
        <button type="button" class="emo" data-emo="solo" title="캐릭터 고르기">${setup.solo.emoji || '🦊'}</button>
        <input data-soloname maxlength="8" value="${esc(setup.solo.name)}" placeholder="나">
        <span class="vs-pc-pill">VS 🤖 PC</span>
      </div>`;
    $('#solo-stats-bar').innerHTML = soloStatsHTML(loadSoloStats(), true) + '<button type="button" class="stats-reset-btn" data-open-report>📈 리포트</button>';
  } else {
    renderClassProfiles();
    $('#team-rows').innerHTML = setup.teams.slice(0, st.teamCount).map((t, k) => `
      <div class="team-row" style="--c:${TEAM_PRESETS[k].color}">
        <span class="dot"></span>
        <button type="button" class="emo" data-emo="${k}" title="캐릭터 고르기">${t.emoji}</button>
        <input data-tname="${k}" maxlength="8" value="${esc(t.name)}" placeholder="${TEAM_PRESETS[k].name}">
      </div>`).join('');
  }

  renderSetPicker();

  const p = parseQuestions(getSet(st.setId).text).list;
  const mc = p.filter(q => q.opts).length;
  const info = $('#set-info');
  const nSide = [3, 4, 5].includes(st.boardSize) ? st.boardSize : 5;
  const total = nSide * nSide;
  let html = `총 <b>${p.length}문제</b> (객관식 ${mc} · 주관식 ${p.length - mc})`;
  info.classList.toggle('warn', p.length < total);
  if (p.length > total) html += `<br>${nSide}×${nSide} 빙고판에는 ${st.shuffle ? '무작위로 고른' : '앞에서부터'} ${total}문제가 올라가요.`;
  else if (p.length < total) html += `<br>⚠️ ${total}문제보다 적어요. 남는 <b>${total - p.length}칸</b>은 문제 없이 바로 차지하는 🍀 행운 칸이 돼요.`;
  else html += `<br>딱 ${total}칸에 맞아요! 👍`;
  info.innerHTML = html;

  const wbBtn = $('#btn-weak-bank2');
  if (wbBtn) {
    const wbCnt = loadWrongBank().length;
    wbBtn.classList.toggle('hidden', wbCnt === 0);
    if (wbCnt > 0) wbBtn.textContent = `🔥 약점 문제 복습 (${wbCnt})`;
  }

  $('#board-size-seg').innerHTML = [
    { n: 3, label: '3×3 (9칸 · 5분)' },
    { n: 4, label: '4×4 (16칸 · 빠름)' },
    { n: 5, label: '5×5 (25칸 · 기본)' }
  ].map(b => `<button type="button" data-bsize="${b.n}" class="${nSide === b.n ? 'on' : ''}">${b.label}</button>`).join('');

  const themeNames = { forest: '가을 숲', ocean: '바닷속', space: '우주', chalkboard: '칠판 다크' };
  const disCnt = (st.disabledRewards || []).length;
  $('#adv-summary').textContent = `${st.tilePts}점·빙고${st.bingoPts}점${st.bingoGoal ? '·목표' + st.bingoGoal + '줄' : ''} · ${st.rewards ? (disCnt ? `보상(제외${disCnt})` : '보상 ON') : '보상 OFF'} · ${st.timer ? st.timer + '초' : '시간 무제한'} · ${themeNames[st.theme] || '가을 숲'}`;
  $$('[data-opt]').forEach(el => {
    const k = el.dataset.opt;
    if (el.type === 'checkbox') el.checked = !!st[k];
    else el.value = String(st[k]);
  });
  $('#o-penalties').disabled = !st.rewards;
  $('#o-strong').disabled = !st.rewards;
  $('#btn-rw-custom').disabled = !st.rewards;
  if ($('#o-steal')) $('#o-steal').disabled = isSolo || st.wrongMode !== 'keep';
}

function openClassProfileSaveModal() {
  const st = app.setup.settings;
  openModal(`
    <p class="m-title">🏫 학급 프로파일 저장</p>
    <p class="m-desc">현재 팀 수(${st.teamCount}팀), 팀 이름·캐릭터, 판 크기(${st.boardSize}×${st.boardSize})와 규칙을 저장해요.</p>
    <form id="cls-save-form" class="q-sa-form" style="margin-top:12px">
      <input id="cls-name-inp" maxlength="20" placeholder="예: 5학년 2반" required>
      <button type="submit" class="pbtn gold">저장</button>
    </form>
    <div class="m-actions"><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#cls-save-form').onsubmit = e => {
    e.preventDefault();
    const nm = $('#cls-name-inp').value.trim();
    if (!nm) return;
    const saved = saveClassProfile({
      name: nm,
      teamCount: st.teamCount,
      boardSize: st.boardSize,
      teams: app.setup.teams,
      settings: {
        tilePts: st.tilePts,
        bingoPts: st.bingoPts,
        theme: st.theme,
        jeopardyPts: st.jeopardyPts,
        stealOnWrong: st.stealOnWrong,
        comboBonus: st.comboBonus
      }
    });
    if (saved) selectedProfileId = saved.id;
    closeModal();
    renderSetup();
    sfx('coin');
    toast(`🏫 “${nm}” 반 설정을 저장했어요!`);
  };
}

function openRewardCustomizerModal() {
  const dis = new Set(app.setup.settings.disabledRewards || []);
  openModal(`
    <p class="m-title">🃏 보상 카드 세부 선택</p>
    <p class="m-desc">수업에서 빼고 싶은 보상·벌칙 카드를 체크 해제하세요.</p>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px">
      <button type="button" class="pbtn sm white" id="rwc-all">✅ 전체 사용</button>
      <button type="button" class="pbtn sm white" id="rwc-peace">🕊️ 뺏기·폭탄 빼기</button>
      <button type="button" class="pbtn sm white" id="rwc-nobad">🌈 벌칙 카드 모두 빼기</button>
    </div>
    <div class="rw-custom-grid">
      ${REWARDS.map(r => `<label class="rw-custom-item"><input type="checkbox" data-rwc="${r.id}" ${dis.has(r.id) ? '' : 'checked'}><span>${r.icon} ${r.name}${r.kind === 'bad' ? ' <small>(벌칙)</small>' : ''}${r.strong ? ' <small>(강력)</small>' : ''}</span></label>`).join('')}
    </div>
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">적용하고 닫기</button></div>`, 'wide', 'info');
  const syncFromChecks = () => {
    const disabled = $$('[data-rwc]').filter(c => !c.checked).map(c => c.dataset.rwc);
    app.setup.settings.disabledRewards = disabled;
    saveSetup();
    renderSetup();
  };
  $$('[data-rwc]').forEach(c => c.addEventListener('change', syncFromChecks));
  $('#rwc-all').onclick = () => { $$('[data-rwc]').forEach(c => { c.checked = true; }); syncFromChecks(); };
  $('#rwc-peace').onclick = () => {
    const peaceBan = new Set(['steal', 'swap', 'bomb', 'stealPts', 'scoreSwap', 'freezeOther']);
    $$('[data-rwc]').forEach(c => { c.checked = !peaceBan.has(c.dataset.rwc); });
    syncFromChecks();
  };
  $('#rwc-nobad').onclick = () => {
    const badIds = new Set(REWARDS.filter(r => r.kind === 'bad').map(r => r.id));
    $$('[data-rwc]').forEach(c => { c.checked = !badIds.has(c.dataset.rwc); });
    syncFromChecks();
  };
  $('#m-close').onclick = closeModal;
}

export function initSetup() {
  actions.renderSetup = renderSetup;
  actions.setAdvOpen = setAdvOpen;
  actions.closeEmoPicker = closeEmoPicker;

  $('#btn-adv').onclick = () => { sfx('click'); setAdvOpen($('#adv-panel').classList.contains('hidden')); };
  $('#btn-rw-custom').onclick = () => { sfx('click'); openRewardCustomizerModal(); };
  if ($('#btn-weak-bank2')) {
    $('#btn-weak-bank2').onclick = () => { sfx('click'); if (actions.openWeakBankModal) actions.openWeakBankModal(); };
  }

  if ($('#cls-prof-save')) $('#cls-prof-save').onclick = () => { sfx('click'); openClassProfileSaveModal(); };
  if ($('#cls-prof-select')) {
    $('#cls-prof-select').addEventListener('change', e => {
      const id = e.target.value;
      selectedProfileId = id;
      const prof = loadClassProfiles().find(p => p.id === id);
      if (!prof) { renderClassProfiles(); return; }
      app.setup.settings.teamCount = Math.max(2, Math.min(6, Number(prof.teamCount) || 2));
      app.setup.settings.boardSize = [3, 4, 5].includes(Number(prof.boardSize)) ? Number(prof.boardSize) : 5;
      if (Array.isArray(prof.teams)) {
        prof.teams.forEach((t, k) => {
          if (app.setup.teams[k]) {
            app.setup.teams[k].name = t.name || app.setup.teams[k].name;
            app.setup.teams[k].emoji = t.emoji || app.setup.teams[k].emoji;
          }
        });
      }
      if (prof.settings) Object.assign(app.setup.settings, prof.settings);
      saveSetup();
      renderSetup();
      sfx('coin');
      toast(`🏫 “${prof.name}” 학급 설정을 불러왔어요`);
    });
  }
  if ($('#cls-prof-del')) {
    $('#cls-prof-del').onclick = async () => {
      if (!selectedProfileId) return;
      const prof = loadClassProfiles().find(p => p.id === selectedProfileId);
      if (!prof) return;
      if (!(await confirmModal({ title: `“${prof.name}” 학급 프로파일을 삭제할까요?`, okText: '삭제', danger: true }))) return;
      deleteClassProfile(selectedProfileId);
      selectedProfileId = '';
      renderClassProfiles();
      toast('학급 프로파일을 삭제했어요');
    };
  }

  $('#emo-picker').addEventListener('click', e => {
    const b = e.target.closest('[data-pickemo]');
    if (!b || emoTargetIdx == null) return;
    const chosen = b.dataset.pickemo;
    const k = emoTargetIdx;
    const setup = app.setup;
    if (k === 'solo') {
      setup.solo.emoji = chosen;
    } else {
      const other = setup.teams.slice(0, setup.settings.teamCount).findIndex((t, idx) => idx !== k && t.emoji === chosen);
      if (other >= 0) setup.teams[other].emoji = setup.teams[k].emoji;
      setup.teams[k].emoji = chosen;
    }
    sfx('click');
    saveSetup();
    closeEmoPicker();
    renderSetup();
  });

  document.addEventListener('click', e => {
    if ($('#emo-picker').classList.contains('show') && !e.target.closest('#emo-picker') && !e.target.closest('[data-emo]')) closeEmoPicker();
  });

  $('#set-search').addEventListener('input', e => { setQuery = e.target.value; renderSetPicker(); });
  $('#set-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-sfilter]');
    if (!b) return;
    sfx('click');
    setFilter = b.dataset.sfilter;
    renderSetPicker();
  });
  $('#set-cards').addEventListener('click', e => {
    const pin = e.target.closest('[data-pin]');
    if (pin) { e.stopPropagation(); sfx('click'); toggleFavorite(pin.dataset.pin); renderSetPicker(); return; }
    const card = e.target.closest('[data-pickset]');
    if (!card) return;
    sfx('click');
    app.setup.settings.setId = card.dataset.pickset;
    saveSetup();
    renderSetup();
  });
  $('#set-cards').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('[data-pickset]');
      if (card && !e.target.closest('[data-pin]')) { e.preventDefault(); card.click(); }
    }
  });

  $('#preset-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = MODE_PRESETS.find(x => x.id === b.dataset.preset);
    if (!p) return;
    sfx('click');
    Object.assign(app.setup.settings, p.vals);
    saveSetup();
    renderSetup();
    toast(`${p.label} 설정을 적용했어요`);
  });
  $('#play-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    sfx('click');
    const m = b.dataset.mode;
    if (m === 'solo') app.setup.settings.playMode = 'solo';
    else { app.setup.settings.playMode = 'team'; app.setup.settings.teamCount = +m.slice(4); }
    saveSetup();
    closeEmoPicker();
    renderSetup();
  });
  $('#ai-level').addEventListener('click', e => {
    const b = e.target.closest('[data-ailevel]');
    if (!b) return;
    sfx('click');
    app.setup.settings.aiLevel = b.dataset.ailevel;
    saveSetup();
    renderSetup();
  });
  $('#board-size-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-bsize]');
    if (!b) return;
    sfx('click');
    app.setup.settings.boardSize = +b.dataset.bsize;
    saveSetup();
    renderSetup();
  });
  $('#solo-row').addEventListener('click', e => { const b = e.target.closest('[data-emo]'); if (!b) return; sfx('click'); openEmoPicker('solo', b); });
  $('#solo-row').addEventListener('input', e => { if (!e.target.hasAttribute('data-soloname')) return; app.setup.solo.name = e.target.value; saveSetup(); });
  $('#solo-stats-bar').addEventListener('click', async e => {
    if (e.target.closest('[data-open-report]')) {
      sfx('click');
      if (actions.openLearningReportModal) actions.openLearningReportModal();
      return;
    }
    if (!e.target.closest('[data-reset-stats]')) return;
    if (!(await confirmModal({ title: '1인 전적을 초기화할까요?', desc: '승·무·패 기록과 난이도 정복 배지가 모두 지워집니다.', okText: '초기화', danger: true }))) return;
    saveSoloStats({ wins: 0, draws: 0, losses: 0, bestScore: 0, streak: 0, maxStreak: 0, cleared: { easy: false, normal: false, hard: false } });
    sfx('click');
    renderSetup();
    toast('1인 전적을 초기화했어요');
  });

  $('#tp-group').onclick = () => {
    sfx('click');
    for (let k = 0; k < TEAM_PRESETS.length; k++) { app.setup.teams[k].name = `${k + 1}모둠`; app.setup.teams[k].emoji = TEAM_PRESETS[k].emoji; }
    saveSetup();
    renderSetup();
    toast('🏫 1~6모둠 이름으로 맞췄어요');
  };
  $('#tp-animal').onclick = () => {
    sfx('click');
    const names = ['여우팀', '고래팀', '개구리팀', '유니콘팀', '호랑이팀', '펭귄팀'];
    for (let k = 0; k < TEAM_PRESETS.length; k++) { app.setup.teams[k].name = names[k]; app.setup.teams[k].emoji = TEAM_PRESETS[k].emoji; }
    saveSetup();
    renderSetup();
    toast('🐾 동물팀 이름으로 바꿨어요');
  };
  $('#tp-shuffle').onclick = () => {
    sfx('click');
    const n = app.setup.settings.teamCount;
    const active = app.setup.teams.slice(0, n);
    shuffle(active);
    app.setup.teams.splice(0, n, ...active);
    saveSetup();
    renderSetup();
    toast('🎲 팀 순서를 무작위로 섞었어요');
  };

  $('#team-rows').addEventListener('click', e => { const b = e.target.closest('[data-emo]'); if (!b) return; sfx('click'); openEmoPicker(+b.dataset.emo, b); });
  $('#team-rows').addEventListener('input', e => { const k = e.target.dataset.tname; if (k == null) return; app.setup.teams[+k].name = e.target.value; saveSetup(); });
  $('#set-select').addEventListener('change', e => { app.setup.settings.setId = e.target.value; saveSetup(); renderSetup(); });
  $$('[data-opt]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.opt;
    app.setup.settings[k] = el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value);
    if (k === 'bgmStyle') setBgmStyle(app.setup.settings.bgmStyle);
    saveSetup();
    renderSetup();
  }));
}
