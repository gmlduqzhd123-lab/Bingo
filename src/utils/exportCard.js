function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function exportResultCardPng({ setName = '빙고 퀴즈', boardSize = 5, headline = '🏆 최종 결과', theme = 'forest', standings = [] }) {
  const W = 1200;
  const H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const palettes = {
    forest: ['#fef3c7', '#fde68a', '#2b1d0e', '#fffaf0'],
    ocean: ['#0284c7', '#0f172a', '#ffffff', '#e0f2fe'],
    space: ['#1e1b4b', '#0f172a', '#f8fafc', '#1e293b'],
    chalkboard: ['#14532d', '#052e16', '#f8fafc', '#166534']
  };
  const [c1, c2, tx, cardBg] = palettes[theme] || palettes.forest;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Outer card frame
  ctx.fillStyle = cardBg;
  roundRect(ctx, 42, 36, W - 84, H - 72, 28);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = theme === 'space' || theme === 'chalkboard' ? '#fbbf24' : '#2b1d0e';
  ctx.stroke();

  const innerTx = theme === 'space' || theme === 'chalkboard' ? '#f8fafc' : '#1f160c';
  const mutedTx = theme === 'space' || theme === 'chalkboard' ? '#cbd5e1' : '#6b5a42';

  // Header
  ctx.textAlign = 'center';
  ctx.fillStyle = innerTx;
  ctx.font = '900 44px "Pretendard","Noto Sans KR",system-ui,sans-serif';
  ctx.fillText(headline.slice(0, 26), W / 2, 108);

  ctx.fillStyle = mutedTx;
  ctx.font = '700 22px "Pretendard","Noto Sans KR",system-ui,sans-serif';
  const today = new Date().toLocaleDateString('ko-KR');
  ctx.fillText(`${setName} · ${boardSize}×${boardSize} 빙고 · ${today}`, W / 2, 148);

  // Standings cards (up to 6)
  const list = standings.slice(0, 6);
  const cols = list.length <= 3 ? list.length : Math.min(3, Math.ceil(list.length / 2));
  const gap = 22;
  const areaW = W - 160;
  const cardW = Math.min(310, Math.floor((areaW - gap * (cols - 1)) / Math.max(1, cols)));
  const rowsCount = Math.ceil(list.length / Math.max(1, cols));
  const cardH = rowsCount === 1 ? 290 : 182;
  const startY = rowsCount === 1 ? 195 : 182;
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '🎖️', 5: '🎖️', 6: '🎖️' };

  list.forEach((st, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const itemsInRow = row === rowsCount - 1 ? (list.length - row * cols) : cols;
    const rowW = itemsInRow * cardW + (itemsInRow - 1) * gap;
    const x0 = (W - rowW) / 2 + col * (cardW + gap);
    const y0 = startY + row * (cardH + 18);

    ctx.fillStyle = theme === 'space' || theme === 'chalkboard' ? 'rgba(15,23,42,0.85)' : '#ffffff';
    roundRect(ctx, x0, y0, cardW, cardH, 20);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = st.color || '#f59e0b';
    ctx.stroke();

    // Color header strip
    ctx.fillStyle = st.color || '#f59e0b';
    roundRect(ctx, x0, y0, cardW, 44, 16);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 21px "Pretendard","Noto Sans KR",system-ui,sans-serif';
    ctx.fillText(`${medals[st.rank] || '🎖️'} ${st.rank}위 · ${st.emoji || ''} ${String(st.name || '').slice(0, 8)}`, x0 + cardW / 2, y0 + 30);

    ctx.fillStyle = innerTx;
    ctx.font = '900 40px "Pretendard","Noto Sans KR",system-ui,sans-serif';
    ctx.fillText(`${st.score}점`, x0 + cardW / 2, y0 + (rowsCount === 1 ? 128 : 102));

    ctx.fillStyle = mutedTx;
    ctx.font = '700 18px "Pretendard","Noto Sans KR",system-ui,sans-serif';
    ctx.fillText(`땅 ${st.tiles}칸 · 빙고 ${st.bingos}줄`, x0 + cardW / 2, y0 + (rowsCount === 1 ? 172 : 134));

    if (st.award) {
      ctx.fillStyle = '#d97706';
      ctx.font = '800 18px "Pretendard","Noto Sans KR",system-ui,sans-serif';
      ctx.fillText(st.award.slice(0, 18), x0 + cardW / 2, y0 + (rowsCount === 1 ? 226 : 164));
    }
  });

  // Footer
  ctx.fillStyle = mutedTx;
  ctx.font = '700 17px "Pretendard","Noto Sans KR",system-ui,sans-serif';
  ctx.fillText(`빙고 땅따먹기 퀴즈 · 엽쌤 교실 퀴즈 앱 (${tx ? '' : ''}gmlduqzhd123-lab.github.io/Bingo)`, W / 2, H - 56);

  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = dataUrl;
  a.download = `빙고퀴즈_결과카드_${ymd}.png`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 500);
  return true;
}
