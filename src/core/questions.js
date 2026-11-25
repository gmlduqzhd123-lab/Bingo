export function isSafeImageUrl(url) {
  const s = String(url || '').trim();
  if (!s || s.length > 200000) return false;
  if (/^idb:\/\/[a-zA-Z0-9_-]{4,64}$/.test(s)) return true;
  if (/^https?:\/\/\S+$/i.test(s)) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(s)) return true;
  return false;
}

export function normalizeOX(val) {
  const s = String(val || '').trim().toUpperCase();
  if (s === 'O' || s === '⭕' || s === '참' || s === 'TRUE') return 'O';
  if (s === 'X' || s === '❌' || s === '거짓' || s === 'FALSE') return 'X';
  return '';
}

export function isOXQuestion(qObj) {
  if (!qObj) return false;
  const aOx = normalizeOX(qObj.a);
  if (!aOx) return false;
  if (!Array.isArray(qObj.opts) || !qObj.opts.length) return true;
  return qObj.opts.length === 2 && qObj.opts.every(o => !!normalizeOX(o));
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function parseQuestions(text) {
  const list = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('```') || line.startsWith('//')) return;
    if (/^[-:|\s\t]+$/.test(line)) return;

    let parts;
    if (line.includes('|')) {
      parts = line.split('|').map(s => s.trim()).filter(s => s !== '');
    } else if (line.includes('\t')) {
      parts = line.split('\t').map(s => s.trim()).filter(s => s !== '');
    } else {
      const csv = line.includes(',') ? splitCsvLine(line) : [];
      if (csv.length >= 2) {
        parts = csv;
      } else {
        errors.push({ line: i + 1, msg: `${i + 1}번째 줄: | 또는 탭 구분자가 없어 건너뛰었어요 → “${line.slice(0, 22)}”` });
        return;
      }
    }

    if (parts.length && /^(문제|질문)$/.test(parts[0])) return;

    let explain = '';
    let img = '';
    let listen = '';
    let pts = 0;
    let diff = '';
    for (let k = 0; k < 4 && parts.length >= 3; k++) {
      const tail = parts[parts.length - 1];
      const em = tail.match(/^(?:해설|설명)\s*[:：]\s*(.+)$/);
      if (em && !explain) {
        explain = em[1].trim();
        parts.pop();
        continue;
      }
      const im = tail.match(/^(?:이미지|그림|img)\s*[:：]\s*(.+)$/i);
      if (im && !img) {
        const candidate = im[1].trim();
        if (isSafeImageUrl(candidate)) img = candidate;
        parts.pop();
        continue;
      }
      const lm = tail.match(/^(?:듣기|음성|listen)\s*(?:[:：]\s*(.*))?$/i);
      if (lm && !listen) {
        listen = (lm[1] || '').trim() || 'auto';
        parts.pop();
        continue;
      }
      const pm = tail.match(/^(?:배점|점수|pts)\s*[:：]\s*(\d+)\s*점?$/i);
      if (pm && !pts) {
        const pv = Math.max(5, Math.min(100, Number(pm[1]) || 0));
        if (pv > 0) pts = pv;
        parts.pop();
        continue;
      }
      const dm = tail.match(/^(?:난이도|diff)\s*[:：]\s*(하|중|상|쉬움|보통|어려움|easy|mid|hard)$/i);
      if (dm && !diff) {
        const rawD = dm[1].toLowerCase();
        diff = (rawD === '하' || rawD === '쉬움' || rawD === 'easy') ? 'easy' : (rawD === '상' || rawD === '어려움' || rawD === 'hard') ? 'hard' : 'mid';
        parts.pop();
        continue;
      }
      break;
    }
    if (!pts && diff) pts = diff === 'hard' ? 30 : diff === 'mid' ? 20 : 10;

    if (parts.length < 2) {
      errors.push({ line: i + 1, msg: `${i + 1}번째 줄: 정답이 없어요` });
      return;
    }
    parts[0] = parts[0].replace(/^(?:[-*•]\s*|\d+\s*[.)]\s*|Q\s*\d*\s*[.:)]\s*|문제\s*\d+\s*[.:)]\s*)/i, '').trim();
    const [q, a, ...wrong] = parts;
    if (!q) {
      errors.push({ line: i + 1, msg: `${i + 1}번째 줄: 문제가 비어 있어요` });
      return;
    }
    const opts = wrong.length ? [a, ...wrong.filter(w => w !== a)].slice(0, 6) : null;
    list.push({ q, a, opts: opts && opts.length > 1 ? opts : null, explain, img, listen, pts, diff });
  });
  return { list, errors };
}

export function cleanupQuestionsText(rawText) {
  const inputLines = String(rawText || '').split(/\r?\n/);
  const cleanedLines = [];
  let fixedLines = 0;

  for (const raw of inputLines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('```')) { fixedLines++; continue; }
    if (/^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(line) || /^[-:|\s\t]+$/.test(line)) { fixedLines++; continue; }

    const orig = line;
    line = line
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^\|\s*/, '')
      .replace(/\s*\|$/, '');

    if (!line.includes('|')) {
      if (line.includes('｜')) line = line.replace(/｜/g, '|');
      else if (line.includes('\t')) line = line.replace(/\t+/g, ' | ');
    }

    if (line.includes('|')) {
      const cols = line.split('|').map((c, idx) => {
        let cell = c.replace(/\s{2,}/g, ' ').trim();
        if (idx === 0) {
          cell = cell.replace(/^(?:[-*•]\s*|\d+\s*[.)]\s*|Q\s*\d*\s*[.:)]\s*|문제\s*\d+\s*[.:)]\s*)/i, '').trim();
        }
        return cell;
      }).filter(Boolean);
      if (cols.length) line = cols.join(' | ');
    } else {
      line = line.replace(/\s{2,}/g, ' ').trim();
    }

    if (line !== orig) fixedLines++;
    if (line) cleanedLines.push(line);
  }

  const normalized = cleanedLines.join('\n');
  const parsed = parseQuestions(normalized);
  const formatted = parsed.errors.length === 0 && parsed.list.length > 0
    ? serializeQuestions(parsed.list)
    : normalized;

  return {
    text: formatted,
    fixedLines,
    count: parsed.list.length,
    errorCount: parsed.errors.length
  };
}

