import { TEAM_PRESETS } from './data/sets.js';
import { parseQuestions } from './core/questions.js';
import { load, loadWrongBank } from './utils/storage.js';
import { AU, ac, sfx, bgmStart } from './utils/audio.js';
import { decodeSetShare } from './utils/qr.js';
import { normalizeCode, fetchSharedSet } from './utils/cloud.js';
import { normalizeRoomCode } from './utils/realtime.js';
import {
  $,
  $$,
  esc,
  app,
  actions,
  applyTheme,
  applyMotion,
  show,
  toast,
  trapTab,
  closeModal,
  finishConfirm,
  confirmModal,
  saveSetup,
  initSharedUI
} from './ui/shared.js';
import { initSetup, renderSetup, setAdvOpen, closeEmoPicker } from './ui/setup.js';
import { initEditor, openEditor, closeQrZoom } from './ui/editor.js';
import { initLive, openLiveJoinModal } from './ui/live.js';
import {
  initModals,
  openSharedSetPrompt,
  openCodeJoinModal,
  openPublicLibraryModal,
  openHallOfFameModal,
  openWeakBankModal,
  openHowto
} from './ui/modals.js';
import { initGame, startGame, resumeGame, render, renderTop, toggleFullscreen } from './ui/game.js';

initSharedUI();
initSetup();
initEditor();
initLive();
initModals();
initGame();

