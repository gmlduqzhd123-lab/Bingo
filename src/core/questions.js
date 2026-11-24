export function isSafeImageUrl(url) {
  const s = String(url || '').trim();
  if (!s || s.length > 200000) return false;
  if (/^https?:\/\/\S+$/i.test(s)) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(s)) return true;
  return false;
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
    for (let k = 0; k < 2 && parts.length >= 3; k++) {
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
      break;
    }

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
    list.push({ q, a, opts: opts && opts.length > 1 ? opts : null, explain, img });
  });
  return { list, errors };
}

export function serializeQuestions(list) {
  const clean = s => String(s || '').replace(/\r?\n/g, ' ').replace(/\|/g, '｜').trim();
  return list.map(item => {
    const cols = [clean(item.q), clean(item.a)];
    if (item.opts && item.opts.length > 1) cols.push(...item.opts.slice(1).map(clean).filter(Boolean));
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
