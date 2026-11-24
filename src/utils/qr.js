function bytesToB64Url(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 4096) bin += String.fromCharCode(...u8.subarray(i, i + 4096));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function encodeSetShare(name, text) {
  const compactText = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => (l.includes('|') ? l.split('|').map(p => p.trim()).join('|') : l))
    .join('\n');
  const raw = new TextEncoder().encode(JSON.stringify({ n: name, t: compactText }));
  if (typeof CompressionStream === 'function') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(raw);
      w.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return 'z1.' + bytesToB64Url(new Uint8Array(buf));
    } catch {}
  }
  return 'u1.' + bytesToB64Url(raw);
}

export async function decodeSetShare(token) {
  if (token.startsWith('z1.') && typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(b64UrlToBytes(token.slice(3)));
    w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  if (token.startsWith('u1.')) return JSON.parse(new TextDecoder().decode(b64UrlToBytes(token.slice(3))));
  throw new Error('Invalid share token');
}

export const makeQRSvg = (() => {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const rsGen = ec => {
    let g = [1];
    for (let i = 0; i < ec; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  };
  const rsRem = (data, ec) => {
    const gen = rsGen(ec);
    const res = new Uint8Array(data.length + ec);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const c = res[i];
      if (c) for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], c);
    }
    return res.slice(data.length);
  };
  const VT = [
    [26,7,1,19,0,0],[44,10,1,34,0,0],[70,15,1,55,0,0],[100,20,1,80,0,0],[134,26,1,108,0,0],
    [172,18,2,68,0,0],[196,20,2,78,0,0],[242,24,2,97,0,0],[292,30,2,116,0,0],[346,18,2,68,2,69],
    [404,20,4,81,0,0],[466,24,2,92,2,93],[532,26,4,107,0,0],[581,30,3,115,1,116],[655,22,5,87,1,88],
    [733,24,5,98,1,99],[815,28,1,107,5,108],[901,30,5,120,1,121],[991,28,3,113,4,114],[1085,28,3,107,5,108],
    [1156,28,4,116,4,117],[1258,28,2,111,7,112],[1364,30,4,121,5,122],[1474,30,6,117,4,118],[1588,26,8,106,4,107],
    [1706,28,10,114,2,115],[1828,30,8,122,4,123],[1921,30,3,117,10,118],[2051,30,7,116,7,117],[2185,30,5,115,10,116],
    [2323,30,13,115,3,116],[2465,30,17,115,0,0],[2611,30,17,115,1,116],[2761,30,13,115,6,116],[2876,30,12,121,7,122],
    [3034,30,6,121,14,122],[3196,30,17,122,4,123],[3362,30,4,122,18,123],[3532,30,20,117,4,118],[3706,30,19,118,6,119]
  ];
  const AL = [
    [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],
    [6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
    [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],
    [6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
    [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],
    [6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
  ];
  const MASKS = [
    (r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => ((r >> 1) + ((c / 3) | 0)) % 2 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r, c) => (((r * c) % 2 + (r * c) % 3) % 2) === 0, (r, c) => (((r + c) % 2 + (r * c) % 3) % 2) === 0
  ];
  function penalty(m, N) {
    let p = 0;
    let dark = 0;
    for (let r = 0; r < N; r++) {
      let runR = 1;
      let runC = 1;
      for (let c = 0; c < N; c++) {
        if (m[r][c]) dark++;
        if (c) {
          if (m[r][c] === m[r][c - 1]) runR++;
          else { if (runR >= 5) p += 3 + runR - 5; runR = 1; }
          if (m[c][r] === m[c - 1][r]) runC++;
          else { if (runC >= 5) p += 3 + runC - 5; runC = 1; }
        }
        if (r < N - 1 && c < N - 1 && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
      }
      if (runR >= 5) p += 3 + runR - 5;
      if (runC >= 5) p += 3 + runC - 5;
      for (let c = 0; c <= N - 11; c++) {
        const h = m[r].slice(c, c + 11).join('');
        const v = Array.from({ length: 11 }, (_, k) => m[c + k][r]).join('');
        if (h === '10111010000' || h === '00001011101') p += 40;
        if (v === '10111010000' || v === '00001011101') p += 40;
      }
    }
    const pct = (dark * 100) / (N * N);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }
  return function (str) {
    const bytes = new TextEncoder().encode(str);
    let ver = -1;
    for (let v = 1; v <= 40; v++) {
      const [, , g1b, g1d, g2b, g2d] = VT[v - 1];
      const cap = g1b * g1d + g2b * g2d;
      const cc = v < 10 ? 8 : 16;
      if (4 + cc + bytes.length * 8 <= cap * 8) { ver = v; break; }
    }
    if (ver < 0) return null;
    const [, ecCW, g1b, g1d, g2b, g2d] = VT[ver - 1];
    const dataCap = g1b * g1d + g2b * g2d;
    const cc = ver < 10 ? 8 : 16;
    const bits = [];
    const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    pushBits(4, 4);
    pushBits(bytes.length, cc);
    bytes.forEach(b => pushBits(b, 8));
    for (let i = 0; i < 4 && bits.length < dataCap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const dataCW = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      dataCW.push(b);
    }
    for (let k = 0; dataCW.length < dataCap; k++) dataCW.push(k % 2 ? 0x11 : 0xec);
    const blocks = [];
    const ecs = [];
    let off = 0;
    for (let i = 0; i < g1b; i++) { const d = dataCW.slice(off, off + g1d); off += g1d; blocks.push(d); ecs.push(rsRem(d, ecCW)); }
    for (let i = 0; i < g2b; i++) { const d = dataCW.slice(off, off + g2d); off += g2d; blocks.push(d); ecs.push(rsRem(d, ecCW)); }
    const finalCW = [];
    const maxD = Math.max(g1d, g2d || 0);
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.length) finalCW.push(b[i]); });
    for (let i = 0; i < ecCW; i++) ecs.forEach(e => finalCW.push(e[i]));
    const N = ver * 4 + 17;
    const res = Array.from({ length: N }, () => new Uint8Array(N));
    const base = Array.from({ length: N }, () => new Uint8Array(N));
    const set = (r, c, v) => { base[r][c] = v ? 1 : 0; res[r][c] = 1; };
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = r0 + dr;
          const c = c0 + dc;
          if (r < 0 || r >= N || c < 0 || c >= N) continue;
          const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          set(r, c, on ? 1 : 0);
        }
      }
    };
    finder(0, 0);
    finder(0, N - 7);
    finder(N - 7, 0);
    for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const ap = AL[ver - 1];
    for (const r0 of ap) {
      for (const c0 of ap) {
        if ((r0 < 9 && c0 < 9) || (r0 < 9 && c0 > N - 10) || (r0 > N - 10 && c0 < 9)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const on = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            set(r0 + dr, c0 + dc, on ? 1 : 0);
          }
        }
      }
    }
    for (let i = 0; i < 9; i++) {
      if (i !== 6) { res[8][i] = 1; res[i][8] = 1; }
      if (i < 8) res[8][N - 1 - i] = 1;
      if (i < 7) res[N - 1 - i][8] = 1;
    }
    set(N - 8, 8, 1);
    if (ver >= 7) {
      let rem = ver << 12;
      for (let i = 5; i >= 0; i--) if ((rem >> (i + 12)) & 1) rem ^= 0x1f25 << i;
      const vb = (ver << 12) | rem;
      for (let idx = 0; idx < 18; idx++) {
        const b = (vb >> idx) & 1;
        set(N - 11 + (idx % 3), (idx / 3) | 0, b);
        set((idx / 3) | 0, N - 11 + (idx % 3), b);
      }
    }
    let bestP = 1e9;
    let bestMat = null;
    for (let mk = 0; mk < 8; mk++) {
      const m = base.map(row => row.slice());
      const mf = MASKS[mk];
      let bi = 0;
      let dir = -1;
      let r = N - 1;
      for (let c = N - 1; c > 0; c -= 2) {
        if (c === 6) c--;
        while (r >= 0 && r < N) {
          for (let dc = 0; dc < 2; dc++) {
            const cc2 = c - dc;
            if (!res[r][cc2]) {
              let b = bi < finalCW.length * 8 ? (finalCW[bi >> 3] >> (7 - (bi & 7))) & 1 : 0;
              bi++;
              if (mf(r, cc2)) b ^= 1;
              m[r][cc2] = b;
            }
          }
          r += dir;
        }
        dir = -dir;
        r += dir;
      }
      const d = (1 << 3) | mk;
      let rem = d << 10;
      for (let i = 4; i >= 0; i--) if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
      const fmt = ((d << 10) | rem) ^ 0x5412;
      const c1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
      const c2 = [[N-1,8],[N-2,8],[N-3,8],[N-4,8],[N-5,8],[N-6,8],[N-7,8],[8,N-8],[8,N-7],[8,N-6],[8,N-5],[8,N-4],[8,N-3],[8,N-2],[8,N-1]];
      for (let i = 0; i < 15; i++) {
        const b = (fmt >> (14 - i)) & 1;
        m[c1[i][0]][c1[i][1]] = b;
        m[c2[i][0]][c2[i][1]] = b;
      }
      const p = penalty(m, N);
      if (p < bestP) { bestP = p; bestMat = m; }
    }
    let pathD = '';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (bestMat[r][c]) pathD += `M${c + 4} ${r + 4}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" data-qr-ver="${ver}" viewBox="0 0 ${N + 8} ${N + 8}" shape-rendering="crispEdges"><rect width="${N + 8}" height="${N + 8}" fill="#fff"/><path d="${pathD}" fill="#111"/></svg>`;
  };
})();
