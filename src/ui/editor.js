import { isSafeImageUrl, parseQuestions, serializeQuestions, cleanupQuestionsText, getSpeechSpec, formatRichText } from '../core/questions.js';
import { shuffle } from '../core/engine.js';
import {
  store,
  savedSets,
  allSets,
  getSet,
  hashSetContent,
  saveMyCloudCode,
  findReusableCloudCode,
  loadMyCloudCodes,
  getStorageUsage
} from '../utils/storage.js';
import { encodeSetShare, makeQRSvg } from '../utils/qr.js';
import { uploadSharedSet, publishToPublicLibrary } from '../utils/cloud.js';
import { compressImageFile } from '../utils/image.js';
import { saveImageToIdb, hydrateImages, getIdbUsage, inlineIdbImagesInText } from '../utils/imageStore.js';
import { sfx, speakText, isTtsSupported } from '../utils/audio.js';
import { printQuestionSheet, printBingoBoard } from './print.js';
import { $, $$, esc, app, actions, saveSetup, show, toast, openModal, closeModal, confirmModal, renderImgTag } from './shared.js';

let editingId = null;
let editorBack = 'title';
let edMode = 'text';
let edSnapshot = '';
let cardList = [];
let dragCardIdx = -1;
let imgUploadIdx = -1;
let qrZoomLastFocus = null;
let cardSearchQ = '';
let cardTypeFilter = 'all';

const currentEdSnap = () => $('#ed-name').value + '\0' + $('#ed-text').value;
const isEdDirty = () => currentEdSnap() !== edSnapshot;
function refreshDirty() { $('#ed-dirty').classList.toggle('hidden', !isEdDirty()); }

export async function renderStorageGauge() {
  const el = $('#ed-storage-bar');
  if (!el) return;
  const { usedKB, maxKB, pct } = getStorageUsage();
  const idb = await getIdbUsage();
  if (!$('#ed-storage-bar')) return;
  el.className = 'ed-storage' + (pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '');
  el.innerHTML = `
    <div class="ed-storage-head">
      <span>💾 텍스트 저장: <b>${usedKB}KB</b> / ${maxKB}KB (${pct}%)${idb.count ? ` · 🖼️ 그림 <b>${idb.count}장</b>(${idb.kb}KB, IndexedDB)` : ''}</span>
      ${pct >= 75 ? '<small>백업 후 필요 없는 세트를 정리해 주세요</small>' : ''}
    </div>
    <div class="ed-storage-track"><div class="ed-storage-fill" style="width:${Math.max(2, pct)}%"></div></div>`;
}

function setEditorMode(mode) {
  edMode = mode;
  $$('[data-edmode]').forEach(b => b.classList.toggle('on', b.dataset.edmode === mode));
  $('#ed-text-wrap').classList.toggle('hidden', mode !== 'text');
  $('#ed-cards-wrap').classList.toggle('hidden', mode !== 'cards');
  if (mode === 'cards') { loadCardsFromText(); renderCardEditor(); }
}

function loadCardsFromText() {
  cardList = parseQuestions($('#ed-text').value).list.map(x => ({
    q: x.q,
    a: x.a,
    isMc: !!x.opts,
    w1: x.opts && x.opts[1] ? x.opts[1] : '',
    w2: x.opts && x.opts[2] ? x.opts[2] : '',
    w3: x.opts && x.opts[3] ? x.opts[3] : '',
    extraWrong: x.opts && x.opts.length > 4 ? x.opts.slice(4) : [],
    explain: x.explain || '',
    img: x.img || '',
    listen: x.listen || '',
    pts: x.pts || 0,
    selected: false
  }));
}

