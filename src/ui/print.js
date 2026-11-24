import { formatRichText } from '../core/questions.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function printQuestionSheet({ title, subtitle = '', questions = [], includeAnswers = true }) {
  const sheet = document.getElementById('print-sheet');
  if (!sheet || !questions.length) return false;
  const itemsHtml = questions.map((item, idx) => {
    const optsHtml = item.opts && item.opts.length > 1
      ? `<div class="pr-opts">${item.opts.map((o, k) => `<div>${'①②③④⑤⑥'[k] || k + 1 + '.'} ${formatRichText(o)}</div>`).join('')}</div>`
      : '<div class="pr-blank"></div>';
    return `<div class="pr-item"><div class="pr-q">${idx + 1}. ${formatRichText(item.q)}</div>${optsHtml}</div>`;
  }).join('');

  const keyHtml = includeAnswers
    ? `<div class="pr-key"><h2>정답 및 해설</h2>${questions.map((item, idx) => `<div class="pr-key-item"><b>${idx + 1}.</b> ${formatRichText(item.a)}${item.explain ? ` — <i>${formatRichText(item.explain)}</i>` : ''}</div>`).join('')}</div>`
    : '';

  sheet.innerHTML = `
    <div class="pr-head">
      <h1>${esc(title || '빙고 퀴즈 학습지')}</h1>
      <p>${esc(subtitle || `총 ${questions.length}문제 · 빙고 땅따먹기 퀴즈`)}</p>
    </div>
    ${itemsHtml}
    ${keyHtml}
  `;
  window.print();
  return true;
}

export function printBingoBoard({ title, size = 5, questions = [] }) {
  const sheet = document.getElementById('print-sheet');
  if (!sheet) return false;
  const N = [3, 4, 5].includes(size) ? size : 5;
  const total = N * N;
  const cells = Array.from({ length: total }, (_, i) => {
    const q = questions[i];
    const snippet = q ? esc(q.q.length > 42 ? q.q.slice(0, 41) + '…' : q.q) : '🍀 행운 칸 (보너스)';
    return `<div class="pr-bingo-cell"><span class="pr-bingo-num">${i + 1}</span><div class="pr-bingo-q">${snippet}</div><div class="pr-bingo-mark">이름/표시: ________</div></div>`;
  }).join('');

  sheet.innerHTML = `
    <div class="pr-head">
      <h1>${esc(title || '종이 빙고판')} (${N}×${N})</h1>
      <p>모둠/이름: ____________________ · 날짜: ____년 __월 __일</p>
    </div>
    <div class="pr-bingo-grid" style="--pn:${N}">${cells}</div>
  `;
  window.print();
  return true;
}
