const SUPABASE_URL = 'https://oaavmecavooowuayjxjn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_w8zpvaF_wge0pAVJy661gA_bSGnFEn9';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z2-9]{6}$/.test(s) ? s : '';
}

export function generateShareCode() {
  const arr = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < 6; i++) arr[i] = (Math.random() * 256) | 0;
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return code;
}

async function sbFetch(path, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadSharedSet(title, content, questionCount, baseUrl = '') {
  const cleanTitle = String(title || '공유 문제 세트').trim().slice(0, 60) || '공유 문제 세트';
  const cleanContent = String(content || '').trim().slice(0, 40000);
  const count = Math.max(1, Math.min(200, Number(questionCount) || 1));

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateShareCode();
    const res = await sbFetch('bingo_shared_sets', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ code, title: cleanTitle, content: cleanContent, question_count: count })
    });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const originPath = baseUrl || (typeof location !== 'undefined' ? location.href.split('#')[0].split('?')[0] : '');
    return { code, shareUrl: `${originPath}?code=${code}` };
  }
  throw new Error('Could not allocate share code');
}

export async function fetchSharedSet(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw new Error('INVALID_CODE');
  const res = await sbFetch(`bingo_shared_sets?code=eq.${encodeURIComponent(code)}&select=code,title,content,question_count,created_at&limit=1`);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function submitReviewResult({ shareCode, studentAlias, playMode = 'solo', score = 0, correctCount = 0, wrongCount = 0, won = false, missedQuestions = [] }) {
  const code = normalizeCode(shareCode);
  if (!code) return { ok: false, reason: 'INVALID_CODE' };
  const payload = {
    share_code: code,
    student_alias: (String(studentAlias || '학생').trim() || '학생').slice(0, 24),
    play_mode: playMode === 'team' ? 'team' : 'solo',
    score: Math.max(-10000, Math.min(100000, Math.round(Number(score) || 0))),
    correct_count: Math.max(0, Math.min(200, Math.round(Number(correctCount) || 0))),
    wrong_count: Math.max(0, Math.min(200, Math.round(Number(wrongCount) || 0))),
    won: !!won,
    missed_questions: Array.isArray(missedQuestions) ? missedQuestions.slice(0, 50).map(q => String(q || '').slice(0, 200)).filter(Boolean) : []
  };
  const res = await sbFetch('bingo_review_results', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(payload)
  });
  return { ok: res.ok, status: res.status };
}

export async function fetchClassAnalytics(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw new Error('INVALID_CODE');
  const res = await sbFetch(`bingo_review_results?share_code=eq.${encodeURIComponent(code)}&select=student_alias,play_mode,score,correct_count,wrong_count,won,missed_questions,created_at&order=created_at.desc&limit=200`);
  if (!res.ok) throw new Error(`Analytics failed (${res.status})`);
  const rows = await res.json();
  const totalPlays = rows.length;
  if (!totalPlays) {
    return { code, totalPlays: 0, avgScore: 0, winRate: 0, avgAccuracy: 0, topMissed: [], recent: [] };
  }
  let scoreSum = 0;
  let winSum = 0;
  let correctSum = 0;
  let attemptSum = 0;
  const missedCounts = new Map();
  rows.forEach(r => {
    scoreSum += Number(r.score) || 0;
    if (r.won) winSum++;
    const c = Number(r.correct_count) || 0;
    const w = Number(r.wrong_count) || 0;
    correctSum += c;
    attemptSum += c + w;
    if (Array.isArray(r.missed_questions)) {
      r.missed_questions.forEach(q => {
        const k = String(q || '').trim();
        if (k) missedCounts.set(k, (missedCounts.get(k) || 0) + 1);
      });
    }
  });
  const topMissed = [...missedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([question, count]) => ({ question, count }));
  return {
    code,
    totalPlays,
    avgScore: Math.round(scoreSum / totalPlays),
    winRate: Math.round((winSum * 100) / totalPlays),
    avgAccuracy: attemptSum ? Math.round((correctSum * 100) / attemptSum) : 0,
    topMissed,
    recent: rows.slice(0, 10),
    allRows: rows
  };
}

export async function hashPin(pin) {
  const clean = String(pin || '').trim();
  if (!clean) return '';
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bingo-pin:' + clean));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  let h = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'fnv_' + (h >>> 0).toString(16);
}

export async function fetchPublicLibrary({ subject = 'all', query = '', sort = 'recent' } = {}) {
  try {
    const extCols = 'id,title,subject,grade,author_alias,content,question_count,likes_count,downloads_count,report_count,created_at';
    const baseCols = 'id,title,subject,grade,author_alias,content,question_count,created_at';
    const makePath = cols => {
      let path = `bingo_public_library?select=${cols}&order=created_at.desc&limit=80`;
      if (subject && subject !== 'all') path += `&subject=eq.${encodeURIComponent(subject)}`;
      return path;
    };
    let res = await sbFetch(makePath(extCols));
    if (res.status === 400) res = await sbFetch(makePath(baseCols));
    if (!res.ok) return { items: [], cloudAvailable: false };
    let rows = await res.json();
    if (!Array.isArray(rows)) rows = [];
    rows = rows.filter(r => (Number(r.report_count) || 0) < 5);
    const q = String(query || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => `${r.title} ${r.subject} ${r.grade} ${r.author_alias}`.toLowerCase().includes(q));
    }
    if (sort === 'popular') {
      rows.sort((a, b) => ((Number(b.likes_count) || 0) - (Number(a.likes_count) || 0)) || String(b.created_at).localeCompare(String(a.created_at)));
    } else if (sort === 'downloads') {
      rows.sort((a, b) => ((Number(b.downloads_count) || 0) - (Number(a.downloads_count) || 0)) || String(b.created_at).localeCompare(String(a.created_at)));
    }
    return { items: rows, cloudAvailable: true };
  } catch {
    return { items: [], cloudAvailable: false };
  }
}

export async function publishToPublicLibrary({ title, subject = '기타', grade = '전학년', authorAlias = '익명 선생님', content, questionCount, editPin = '' }) {
  const pinHash = editPin ? await hashPin(editPin) : '';
  const basePayload = {
    title: String(title || '').trim().slice(0, 60) || '공유 문제 세트',
    subject: String(subject || '기타').trim().slice(0, 20) || '기타',
    grade: String(grade || '전학년').trim().slice(0, 20) || '전학년',
    author_alias: String(authorAlias || '익명 선생님').trim().slice(0, 24) || '익명 선생님',
    content: String(content || '').trim().slice(0, 40000),
    question_count: Math.max(1, Math.min(200, Number(questionCount) || 1))
  };
  const payload = pinHash ? { ...basePayload, edit_pin_hash: pinHash } : basePayload;
  let res = await sbFetch('bingo_public_library', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  if (res.status === 400 && pinHash) {
    res = await sbFetch('bingo_public_library', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(basePayload)
    });
  }
  if (!res.ok) throw new Error(`Publish failed (${res.status})`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}

export async function interactPublicLibrary(id, action) {
  if (!id || !['like', 'download', 'report'].includes(action)) return false;
  try {
    const res = await sbFetch('rpc/bingo_lib_interact', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_action: action })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deletePublicLibraryItem(id, editPin) {
  if (!id || !editPin) return false;
  const pinHash = await hashPin(editPin);
  try {
    const res = await sbFetch('rpc/bingo_lib_delete', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_pin_hash: pinHash })
    });
    if (!res.ok) return false;
    const ok = await res.json();
    return !!ok;
  } catch {
    return false;
  }
}