function renderCardEditor() {
  const wrap = $('#ed-cards');
  if (!cardList.length) {
    wrap.innerHTML = '<div class="hint" style="padding:12px;text-align:center">아직 문제가 없어요. 아래 <b>➕ 새 문제 추가</b> 버튼을 눌러 보세요.</div>';
    return;
  }
  const q = cardSearchQ.trim().toLowerCase();
  const visible = cardList.map((c, idx) => ({ c, idx })).filter(({ c }) => {
    const inc = !(c.q.trim() && c.a.trim());
    if (cardTypeFilter === 'mc' && !c.isMc) return false;
    if (cardTypeFilter === 'sa' && c.isMc) return false;
    if (cardTypeFilter === 'inc' && !inc) return false;
    if (q && !`${c.q} ${c.a} ${c.explain}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!visible.length) {
    wrap.innerHTML = '<div class="hint" style="padding:12px;text-align:center">검색·필터 조건에 맞는 카드가 없어요.</div>';
    return;
  }
  wrap.innerHTML = visible.map(({ c, idx }) => {
    const inc = !(c.q.trim() && c.a.trim());
    const canAddOpt = c.isMc && (3 + (c.extraWrong || []).length) < 5;
    const validImg = c.img && isSafeImageUrl(c.img);
    return `
    <div class="ed-card${inc ? ' incomplete' : ''}" data-ci="${idx}" draggable="true">
      <div class="ed-card-top">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" class="ed-card-chk" data-csel="${idx}" ${c.selected ? 'checked' : ''} aria-label="${idx + 1}번 선택">
          <span class="ed-drag" title="끌어서 순서 바꾸기">⠿</span>
          <button type="button" class="ed-num-btn" data-cmoveto="${idx}" title="눌러서 원하는 번호로 바로 이동">#${idx + 1}</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <button type="button" class="pbtn sm white" data-cpreview="${idx}" title="실제 화면 미리보기">👁️</button>
          <button type="button" class="pbtn sm white" data-cmove="${idx}:-1" ${idx === 0 ? 'disabled' : ''} title="위로 이동">▲</button>
          <button type="button" class="pbtn sm white" data-cmove="${idx}:1" ${idx === cardList.length - 1 ? 'disabled' : ''} title="아래로 이동">▼</button>
          <select data-cf="type"><option value="mc" ${c.isMc ? 'selected' : ''}>객관식</option><option value="sa" ${!c.isMc ? 'selected' : ''}>주관식</option></select>
          <select data-cf="pts" title="개별 배점">
            <option value="0" ${!c.pts ? 'selected' : ''}>기본점수</option>
            <option value="10" ${+c.pts === 10 ? 'selected' : ''}>10점</option>
            <option value="20" ${+c.pts === 20 ? 'selected' : ''}>20점</option>
            <option value="30" ${+c.pts === 30 ? 'selected' : ''}>30점</option>
          </select>
          <button type="button" class="pbtn sm bad" data-cdel="${idx}" title="삭제">🗑️</button>
        </div>
      </div>
      <input data-cf="q" value="${esc(c.q)}" placeholder="문제를 입력하세요 (**강조**, ____ 빈칸, ^2 위첨자)">
      <input data-cf="a" value="${esc(c.a)}" placeholder="정답을 입력하세요 (O/X 문제는 자동으로 큰 OX UI 적용)">
      ${c.isMc ? `<div class="ed-card-opts">
        <input data-cf="w1" value="${esc(c.w1)}" placeholder="오답 1">
        <input data-cf="w2" value="${esc(c.w2)}" placeholder="오답 2">
        <input data-cf="w3" value="${esc(c.w3)}" placeholder="오답 3">
        ${(c.extraWrong || []).map((w, j) => `<input data-cex="${j}" value="${esc(w)}" placeholder="오답 ${j + 4}">`).join('')}
      </div>` : ''}
      <input data-cf="explain" value="${esc(c.explain)}" placeholder="해설 (선택)">
      <div class="ed-img-row">
        <input data-cf="img" value="${esc(c.img || '')}" placeholder="그림 URL 또는 Ctrl+V / 🖼️ 파일 올리기 (선택)">
        <button type="button" class="pbtn sm white" data-cimgup="${idx}" title="컴퓨터에서 그림 파일 올리기">🖼️</button>
        ${validImg ? `<button type="button" class="pbtn sm bad" data-cimgclr="${idx}" title="그림 지우기">✕</button>` : ''}
      </div>
      ${validImg ? renderImgTag(c.img, 'ed-img-thumb', '첨부 그림 미리보기') : ''}
      <div class="ed-card-foot">
        <div class="ed-card-warn${inc ? '' : ' hidden'}">⚠️ 문제와 정답을 모두 입력해야 저장돼요</div>
        ${canAddOpt ? `<button type="button" class="pbtn sm white" data-caddopt="${idx}">+ 오답 추가</button>` : ''}
      </div>
    </div>`;
  }).join('');
  hydrateImages(wrap);
}

function openCardJumpModal(fromIdx) {
  if (cardList.length < 2) { toast('카드가 2개 이상일 때 순서를 바꿀 수 있어요'); return; }
  openModal(`
    <p class="m-title">↕️ #${fromIdx + 1}번 카드 이동</p>
    <p class="m-desc">원하는 위치 번호(1~${cardList.length})를 고르세요.</p>
    <form id="cj-form" class="q-sa-form" style="margin-top:12px">
      <input type="number" id="cj-pos" min="1" max="${cardList.length}" value="${fromIdx + 1}" style="text-align:center">
      <button type="submit" class="pbtn gold">이동</button>
    </form>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px">
      <button type="button" class="pbtn sm white" id="cj-top">⏫ 맨 앞 (1번)</button>
      <button type="button" class="pbtn sm white" id="cj-bot">⏬ 맨 뒤 (${cardList.length}번)</button>
    </div>
    <div class="m-actions"><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');
  const moveTo = pos1 => {
    const to = Math.max(0, Math.min(cardList.length - 1, pos1 - 1));
    closeModal();
    if (to !== fromIdx) {
      const [moved] = cardList.splice(fromIdx, 1);
      cardList.splice(to, 0, moved);
      syncCardsToText();
      renderCardEditor();
      sfx('click');
      toast(`↕️ #${fromIdx + 1}번 카드를 ${to + 1}번 위치로 옮겼어요`);
    }
  };
  $('#cj-form').onsubmit = e => { e.preventDefault(); moveTo(+$('#cj-pos').value || fromIdx + 1); };
  $('#cj-top').onclick = () => moveTo(1);
  $('#cj-bot').onclick = () => moveTo(cardList.length);
  $('#m-close').onclick = closeModal;
}

function syncCardsToText() {
  const valid = cardList.filter(c => c.q.trim() && c.a.trim()).map(c => ({
    q: c.q.trim(),
    a: c.a.trim(),
    opts: c.isMc ? [c.a.trim(), c.w1.trim(), c.w2.trim(), c.w3.trim(), ...(c.extraWrong || []).map(x => x.trim())].filter(Boolean) : null,
    explain: c.explain.trim(),
    img: isSafeImageUrl(c.img) ? c.img.trim() : '',
    listen: c.listen || '',
    pts: Number(c.pts) || 0
  }));
  $('#ed-text').value = serializeQuestions(valid);
  updateEdStatus();
}

function openQuestionPreview(item, num) {
  const opts = item.opts ? [...item.opts] : null;
  const spec = getSpeechSpec(item.q);
  const ttsBtn = isTtsSupported() ? '<button type="button" class="q-tts-btn" id="q-tts" title="문제 읽어주기">🔊 읽기</button>' : '';
  const imgHtml = renderImgTag(item.img, 'q-img', '문제 그림');
  openModal(`
    <div class="q-head" style="--c:#2f7de1">
      <span>👁️ 문제 미리보기</span>
      <div class="q-head-r">${ttsBtn}<span class="q-no">#${num}번${item.pts ? ` · ${item.pts}점` : ''}</span></div>
    </div>
    ${imgHtml}
    <div class="q-text${item.q.length > 65 ? ' long' : ''}">${formatRichText(item.q)}</div>
    ${opts ? `<div class="q-opts">${opts.map((o, k) => `<button type="button" class="q-opt ${o === item.a ? 'right' : ''}" disabled><b>${'①②③④⑤⑥'[k]}</b>${formatRichText(o)}</button>`).join('')}</div>`
      : `<div class="q-answer show">정답: <b>${formatRichText(item.a)}</b></div>`}
    ${item.explain ? `<div class="q-explain">💡 <b>해설:</b> ${formatRichText(item.explain)}</div>` : ''}
    <div class="m-actions"><button type="button" class="pbtn gold" id="m-close">닫기</button></div>`, '', 'info');
  if ($('#q-tts')) $('#q-tts').onclick = () => speakText(spec.text, spec.lang, app.setup.settings.ttsRate || 1);
  $('#m-close').onclick = closeModal;
}

export function openEditor(from) {
  editorBack = from;
  show('editor');
  setEditorMode('text');
  renderSetList();
  renderStorageGauge();
  renderPrompt();
  if (!$('#ed-text').value.trim()) loadIntoEditor(null);
  else updateEdStatus();
}

function loadIntoEditor(id) {
  const s = id ? getSet(id) : null;
  editingId = s && !s.builtin ? s.id : null;
  $('#ed-name').value = s ? (s.builtin ? s.name.replace(/\s*\(.*\)$/, '') + ' (복사본)' : s.name) : '';
  $('#ed-text').value = s ? s.text : '';
  edSnapshot = currentEdSnap();
  updateEdStatus();
  if (edMode === 'cards') { loadCardsFromText(); renderCardEditor(); }
}

function updateEdStatus() {
  const { list, errors } = parseQuestions($('#ed-text').value);
  const st = $('#ed-status');
  const mc = list.filter(q => q.opts).length;
  const nSide = [3, 4, 5].includes(app.setup.settings.boardSize) ? app.setup.settings.boardSize : 5;
  const targetN = nSide * nSide;
  const seen = new Map();
  const dups = [];
  list.forEach((q, idx) => {
    const k = q.q.toLowerCase().replace(/\s+/g, '');
    if (!k) return;
    if (seen.has(k)) dups.push([seen.get(k), idx + 1]);
    else seen.set(k, idx + 1);
  });
  let h = list.length ? `✅ 읽은 문제 <b>${list.length}개</b> (객관식 ${mc} · 주관식 ${list.length - mc})` : '아직 읽은 문제가 없어요. 형식에 맞춰 문제를 넣어 주세요.';
  if (list.length && list.length < targetN) h += ` · ${targetN}개(${nSide}×${nSide})보다 적으면 남는 칸은 🍀 행운 칸이 돼요`;
  if (dups.length) h += `<div class="ed-dup">⚠️ 중복된 문제가 ${dups.length}개 있어요 (${dups.slice(0, 3).map(d => `${d[0]}번=${d[1]}번`).join(', ')}${dups.length > 3 ? '…' : ''})</div>`;
  if (errors.length) h += errors.slice(0, 4).map(e => `<button type="button" class="ed-err" data-line="${e.line}">⚠️ ${esc(e.msg)}</button>`).join('') + (errors.length > 4 ? `<div style="margin-top:4px;font-size:12.5px">…외 ${errors.length - 4}줄</div>` : '');
  st.innerHTML = h;
  st.classList.toggle('warn', !list.length || errors.length > 0);
  $('#ed-preview').innerHTML = list.map((q, i) => `<div><span class="tag ${q.opts ? '' : 's'}">${q.opts ? '객관식' : '주관식'}</span><b>${i + 1}.</b> ${formatRichText(q.q)} → <b>${formatRichText(q.a)}</b>${q.opts ? ` <span style="color:var(--muted)">(오답: ${q.opts.slice(1).map(esc).join(', ')})</span>` : ''}${q.pts ? ` <span style="color:#d97706">[${q.pts}점]</span>` : ''}${q.listen ? ' <span style="color:#7c3aed">[🎧]</span>' : ''}${q.explain ? ` <span style="color:#2563eb">[해설: ${esc(q.explain)}]</span>` : ''}${q.img ? ' <span style="color:#059669">[🖼️ 그림]</span>' : ''}</div>`).join('');
  $('#ed-preview').classList.toggle('hidden', !list.length);
  refreshDirty();
}

export function renderSetList() {
  const codes = loadMyCloudCodes();
  $('#set-list').innerHTML = allSets().map(s => {
    const n = parseQuestions(s.text).list.length;
    const code = s.shareCode || (codes.find(c => c.title === s.name)?.code || '');
    return `
      <div class="item"><div class="nm">${s.builtin ? '⭐ ' : ''}${esc(s.name)} <span class="n">· ${n}문제${code ? ` · ☁️ ${esc(code)}` : ''}</span></div>
        <button class="pbtn sm white" data-load="${esc(s.id)}">불러오기</button>
        <button class="pbtn sm white" data-dup="${esc(s.id)}">📋 복제</button>
        <button class="pbtn sm ok" data-useset="${esc(s.id)}">게임에 사용</button>
        ${code ? `<button class="pbtn sm blue" data-analytics="${esc(code)}" data-atitle="${esc(s.name)}">📊 현황</button>` : ''}
        ${s.builtin ? '' : `<button class="pbtn sm bad" data-del="${esc(s.id)}">삭제</button>`}
      </div>`;
  }).join('');
  renderStorageGauge();
}

function saveEditor() {
  const name = $('#ed-name').value.trim();
  const text = $('#ed-text').value;
  const n = parseQuestions(text).list.length;
  if (!n) { toast('읽을 수 있는 문제가 없어요. 형식을 확인해 주세요.'); return null; }
  if (!name) { toast('문제 세트 이름을 적어 주세요.'); $('#ed-name').focus(); return null; }
  const sets = savedSets();
  let s = editingId && sets.find(x => x.id === editingId);
  const wasEdit = !!s;
  if (s) { s.name = name; s.text = text; }
  else { s = { id: 'set_' + Date.now().toString(36), name, text }; sets.push(s); editingId = s.id; }
  if (!store('bq_sets', sets)) {
    if (!wasEdit) editingId = null;
    toast('⚠️ 저장 공간이 부족해 저장하지 못했어요. 필요 없는 세트를 지우거나 백업해 주세요.');
    return null;
  }
  const inc = edMode === 'cards' ? cardList.filter(c => (c.q.trim() || c.a.trim()) && !(c.q.trim() && c.a.trim())).length : 0;
  edSnapshot = currentEdSnap();
  refreshDirty();
  renderSetList();
  toast(inc ? `💾 “${name}” 저장 완료 (${n}문제 · 미완성 카드 ${inc}개 제외)` : `💾 “${name}” 저장 완료 (${n}문제)`);
  sfx('coin');
  return s.id;
}

function restoreSetsFromJson(rawJson) {
  const data = JSON.parse(rawJson);
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.sets) ? data.sets : null);
  if (!arr) throw new Error('Invalid backup format');
  const cur = savedSets();
  const seen = new Set(cur.map(s => s.name + '\0' + s.text));
  const usedIds = new Set(cur.map(s => s.id));
  let added = 0;
  let skipped = 0;
  arr.forEach(item => {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 30) : '';
    const text = typeof item?.text === 'string' ? item.text : '';
    if (!name || !parseQuestions(text).list.length) { skipped++; return; }
    const key = name + '\0' + text;
    if (seen.has(key)) { skipped++; return; }
    const id = typeof item.id === 'string' && item.id.startsWith('set_') && !usedIds.has(item.id)
      ? item.id
      : 'set_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    usedIds.add(id);
    seen.add(key);
    cur.push({ id, name, text, shareCode: item.shareCode || undefined });
    added++;
  });
  if (!store('bq_sets', cur)) throw new Error('QUOTA');
  renderSetList();
  return { added, skipped, total: cur.length };
}

