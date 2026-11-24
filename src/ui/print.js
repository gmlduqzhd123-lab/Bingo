const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function printQuestionSheet({ title, subtitle = '', questions = [], includeAnswers = true }) {
  const sheet = document.getElementById('print-sheet');
  if (!sheet || !questions.length) return false;
  const itemsHtml = questions.map((item, idx) => {
    const optsHtml = item.opts && item.opts.length > 1
      ? `<div class="pr-opts">${item.opts.map((o, k) => `<div>${'①②③④⑤⑥'[k] || k + 1 + '.'} ${esc(o)}</div>`).join('')}</div>`
      : '<div class="pr-blank"></div>';
    return `<div class="pr-item"><div class="pr-q">${idx + 1}. ${esc(item.q)}</div>${optsHtml}</div>`;
  }).join('');

  const keyHtml = includeAnswers
    ? `<div class="pr-key"><h2>정답 및 해설</h2>${questions.map((item, idx) => `<div class="pr-key-item"><b>${idx + 1}.</b> ${esc(item.a)}${item.explain ? ` — <i>${esc(item.explain)}</i>` : ''}</div>`).join('')}</div>`
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