export function serializeQuestions(list) {
  const clean = s => String(s || '').replace(/\r?\n/g, ' ').replace(/\|/g, '｜').trim();
  return list.map(item => {
    const cols = [clean(item.q), clean(item.a)];
    if (item.opts && item.opts.length > 1) cols.push(...item.opts.slice(1).map(clean).filter(Boolean));
    if (item.listen && String(item.listen).trim()) {
      cols.push(item.listen === 'auto' ? '듣기' : '듣기: ' + clean(item.listen));
    }
    if (Number(item.pts) > 0) cols.push(`배점: ${Math.round(Number(item.pts))}`);
    if (item.explain && item.explain.trim()) cols.push('해설: ' + clean(item.explain));
    if (item.img && isSafeImageUrl(item.img)) cols.push('이미지: ' + item.img.trim());
    return cols.join(' | ');
  }).join('\n');
}

export function matchShortAnswer(input, answer, question = '') {
  const norm = s => String(s || '').toLowerCase().replace(/[\s.,!?~·\-_'"]/g, '');
  const ni = norm(input);
  if (!ni) return false;
  const raw = String(answer || '');
  const pool = [raw, raw.replace(/\([^)]*\)/g, ''), ...[...raw.matchAll(/\(([^)]+)\)/g)].map(m => m[1])];
  const expanded = [];
  pool.forEach(p => {
    expanded.push(p);
    p.split(/[/,]/).forEach(x => expanded.push(x));
  });
  const ql = String(question || '').toLowerCase();
  const hasQUnit = unit => {
    if (unit === '℃') return /℃|온도/.test(ql);
    if (unit === '°') return ql.includes('°') || /(?:^|\s|몇\s*)도/.test(ql);
    if (/^[a-z]+$/i.test(unit)) return new RegExp(`(?:^|[^a-z])${unit}(?:$|[^a-z])`, 'i').test(ql);
    if (unit === '일' && /며칠/.test(ql)) return true;
    return new RegExp(`(?:^|\\s|몇\\s*)${unit}`).test(ql);
  };
  const inDate = String(input || '').trim().match(/^(\d{1,2})\s*[/.월\-]\s*(\d{1,2})\s*일?$/);
  return expanded.some(c => {
    const tr = c.trim();
    const nc = norm(tr);
    if (!nc) return false;
    if (nc === ni) return true;
    const dm = tr.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
    if (dm && inDate && +dm[1] === +inDate[1] && +dm[2] === +inDate[2]) return true;
    const um = tr.match(/^(\d+(?:\.\d+)?)\s*(cm|mm|m|km|g|kg|℃|°|도|분|시간|초|일|개|가지|명|원|살|년)$/i);
    if (um && ql && hasQUnit(um[2].toLowerCase()) && ni === um[1].toLowerCase()) return true;
    return false;
  });
}

export function getSpeechSpec(qText) {
  const s = String(qText || '').trim();
  const quoted = s.match(/[‘'“"]([A-Za-z][A-Za-z\s'-]{0,40})[’'”"]/);
  if (quoted) return { text: quoted[1].trim(), lang: 'en-US' };
  const asciiLetters = (s.match(/[A-Za-z]/g) || []).length;
  const nonSpace = s.replace(/\s+/g, '').length || 1;
  if (asciiLetters / nonSpace > 0.6) return { text: s, lang: 'en-US' };
  return { text: s, lang: 'ko-KR' };
}

const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

export function makeChosungHint(answer) {
  const clean = String(answer || '').replace(/\([^)]*\)/g, '').trim() || String(answer || '').trim();
  if (!clean) return '';
  // If purely Hangul + spaces/numbers/punctuation
  if (/[가-힣]/.test(clean)) {
    return [...clean].map(ch => {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) return CHOSUNG[Math.floor((code - 0xac00) / 588)];
      return ch;
    }).join('');
  }
  // English / Latin
  if (/[A-Za-z]/.test(clean)) {
    return clean.split(/(\s+)/).map(tok => {
      if (!/[A-Za-z]/.test(tok) || tok.length <= 2) return tok;
      return tok[0] + ' ' + '_ '.repeat(Math.min(8, tok.length - 2)) + tok[tok.length - 1];
    }).join('').trim();
  }
  // Numeric / symbols
  if (clean.length <= 1) return '_';
  return clean[0] + '_'.repeat(Math.min(6, clean.length - 1));
}

export function formatRichText(raw) {
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let s = escHtml(raw);
  s = s.replace(/_{3,}/g, '<span class="q-blank" aria-label="빈칸"></span>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="q-em">$1</strong>');
  s = s.replace(/\^\{([^}]+)\}|\^([0-9a-zA-Z+-]+)/g, (_, g1, g2) => `<sup>${g1 || g2}</sup>`);
  s = s.replace(/_\{([^}]+)\}|_([0-9]+)/g, (_, g1, g2) => `<sub>${g1 || g2}</sub>`);
  return s;
}