export function closeQrZoom() {
  const ov = $('#qr-zoom-overlay');
  if (!ov || !ov.classList.contains('show')) return;
  ov.classList.remove('show');
  ov.innerHTML = '';
  if (qrZoomLastFocus && qrZoomLastFocus.focus && document.contains(qrZoomLastFocus)) qrZoomLastFocus.focus();
  qrZoomLastFocus = null;
}

function openQrZoom(title, count, svgHtml) {
  const ov = $('#qr-zoom-overlay');
  if (!ov || !svgHtml) return;
  qrZoomLastFocus = document.activeElement;
  ov.innerHTML = `
    <div class="qr-zoom-card">
      <div style="font-size:20px;font-weight:900">📱 ${esc(title)} <small style="font-size:14px;color:#5c4d38">(${count}문제)</small></div>
      ${svgHtml}
      <div class="hint" style="margin:0;color:#5c4d38">화면 밝기를 높이면 교실 뒤에서도 잘 인식돼요</div>
      <button type="button" class="pbtn gold" id="qr-zoom-close">닫기</button>
    </div>`;
  ov.classList.add('show');
  $('#qr-zoom-close').onclick = closeQrZoom;
  $('#qr-zoom-close').focus();
}

function openPublishLibraryModal(name, text, count) {
  openModal(`
    <p class="m-title">🏛️ 공개 문제 창고에 등록</p>
    <p class="m-desc">다른 선생님들도 검색해서 수업에 쓸 수 있게 공유해요.</p>
    <form id="pub-form" class="tm-grid" style="margin-top:12px">
      <div class="opt-row"><label>제목</label><input id="pub-title" class="ed-field" style="max-width:66%" maxlength="40" value="${esc(name)}"></div>
      <div class="opt-row"><label>과목</label><select id="pub-subj"><option>상식</option><option>과학</option><option>수학</option><option>사회</option><option>국어</option><option>영어</option><option>정보</option><option>안전</option><option>기타</option></select></div>
      <div class="opt-row"><label>추천 학년</label><select id="pub-grade"><option>전학년</option><option>초등</option><option>중등</option><option>고등</option></select></div>
      <div class="opt-row"><label>작성자 이름</label><input id="pub-author" class="ed-field" style="max-width:66%" maxlength="20" value="선생님" placeholder="예: 엽쌤"></div>
      <div class="opt-row"><label>삭제 비밀번호 (선택)<small>나중에 직접 내릴 때 필요해요</small></label><input id="pub-pin" type="password" class="ed-field" style="max-width:66%" maxlength="12" placeholder="4자리 숫자 등"></div>
      <div class="q-msg" id="pub-msg" style="font-size:14px"></div>
      <div class="m-actions">
        <button type="submit" class="pbtn ok" id="pub-submit">🌐 등록하기 (${count}문제)</button>
        <button type="button" class="pbtn white" id="m-close">취소</button>
      </div>
    </form>`, 'narrow', 'info');
  $('#m-close').onclick = closeModal;
  $('#pub-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#pub-submit');
    btn.disabled = true;
    $('#pub-msg').textContent = '☁️ 공개 창고에 올리는 중...';
    try {
      const cleanText = await inlineIdbImagesInText(text);
      await publishToPublicLibrary({
        title: $('#pub-title').value,
        subject: $('#pub-subj').value,
        grade: $('#pub-grade').value,
        authorAlias: $('#pub-author').value,
        content: cleanText,
        questionCount: count,
        editPin: $('#pub-pin').value.trim()
      });
      closeModal();
      sfx('coin');
      toast('🏛️ 공개 문제 창고에 등록했어요!');
    } catch {
      btn.disabled = false;
      $('#pub-msg').textContent = '⚠️ 등록에 실패했어요. 네트워크 또는 Supabase 테이블 설정을 확인해 주세요.';
    }
  };
}