function refreshTitle() {
  const s = load('bq_save', null);
  const btn = $('#btn-continue');
  if (s && !s.over && Array.isArray(s.tiles) && s.tiles.length) {
    const n = s.size || Math.round(Math.sqrt(s.tiles.length)) || 5;
    const left = s.tiles.filter(t => !t.opened).length;
    const isSolo = s.settings?.playMode === 'solo' || (Array.isArray(s.teams) && s.teams.some(t => t.isAI));
    btn.innerHTML = `<span>⏯ 이어하기</span><span class="cont-meta">${isSolo ? '🤖 1인 vs PC · ' : ''}${esc(s.setName || '진행 중인 게임')} · ${n}×${n} · ${s.round || 1}라운드 · 남은 ${left}칸</span>`;
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
  const wbBtn = $('#btn-weak-bank');
  if (wbBtn) {
    const wbCnt = loadWrongBank().length;
    wbBtn.classList.toggle('hidden', wbCnt === 0);
    if (wbCnt > 0) wbBtn.textContent = `🔥 내 약점 문제 복습 (${wbCnt})`;
  }
}
actions.refreshTitle = refreshTitle;

$('#title-blocks').innerHTML = '<div class="tile closed"></div>' + TEAM_PRESETS.slice(0, 4).map((t, k) => `<div class="tile owned pat${k}" style="--f:${t.color};--s:${t.dark}"><span class="temo">${t.emoji}</span></div>`).join('');
$('#btn-new').onclick = () => { sfx('click'); ac(); app.setup.settings.playMode = 'team'; saveSetup(); setAdvOpen(false); renderSetup(); show('setup'); };
$('#btn-solo').onclick = () => { sfx('click'); ac(); app.setup.settings.playMode = 'solo'; saveSetup(); setAdvOpen(false); renderSetup(); show('setup'); };
$('#btn-continue').onclick = () => { sfx('click'); resumeGame(); };
if ($('#btn-weak-bank')) $('#btn-weak-bank').onclick = () => { sfx('click'); openWeakBankModal(); };
$('#btn-code-join').onclick = $('#btn-code-join2').onclick = () => { sfx('click'); openCodeJoinModal(); };
$('#btn-live-join').onclick = () => { sfx('click'); openLiveJoinModal(); };
$('#btn-library').onclick = $('#btn-library2').onclick = () => { sfx('click'); openPublicLibraryModal(); };
$('#btn-hof').onclick = $('#r-hof-view').onclick = () => { sfx('click'); openHallOfFameModal(); };
$('#btn-editor').onclick = () => { sfx('click'); openEditor('title'); };
$('#btn-editor2').onclick = () => { sfx('click'); openEditor('setup'); };
$('#btn-howto').onclick = $('#btn-howto2').onclick = () => { sfx('click'); openHowto(); };
$$('[data-go]').forEach(b => b.onclick = () => { sfx('click'); show(b.dataset.go); });

$('#btn-start').onclick = async () => {
  const old = load('bq_save', null);
  if (old && !old.over && old.tiles && !(await confirmModal({ title: '새 게임을 시작할까요?', desc: '진행 중이던 이전 게임 기록은 지워집니다.', okText: '새 게임 시작', danger: true }))) return;
  ac();
  startGame();
};

document.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    if ($('#qr-zoom-overlay').classList.contains('show')) { trapTab(e, $('#qr-zoom-overlay')); return; }
    if ($('#confirm-modal').classList.contains('show')) { trapTab(e, $('#confirm-modal .cf-box')); return; }
    if ($('#modal').classList.contains('show')) { trapTab(e, $('#modal-box')); return; }
  }
  if ($('#qr-zoom-overlay').classList.contains('show')) {
    if (e.key === 'Escape') { e.preventDefault(); closeQrZoom(); }
    return;
  }
  if ($('#confirm-modal').classList.contains('show')) {
    if (e.key === 'Enter') { e.preventDefault(); finishConfirm(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishConfirm(false); }
    return;
  }
  if ($('#announce').classList.contains('show')) {
    if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); if (app.annFinish) app.annFinish(); }
    return;
  }
  if (e.key === 'Escape' && $('#emo-picker').classList.contains('show')) { closeEmoPicker(); return; }
  if (e.key === 'Escape' && e.target && e.target.id === 'q-sa-input') {
    const c = $('#q-cancel');
    if (c && !c.disabled) { e.preventDefault(); c.click(); }
    return;
  }
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

  const S = app.S;
  if ($('#modal').classList.contains('show')) {
    const aiTurn = !!(S && S.teams[S.turn] && S.teams[S.turn].isAI);
    if (aiTurn && app.modalType !== 'info' && app.modalType !== 'manage' && app.modalType !== 'settings') {
      if (e.key === ' ' || e.key === 'Enter') { const sk = $('#ai-skip'); if (sk) { e.preventDefault(); sk.click(); } }
      return;
    }
    if (app.modalType === 'question') {
      const nextBtn = $('#q-next');
      if (nextBtn) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextBtn.click(); } return; }
      const ovOk = $('#q-sa-override');
      const ovNo = $('#q-sa-confirm-no');
      if (ovOk || ovNo) {
        if ((e.key === 'o' || e.key === 'O') && ovOk) { e.preventDefault(); ovOk.click(); return; }
        if ((e.key === 'x' || e.key === 'X') && ovNo) { e.preventDefault(); ovNo.click(); return; }
      }
      if (/^[1-6]$/.test(e.key)) { const b = $(`.q-opt[data-k="${+e.key - 1}"]`); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
      if (e.key === ' ') { const r = $('#q-reveal'); if (r && !r.disabled) { e.preventDefault(); r.click(); } return; }
      if (e.key === 'o' || e.key === 'O') { const ok = $('#q-ok'); if (ok && !ok.disabled) { e.preventDefault(); ok.click(); } return; }
      if (e.key === 'x' || e.key === 'X') { const no = $('#q-no'); if (no && !no.disabled) { e.preventDefault(); no.click(); } return; }
      if (e.key === 'p' || e.key === 'P') { const ps = $('#q-pause'); if (ps && !ps.disabled) { e.preventDefault(); ps.click(); } return; }
      if (e.key === '+' || e.key === '=') { const p10 = $('#q-plus10'); if (p10 && !p10.disabled) { e.preventDefault(); p10.click(); } return; }
      if (e.key === 'Escape') { const c = $('#q-cancel'); if (c && !c.disabled) { e.preventDefault(); c.click(); } }
      return;
    }
    if (app.modalType === 'cards' && !aiTurn) {
      const ok = $('#card-ok');
      if (ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ok.click(); return; }
      if (/^[1-3]$/.test(e.key)) { const c = $(`.card[data-k="${+e.key - 1}"]`); if (c && !c.disabled) { e.preventDefault(); c.click(); } return; }
      return;
    }
    if (app.modalType === 'teampick' && !aiTurn) {
      if (/^[1-5]$/.test(e.key)) { const btns = $$('.team-pick [data-t]'); if (btns[+e.key - 1]) { e.preventDefault(); btns[+e.key - 1].click(); } }
      return;
    }
    if (app.modalType === 'dice' || app.modalType === 'mission') {
      if (e.key === 'Enter' || e.key === ' ') { const b = $('#dice-ok') || $('#mission-ok'); if (b && !b.closest('.hidden')) { e.preventDefault(); b.click(); } }
      return;
    }
    if (e.key === 'Escape' && (app.modalType === 'info' || app.modalType === 'manage' || app.modalType === 'settings')) closeModal();
    return;
  }

  if ($('#screen-game').classList.contains('active') && S) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const tiles = $$('#board .tile');
      if (!tiles.length) return;
      e.preventDefault();
      const cur = document.activeElement && document.activeElement.closest('#board .tile');
      const N = Math.round(Math.sqrt(S.tiles.length)) || 5;
      const idx = cur ? +cur.dataset.i : -1;
      if (idx < 0) {
        const target = tiles.find(t => t.classList.contains('target') || t.classList.contains('closed')) || tiles[0];
        target.focus();
        return;
      }
      const r = (idx / N) | 0;
      const c = idx % N;
      let nr = r;
      let nc = c;
      if (e.key === 'ArrowUp') nr = (r - 1 + N) % N;
      else if (e.key === 'ArrowDown') nr = (r + 1) % N;
      else if (e.key === 'ArrowLeft') nc = (c - 1 + N) % N;
      else if (e.key === 'ArrowRight') nc = (c + 1) % N;
      if (tiles[nr * N + nc]) tiles[nr * N + nc].focus();
      return;
    }
    if (e.key === 'Escape' && S.pending && S.pending.type === 'bomb' && S.pending.aim != null) { delete S.pending.aim; render(); return; }
    if ((e.key === 'z' || e.key === 'Z') && !app.busy) { e.preventDefault(); $('#g-undo').click(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  }
});