async function openShareModal(name, rawText, count, forceNew = false) {
  const text = await inlineIdbImagesInText(rawText);
  const token = await encodeSetShare(name, text);
  const baseUrl = location.href.split('#')[0].split('?')[0];
  const offlineUrl = baseUrl + '#set=' + token;
  let cloudResult = null;
  let cloudError = '';
  let reused = false;

  const existing = !forceNew ? findReusableCloudCode(name, text) : null;
  if (existing) {
    cloudResult = { code: existing.code, shareUrl: `${baseUrl}?code=${existing.code}` };
    reused = true;
  } else if (navigator.onLine !== false) {
    try {
      cloudResult = await uploadSharedSet(name, text, count, baseUrl);
      saveMyCloudCode({ code: cloudResult.code, title: name, count, contentHash: hashSetContent(name, text) });
      if (editingId) {
        const sets = savedSets();
        const cur = sets.find(s => s.id === editingId);
        if (cur) { cur.shareCode = cloudResult.code; store('bq_sets', sets); renderSetList(); }
      }
    } catch {
      cloudError = '클라우드 코드 서버가 아직 준비되지 않았거나 오프라인 상태예요. 아래 오프라인 링크·QR로 바로 공유할 수 있어요.';
    }
  } else {
    cloudError = '오프라인 상태라 오프라인 링크·QR 모드로 열었어요.';
  }

  let mode = cloudResult ? 'cloud' : 'offline';
  const renderShareBody = () => {
    const activeUrl = mode === 'cloud' && cloudResult ? cloudResult.shareUrl : offlineUrl;
    const qrSvg = makeQRSvg(activeUrl);
    const qrVer = qrSvg ? +(qrSvg.match(/data-qr-ver="(\d+)"/)?.[1] || 0) : 0;
    openModal(`
      <p class="m-title">🔗 문제 세트 공유하기</p>
      <p class="m-desc">“${esc(name)}” · <b>${count}문제</b></p>
      <div class="share-mode-tabs ed-tabs" style="justify-content:center;margin:10px 0">
        <button type="button" class="${mode === 'cloud' ? 'on' : ''}" data-smode="cloud" ${cloudResult ? '' : 'disabled'}>☁️ 6자리 코드 QR</button>
        <button type="button" class="${mode === 'offline' ? 'on' : ''}" data-smode="offline">📦 오프라인 압축 링크</button>
      </div>
      ${mode === 'cloud' && cloudResult ? `
        <div class="cloud-code-box">
          <div style="font-size:13px;font-weight:800">${reused ? '같은 내용의 기존 코드를 재사용했어요 · ' : ''}학생이 ‘코드 문제’에 입력하거나 QR을 찍으세요</div>
          <div class="cloud-code-val">${esc(cloudResult.code)}</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="pbtn sm gold" id="sh-copy-code">📋 코드 복사</button>
            <button type="button" class="pbtn sm blue" id="sh-analytics">📊 학급 복습 현황</button>
            <button type="button" class="pbtn sm white" id="sh-new-code">🔄 새 코드 발급</button>
          </div>
        </div>` : (cloudError ? `<div class="set-info warn" style="margin:6px 0">${esc(cloudError)}</div>` : '')}
      <div class="share-qr-box">
        ${qrSvg ? `<button type="button" class="share-qr-btn" id="sh-qr-zoom" title="눌러서 크게 보기">${qrSvg}</button>`
          : '<div class="set-info warn" style="width:100%">⚠️ 문제 양이 많아 QR 코드 대신 아래 <b>공유 링크</b>를 복사해서 전달해 주세요!</div>'}
        ${qrSvg && qrVer >= 20 ? '<div class="set-info warn" style="width:100%;text-align:center">💡 문제가 많아 QR 점이 작아요. <b>🔍 QR 크게 보기</b>로 확대하거나 <b>링크 복사</b>를 추천해요!</div>' : ''}
      </div>
      <div class="share-url-row">
        <input id="sh-url" readonly value="${esc(activeUrl)}">
        <button type="button" class="pbtn gold sm" id="sh-copy">📋 링크 복사</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:8px">학생이 QR을 찍거나 코드를 열면 <b>🤖 1인 플레이(vs PC)</b>로 바로 복습할 수 있어요!</p>
      <div class="m-actions">${qrSvg ? '<button type="button" class="pbtn blue" id="sh-zoom-btn">🔍 QR 크게 보기</button>' : ''}<button type="button" class="pbtn ok" id="sh-publish">🏛️ 공개 창고에 등록</button><button type="button" class="pbtn white" id="m-close">닫기</button></div>`, 'narrow', 'info');

    $$('[data-smode]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      mode = b.dataset.smode;
      renderShareBody();
    });
    if ($('#sh-qr-zoom')) $('#sh-qr-zoom').onclick = () => openQrZoom(name, count, qrSvg);
    if ($('#sh-zoom-btn')) $('#sh-zoom-btn').onclick = () => openQrZoom(name, count, qrSvg);
    if ($('#sh-copy-code') && cloudResult) {
      $('#sh-copy-code').onclick = async () => {
        try { await navigator.clipboard.writeText(cloudResult.code); toast(`📋 코드 ${cloudResult.code} 복사 완료!`); }
        catch { toast(`공유 코드: ${cloudResult.code}`); }
      };
    }
    if ($('#sh-analytics') && cloudResult && actions.openAnalyticsModal) {
      $('#sh-analytics').onclick = () => actions.openAnalyticsModal(cloudResult.code, name);
    }
    if ($('#sh-new-code')) $('#sh-new-code').onclick = () => openShareModal(name, text, count, true);
    $('#sh-publish').onclick = () => openPublishLibraryModal(name, text, count);
    $('#sh-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(activeUrl); toast('📋 공유 링크를 복사했어요!'); }
      catch {
        $('#sh-url').select();
        try { document.execCommand('copy'); toast('📋 공유 링크를 복사했어요!'); }
        catch { toast('링크를 선택해 복사해 주세요'); }
      }
    };
    $('#m-close').onclick = closeModal;
  };
  renderShareBody();
}