async function checkSharedLaunch() {
  const params = new URLSearchParams(location.search || '');
  const roomParam = normalizeRoomCode(params.get('room') || '');
  if (roomParam) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    openLiveJoinModal();
    setTimeout(() => {
      const inp = $('#lj-code');
      if (inp) inp.value = roomParam;
    }, 30);
    return;
  }

  const codeParam = normalizeCode(params.get('code') || '');
  if (codeParam) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    try {
      const row = await fetchSharedSet(codeParam);
      if (row) {
        await openSharedSetPrompt({ name: row.title, rawText: row.content, count: row.question_count, shareCode: row.code });
        return;
      }
      toast(`❌ 공유 코드(${codeParam})를 찾을 수 없어요`);
    } catch {
      toast('⚠️ 공유 코드를 불러오지 못했어요 (네트워크 확인)');
    }
  }

  const h = location.hash || '';
  if (!h.startsWith('#set=')) return;
  const token = h.slice(5);
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  try {
    const payload = await decodeSetShare(token);
    const name = String(payload?.n || '공유 문제 세트').trim().slice(0, 30) || '공유 문제 세트';
    const rawText = String(payload?.t || '');
    const parsed = parseQuestions(rawText).list;
    await openSharedSetPrompt({ name, rawText, count: parsed.length });
  } catch {
    toast('공유 링크가 손상되었거나 지원되지 않아요');
  }
}

function syncOnlineBadge() {
  const pill = $('#offline-pill');
  if (pill) pill.classList.toggle('hidden', navigator.onLine !== false);
}
window.addEventListener('online', syncOnlineBadge);
window.addEventListener('offline', syncOnlineBadge);
syncOnlineBadge();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const showUpdate = worker => {
        const banner = $('#pwa-banner');
        if (!banner || !worker) return;
        banner.classList.remove('hidden');
        $('#pwa-apply').onclick = () => { worker.postMessage({ type: 'SKIP_WAITING' }); };
        $('#pwa-dismiss').onclick = () => banner.classList.add('hidden');
      };
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    } catch {}
  });
}

if (AU.bgm) {
  const startSavedBgm = () => { if (AU.bgm && !AU.timer) bgmStart(); };
  window.addEventListener('pointerdown', startSavedBgm, { once: true });
  window.addEventListener('keydown', startSavedBgm, { once: true });
}
window.addEventListener('hashchange', checkSharedLaunch);
applyTheme(app.setup.settings.theme);
applyMotion(app.setup.settings.reduceMotion);
renderSetup();
refreshTitle();
checkSharedLaunch();