function renderPrompt() {
  const grade = $('#p-grade').value;
  const topic = $('#p-topic').value.trim() || '(과목과 주제)';
  const n = +$('#p-count').value;
  const type = $('#p-type').value;
  const diff = $('#p-diff').value;
  const withEx = $('#p-explain').checked;
  const mcN = Math.round(n * 0.8);
  const typeLine = {
    mix: `- 객관식 ${mcN}개, 주관식 ${n - mcN}개를 섞어서 만들어 줘.`,
    mc: '- 모든 문제를 객관식(정답 1개 + 오답 3개)으로 만들어 줘.',
    sa: '- 모든 문제를 주관식(단답형)으로 만들어 줘.'
  }[type];
  $('#prompt-out').value =
`너는 ${grade} 학생들을 가르치는 선생님이야.
"${topic}"에 대한 교실 퀴즈 게임용 문제를 ${n}개 만들어 줘.
난이도는 "${diff}"(으)로 해 줘.

[출력 규칙] 아래 규칙을 반드시 지켜 줘.
- 한 줄에 문제 하나씩만 쓰고, 번호·제목·설명·인사말 없이 문제 줄만 출력해.
- 객관식 형식: 문제 | 정답 | 오답1 | 오답2 | 오답3${withEx ? ' | 해설: 한 줄 설명' : ''}
- 주관식 형식: 문제 | 정답${withEx ? ' | 해설: 한 줄 설명' : ''}
${typeLine}
- 칸은 세로 막대(|)로만 나누고, 문제와 보기 안에는 | 기호를 쓰지 마.
- 정답은 짧고 분명하게(한두 단어) 써 줘. 주관식은 답이 하나로 정해지는 문제만 내 줘.
- 오답은 그럴듯하지만 분명히 틀린 것으로 만들어 줘.${withEx ? '\n- 각 줄 맨 끝에 "| 해설: 한 문장 설명"을 꼭 붙여 줘.' : ''}
- 같은 내용의 문제가 겹치지 않게 하고, ${grade} 학생이 이해할 수 있는 쉬운 말로 써 줘.
- 결과는 복사하기 쉽게 코드 블록 하나 안에 넣어 줘.

[예시]
식물이 햇빛을 받아 스스로 양분을 만드는 과정은? | 광합성 | 증산 작용 | 호흡 | 소화${withEx ? ' | 해설: 잎에서 빛을 이용해 양분을 만들어요.' : ''}
우리 몸에서 피를 온몸으로 보내는 기관은? | 심장${withEx ? ' | 해설: 혈액을 온몸으로 순환시키는 펌프 역할을 해요.' : ''}`;
}

export function initEditor() {
  actions.openEditor = openEditor;
  actions.renderSetList = renderSetList;
  actions.closeQrZoom = closeQrZoom;
  actions.renderStorageGauge = renderStorageGauge;

  if ($('#ed-card-search')) {
    $('#ed-card-search').addEventListener('input', e => { cardSearchQ = e.target.value; renderCardEditor(); });
  }
  if ($('#ed-card-type-filter')) {
    $('#ed-card-type-filter').addEventListener('change', e => { cardTypeFilter = e.target.value; renderCardEditor(); });
  }

  $('#ed-cards').addEventListener('dragstart', e => {
    const card = e.target.closest('.ed-card');
    if (!card) return;
    dragCardIdx = +card.dataset.ci;
    card.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  $('#ed-cards').addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.ed-card');
    $$('.ed-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (card && +card.dataset.ci !== dragCardIdx) card.classList.add('drag-over');
  });
  $('#ed-cards').addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.ed-card');
    $$('.ed-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!card || dragCardIdx < 0) return;
    const toIdx = +card.dataset.ci;
    if (toIdx !== dragCardIdx && toIdx >= 0 && toIdx < cardList.length) {
      const [moved] = cardList.splice(dragCardIdx, 1);
      cardList.splice(toIdx, 0, moved);
      syncCardsToText();
      renderCardEditor();
    }
    dragCardIdx = -1;
  });
  $('#ed-cards').addEventListener('dragend', () => {
    dragCardIdx = -1;
    $$('.ed-card.dragging, .ed-card.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
  });

  $('#ed-cards').addEventListener('paste', async e => {
    const card = e.target.closest('.ed-card');
    if (!card) return;
    const items = e.clipboardData && [...(e.clipboardData.items || [])];
    const imgItem = items && items.find(it => it.type && it.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file);
      const ref = await saveImageToIdb(dataUrl);
      cardList[+card.dataset.ci].img = ref;
      syncCardsToText();
      renderCardEditor();
      renderStorageGauge();
      toast('🖼️ 클립보드 그림을 IndexedDB에 압축 저장했어요!');
    } catch {
      toast('⚠️ 그림을 처리하지 못했어요 (파일 크기/형식 확인)');
    }
  });

  $('#ed-img-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || imgUploadIdx < 0 || !cardList[imgUploadIdx]) return;
    try {
      const dataUrl = await compressImageFile(f);
      const ref = await saveImageToIdb(dataUrl);
      cardList[imgUploadIdx].img = ref;
      syncCardsToText();
      renderCardEditor();
      renderStorageGauge();
      toast('🖼️ 그림을 첨부했어요!');
    } catch {
      toast('⚠️ 이미지 파일만 올릴 수 있어요');
    } finally {
      imgUploadIdx = -1;
    }
  });

  $('#ed-cards').addEventListener('input', e => {
    const card = e.target.closest('.ed-card');
    if (!card) return;
    const ci = +card.dataset.ci;
    if (e.target.dataset.cex != null) {
      cardList[ci].extraWrong = cardList[ci].extraWrong || [];
      cardList[ci].extraWrong[+e.target.dataset.cex] = e.target.value;
      syncCardsToText();
      return;
    }
    const f = e.target.dataset.cf;
    if (!f || f === 'type' || f === 'pts') return;
    cardList[ci][f] = e.target.value;
    const c = cardList[ci];
    const inc = !(c.q.trim() && c.a.trim());
    card.classList.toggle('incomplete', inc);
    const w = card.querySelector('.ed-card-warn');
    if (w) w.classList.toggle('hidden', !inc);
    syncCardsToText();
  });

  $('#ed-cards').addEventListener('change', e => {
    const card = e.target.closest('.ed-card');
    if (!card) return;
    const ci = +card.dataset.ci;
    if (e.target.dataset.csel != null) { cardList[ci].selected = e.target.checked; return; }
    if (e.target.dataset.cf === 'type') {
      cardList[ci].isMc = e.target.value === 'mc';
      syncCardsToText();
      renderCardEditor();
      return;
    }
    if (e.target.dataset.cf === 'pts') {
      cardList[ci].pts = Number(e.target.value) || 0;
      syncCardsToText();
    }
  });

  $('#ed-cards').addEventListener('click', e => {
    const mt = e.target.closest('[data-cmoveto]');
    if (mt) { openCardJumpModal(+mt.dataset.cmoveto); return; }
    const iu = e.target.closest('[data-cimgup]');
    if (iu) { imgUploadIdx = +iu.dataset.cimgup; $('#ed-img-file').click(); return; }
    const ic = e.target.closest('[data-cimgclr]');
    if (ic) { cardList[+ic.dataset.cimgclr].img = ''; syncCardsToText(); renderCardEditor(); return; }
    const pv = e.target.closest('[data-cpreview]');
    if (pv) {
      const c = cardList[+pv.dataset.cpreview];
      if (!c || !c.q.trim()) { toast('먼저 문제를 입력해 주세요'); return; }
      const opts = c.isMc ? [c.a, c.w1, c.w2, c.w3, ...(c.extraWrong || [])].map(x => x.trim()).filter(Boolean) : null;
      openQuestionPreview({ q: c.q, a: c.a, opts: opts && opts.length > 1 ? opts : null, explain: c.explain, img: c.img, pts: c.pts }, +pv.dataset.cpreview + 1);
      return;
    }
    const ao = e.target.closest('[data-caddopt]');
    if (ao) {
      const idx = +ao.dataset.caddopt;
      const c = cardList[idx];
      c.extraWrong = c.extraWrong || [];
      if (c.extraWrong.length < 2) {
        c.extraWrong.push('');
        renderCardEditor();
        const inp = $(`.ed-card[data-ci="${idx}"] input[data-cex="${c.extraWrong.length - 1}"]`);
        if (inp) inp.focus();
      }
      return;
    }
    const mv = e.target.closest('[data-cmove]');
    if (mv) {
      const [idx, dir] = mv.dataset.cmove.split(':').map(Number);
      const to = idx + dir;
      if (to >= 0 && to < cardList.length) {
        [cardList[idx], cardList[to]] = [cardList[to], cardList[idx]];
        syncCardsToText();
        renderCardEditor();
      }
      return;
    }
    const b = e.target.closest('[data-cdel]');
    if (!b) return;
    cardList.splice(+b.dataset.cdel, 1);
    syncCardsToText();
    renderCardEditor();
  });

  $('#ed-sel-all').onclick = () => {
    if (!cardList.length) return;
    const allOn = cardList.every(c => c.selected);
    cardList.forEach(c => { c.selected = !allOn; });
    renderCardEditor();
  };
  $('#ed-shuffle-cards').onclick = () => {
    if (cardList.length < 2) return;
    shuffle(cardList);
    syncCardsToText();
    renderCardEditor();
    toast('🔀 카드 순서를 무작위로 섞었어요');
  };
  $('#ed-toggle-type').onclick = () => {
    const picked = cardList.filter(c => c.selected);
    if (!picked.length) { toast('유형을 바꿀 카드를 먼저 체크해 주세요'); return; }
    picked.forEach(c => { c.isMc = !c.isMc; });
    syncCardsToText();
    renderCardEditor();
    sfx('click');
    toast(`🔄 선택한 ${picked.length}개 카드의 유형(객관식↔주관식)을 바꿨어요`);
  };
  $('#ed-del-selected').onclick = async () => {
    const n = cardList.filter(c => c.selected).length;
    if (!n) { toast('삭제할 카드를 먼저 체크해 주세요'); return; }
    if (!(await confirmModal({ title: `선택한 ${n}개 문제를 삭제할까요?`, okText: '삭제', danger: true }))) return;
    cardList = cardList.filter(c => !c.selected);
    syncCardsToText();
    renderCardEditor();
    toast(`🗑️ ${n}개 문제를 삭제했어요`);
  };

  $('#ed-add-card').onclick = () => {
    cardList.push({ q: '', a: '', isMc: true, w1: '', w2: '', w3: '', extraWrong: [], explain: '', img: '', listen: '', pts: 0, selected: false });
    renderCardEditor();
    const last = $('#ed-cards .ed-card:last-child input[data-cf="q"]');
    if (last) { last.focus(); last.scrollIntoView({ block: 'nearest' }); }
  };
  $$('[data-edmode]').forEach(b => b.onclick = async () => {
    const target = b.dataset.edmode;
    if (target === edMode) return;
    if (edMode === 'cards' && target === 'text') {
      const hasAny = c => !!(c.q.trim() || c.a.trim() || c.w1.trim() || c.w2.trim() || c.w3.trim() || (c.extraWrong || []).some(x => x.trim()) || c.explain.trim() || (c.img || '').trim());
      const inc = cardList.filter(c => hasAny(c) && !(c.q.trim() && c.a.trim()));
      if (inc.length && !(await confirmModal({ title: `미완성 카드 ${inc.length}개가 있어요`, desc: '문제와 정답이 모두 채워지지 않은 카드는 텍스트 편집으로 넘어가면 제외됩니다. 계속할까요?', okText: '제외하고 전환', danger: true }))) return;
    }
    setEditorMode(target);
  });

  window.addEventListener('beforeunload', e => {
    if ($('#screen-editor').classList.contains('active') && isEdDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  $('#ed-status').addEventListener('click', e => {
    const b = e.target.closest('.ed-err');
    if (!b) return;
    const line = +b.dataset.line;
    if (!line) return;
    if (edMode !== 'text') setEditorMode('text');
    const ta = $('#ed-text');
    const lines = ta.value.split('\n');
    let start = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) start += lines[i].length + 1;
    const end = start + (lines[line - 1] || '').length;
    ta.focus();
    ta.setSelectionRange(start, end);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.scrollTop = Math.max(0, (line - 3) * lh);
  });

  $('#ed-name').addEventListener('input', refreshDirty);
  $('#ed-text').addEventListener('input', updateEdStatus);
  $('#ed-save').onclick = () => saveEditor();
  $('#ed-use').onclick = () => {
    const id = saveEditor();
    if (!id) return;
    app.setup.settings.setId = id;
    saveSetup();
    if (actions.renderSetup) actions.renderSetup();
    show('setup');
  };
  $('#ed-paste').onclick = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip || !clip.trim()) { toast('클립보드가 비어 있어요'); return; }
      if ($('#ed-text').value.trim() && !(await confirmModal({ title: '클립보드 내용으로 바꿀까요?', desc: '지금 입력되어 있는 문제 대신 클립보드 내용을 넣습니다.' }))) return;
      setEditorMode('text');
      $('#ed-text').value = clip;
      updateEdStatus();
      toast('📋 클립보드에서 붙여넣었어요');
    } catch { toast('브라우저에서 직접 Ctrl+V로 붙여넣어 주세요'); }
  };
  $('#ed-cleanup').onclick = () => {
    const raw = $('#ed-text').value;
    if (!raw.trim()) { toast('정리할 문제 텍스트가 없어요'); return; }
    const res = cleanupQuestionsText(raw);
    $('#ed-text').value = res.text;
    updateEdStatus();
    if (edMode === 'cards') { loadCardsFromText(); renderCardEditor(); }
    sfx('click');
    toast(`🧹 ${res.count}문제 형식을 깔끔하게 정리했어요${res.errorCount ? ` (확인 필요 ${res.errorCount}줄)` : ''}`);
  };
  $('#ed-new').onclick = async () => {
    if (isEdDirty() && !(await confirmModal({ title: '새로 쓰기를 시작할까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
    loadIntoEditor(null);
  };
  $('#ed-sample').onclick = async () => {
    if (isEdDirty() && !(await confirmModal({ title: '예시 문제를 불러올까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
    loadIntoEditor(app.setup.settings.boardSize === 4 ? 'sample4' : 'sample');
  };
  $('#ed-back').onclick = async () => {
    if (isEdDirty() && !(await confirmModal({ title: '저장하지 않고 돌아갈까요?', desc: '수정한 내용이 저장되지 않았습니다.', okText: '그냥 돌아가기', danger: true }))) return;
    if (editorBack === 'setup') { if (actions.renderSetup) actions.renderSetup(); show('setup'); }
    else show('title');
  };

  $('#set-list').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.load) {
      if (isEdDirty() && !(await confirmModal({ title: '이 세트를 불러올까요?', desc: '저장하지 않은 내용은 지워집니다.' }))) return;
      loadIntoEditor(b.dataset.load);
      toast('불러왔어요. 고친 뒤 저장하세요.');
    }
    if (b.dataset.dup) {
      const s = getSet(b.dataset.dup);
      const base = s.name.replace(/\s*\(복사본(?:\s*\d+)?\)$/, '');
      const copyName = (base + ' (복사본)').slice(0, 30);
      const sets = savedSets();
      sets.push({ id: 'set_' + Date.now().toString(36), name: copyName, text: s.text });
      if (!store('bq_sets', sets)) { toast('⚠️ 저장 공간이 부족해 복제하지 못했어요'); return; }
      renderSetList();
      sfx('coin');
      toast(`📋 “${copyName}”으로 복제했어요`);
    }
    if (b.dataset.useset) {
      app.setup.settings.setId = b.dataset.useset;
      saveSetup();
      if (actions.renderSetup) actions.renderSetup();
      show('setup');
      toast('문제 세트를 골랐어요!');
    }
    if (b.dataset.analytics && actions.openAnalyticsModal) actions.openAnalyticsModal(b.dataset.analytics, b.dataset.atitle || '');
    if (b.dataset.del) {
      const s = getSet(b.dataset.del);
      if (!(await confirmModal({ title: `“${s.name}” 세트를 삭제할까요?`, desc: '삭제한 문제 세트는 다시 복구할 수 없어요.', okText: '삭제하기', danger: true }))) return;
      store('bq_sets', savedSets().filter(x => x.id !== s.id));
      if (editingId === s.id) editingId = null;
      renderSetList();
      toast('삭제했어요');
    }
  });

  $('#ed-export').onclick = async () => {
    const raw = $('#ed-text').value;
    if (!raw.trim()) { toast('내보낼 내용이 없어요'); return; }
    const text = await inlineIdbImagesInText(raw);
    const name = ($('#ed-name').value.trim() || '문제세트').replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name + '.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  if ($('#ed-csv-tpl')) {
    $('#ed-csv-tpl').onclick = () => {
      const rows = [
        ['문제', '정답', '오답1', '오답2', '오답3', '해설 또는 배점'],
        ['식물이 햇빛으로 양분을 만드는 과정은?', '광합성', '증산 작용', '호흡', '소화', '해설: 잎에서 양분을 만들어요'],
        ['우리 몸에서 피를 온몸으로 보내는 기관은?', '심장', '', '', '', '배점: 20'],
        ['지구가 스스로 한 바퀴 도는 운동은 자전이다.', 'O', 'X', '', '', '']
      ];
      const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = '\uFEFF' + rows.map(r => r.map(escCsv).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = '빙고퀴즈_문제입력_양식.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('📊 엑셀(.csv) 양식을 내려받았어요');
    };
  }
  $('#ed-import').onclick = () => $('#ed-file').click();

  $('#ed-print').onclick = () => {
    const parsed = parseQuestions($('#ed-text').value).list;
    if (!parsed.length) { toast('인쇄할 문제가 없어요'); return; }
    const name = $('#ed-name').value.trim() || '빙고 퀴즈 학습지';
    const nSide = [3, 4, 5].includes(app.setup.settings.boardSize) ? app.setup.settings.boardSize : 5;
    openModal(`
      <p class="m-title">🖨️ 인쇄 방식 선택</p>
      <p class="m-desc">“${esc(name)}” (${parsed.length}문제)</p>
      <div class="m-actions" style="flex-direction:column;align-items:stretch">
        <button type="button" class="pbtn gold" id="pr-student">📝 학생용 학습지 인쇄 (문제만)</button>
        <button type="button" class="pbtn blue" id="pr-teacher">📋 교사용 학습지 인쇄 (정답·해설 포함)</button>
        <button type="button" class="pbtn ok" id="pr-bingo">🎲 종이 빙고판 인쇄 (${nSide}×${nSide})</button>
        <button type="button" class="pbtn white" id="m-close">닫기</button>
      </div>`, 'narrow', 'info');
    $('#pr-student').onclick = () => { closeModal(); printQuestionSheet({ title: name, subtitle: `총 ${parsed.length}문제 · 학생용`, questions: parsed, includeAnswers: false }); };
    $('#pr-teacher').onclick = () => { closeModal(); printQuestionSheet({ title: name, subtitle: `총 ${parsed.length}문제 · 교사용 정답지`, questions: parsed, includeAnswers: true }); };
    $('#pr-bingo').onclick = () => { closeModal(); printBingoBoard({ title: name, size: nSide, questions: parsed }); };
    $('#m-close').onclick = closeModal;
  };

  $('#sets-backup').onclick = () => {
    const sets = savedSets();
    if (!sets.length) { toast('백업할 저장된 문제 세트가 없어요'); return; }
    const payload = JSON.stringify({ app: 'bingo-quiz', v: 1, exportedAt: new Date().toISOString(), sets }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
    a.download = '빙고퀴즈_문제세트_백업.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(`📦 저장된 세트 ${sets.length}개를 백업했어요`);
  };
  $('#sets-restore').onclick = () => $('#sets-restore-file').click();
  $('#sets-restore-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const res = restoreSetsFromJson(String(r.result));
        if (res.added) { sfx('coin'); toast(`📥 ${res.added}개 세트를 불러왔어요${res.skipped ? ` (중복·빈 항목 ${res.skipped}개 건너뜀)` : ''}`); }
        else toast('새로 추가할 문제 세트가 없어요');
      } catch (err) {
        toast(err && err.message === 'QUOTA' ? '⚠️ 저장 공간이 부족해 불러오지 못했어요' : '올바른 백업(.json) 파일이 아니에요');
      }
    };
    r.readAsText(f, 'utf-8');
    e.target.value = '';
  });
  $('#sets-analytics').onclick = () => { if (actions.openAnalyticsLookupModal) actions.openAnalyticsLookupModal(); };
  $('#qr-zoom-overlay').addEventListener('click', e => { if (e.target === $('#qr-zoom-overlay')) closeQrZoom(); });

  $('#ed-share').onclick = () => {
    const text = $('#ed-text').value;
    const parsed = parseQuestions(text).list;
    if (!parsed.length) { toast('공유할 수 있는 문제가 없어요'); return; }
    const name = $('#ed-name').value.trim() || '공유 문제 세트';
    openShareModal(name, text, parsed.length);
  };

  $('#ed-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      editingId = null;
      $('#ed-name').value = f.name.replace(/\.(txt|csv)$/i, '');
      $('#ed-text').value = String(r.result);
      edSnapshot = '';
      updateEdStatus();
      if (edMode === 'cards') { loadCardsFromText(); renderCardEditor(); }
      toast('파일을 불러왔어요. 저장하기를 눌러 보관하세요.');
    };
    r.readAsText(f, 'utf-8');
    e.target.value = '';
  });

  ['#p-grade', '#p-topic', '#p-count', '#p-type', '#p-diff', '#p-explain'].forEach(s => $(s).addEventListener('input', renderPrompt));
  $('#p-copy').onclick = async () => {
    const ta = $('#prompt-out');
    const text = ta.value;
    try { await navigator.clipboard.writeText(text); toast('📋 프롬프트를 복사했어요!'); }
    catch {
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); toast('📋 프롬프트를 복사했어요!'); }
      catch { toast('복사가 안 되면 글을 직접 선택해서 복사해 주세요'); }
    }
  };
}
