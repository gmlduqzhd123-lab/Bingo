import { BUILTIN_SETS } from '../data/sets.js';

export function load(key, def) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? def : v;
  } catch {
    return def;
  }
}

export function store(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function savedSets() {
  const list = load('bq_sets', []);
  return Array.isArray(list) ? list : [];
}

export function allSets() {
  return [...BUILTIN_SETS, ...savedSets()];
}

export function getSet(id) {
  return allSets().find(s => s.id === id) || BUILTIN_SETS[0];
}

export function loadFavorites() {
  const list = load('bq_favs', []);
  return Array.isArray(list) ? list : [];
}

export function toggleFavorite(id) {
  const favs = loadFavorites();
  const next = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id];
  store('bq_favs', next);
  return next;
}

export function loadSoloStats() {
  const d = { wins: 0, draws: 0, losses: 0, bestScore: 0, streak: 0, maxStreak: 0, cleared: { easy: false, normal: false, hard: false } };
  const v = load('bq_solo_stats', null);
  if (!v || typeof v !== 'object') return d;
  return { ...d, ...v, cleared: { ...d.cleared, ...(v.cleared || {}) } };
}

export function saveSoloStats(st) {
  return store('bq_solo_stats', st);
}

export function loadSetMastery() {
  const m = load('bq_set_mastery', {});
  return m && typeof m === 'object' ? m : {};
}

export function recordSetMastery(setId, stars, bestScore) {
  if (!setId) return;
  const m = loadSetMastery();
  const prev = m[setId] || { stars: 0, bestScore: 0, plays: 0 };
  m[setId] = {
    stars: Math.max(prev.stars || 0, stars || 0),
    bestScore: Math.max(prev.bestScore || 0, bestScore || 0),
    plays: (prev.plays || 0) + 1
  };
  store('bq_set_mastery', m);
  return m[setId];
}

export function hashSetContent(title, text) {
  const str = `${String(title || '').trim()}\0${String(text || '').trim()}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function loadMyCloudCodes() {
  const list = load('bq_my_codes', []);
  return Array.isArray(list) ? list : [];
}

export function saveMyCloudCode(entry) {
  if (!entry || !entry.code) return;
  const list = loadMyCloudCodes().filter(x => x.code !== entry.code);
  list.unshift({
    code: entry.code,
    title: entry.title || '공유 문제 세트',
    count: entry.count || 0,
    contentHash: entry.contentHash || '',
    createdAt: entry.createdAt || new Date().toISOString()
  });
  store('bq_my_codes', list.slice(0, 30));
}

export function findReusableCloudCode(title, text) {
  const h = hashSetContent(title, text);
  return loadMyCloudCodes().find(x => x.contentHash && x.contentHash === h) || null;
}

export function loadHallOfFame() {
  const list = load('bq_hall_of_fame', []);
  return Array.isArray(list) ? list : [];
}

export function addHallOfFameEntry(entry) {
  const list = loadHallOfFame();
  list.unshift({
    id: 'hof_' + Date.now().toString(36),
    date: new Date().toISOString(),
    setName: String(entry.setName || '퀴즈').slice(0, 40),
    playMode: entry.playMode || 'team',
    boardSize: entry.boardSize || 5,
    winnerName: String(entry.winnerName || '우승팀').slice(0, 24),
    winnerEmoji: entry.winnerEmoji || '🏆',
    winnerScore: Number(entry.winnerScore) || 0,
    runnerUp: String(entry.runnerUp || '').slice(0, 40)
  });
  return store('bq_hall_of_fame', list.slice(0, 30));
}

export function clearHallOfFame() {
  return store('bq_hall_of_fame', []);
}

export function getStorageUsage(maxBytes = 5 * 1024 * 1024) {
  let usedBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const v = localStorage.getItem(k) || '';
      usedBytes += (k.length + v.length) * 2;
    }
  } catch {}
  const maxKB = Math.max(1, Math.round(maxBytes / 1024));
  const usedKB = Math.round(usedBytes / 1024);
  const pct = Math.min(100, Math.round((usedBytes / maxBytes) * 100));
  return { usedBytes, maxBytes, usedKB, maxKB, pct };
}

export function wrongBankKey(qText) {
  return String(qText || '').toLowerCase().replace(/\s+/g, '');
}

export function loadWrongBank() {
  const list = load('bq_wrong_bank', []);
  return Array.isArray(list) ? list : [];
}

export function recordWrongQuestion(qObj) {
  if (!qObj || !qObj.q || !qObj.a) return loadWrongBank();
  const key = wrongBankKey(qObj.q);
  if (!key) return loadWrongBank();
  const list = loadWrongBank();
  const now = new Date().toISOString();
  const idx = list.findIndex(x => x.key === key);
  const nextItem = {
    key,
    q: String(qObj.q).trim(),
    a: String(qObj.a).trim(),
    opts: Array.isArray(qObj.opts) && qObj.opts.length > 1 ? [...qObj.opts] : null,
    explain: qObj.explain ? String(qObj.explain).trim() : '',
    img: qObj.img ? String(qObj.img).trim() : '',
    misses: idx >= 0 ? (Number(list[idx].misses) || 1) + 1 : 1,
    lastMissedAt: now
  };
  if (idx >= 0) list[idx] = nextItem;
  else list.unshift(nextItem);
  list.sort((a, b) => (b.misses - a.misses) || String(b.lastMissedAt).localeCompare(String(a.lastMissedAt)));
  const trimmed = list.slice(0, 100);
  store('bq_wrong_bank', trimmed);
  return trimmed;
}

export function resolveWrongQuestion(qText, clearImmediately = false) {
  const key = wrongBankKey(qText);
  if (!key) return { cleared: false, remaining: loadWrongBank().length };
  const list = loadWrongBank();
  const idx = list.findIndex(x => x.key === key);
  if (idx < 0) return { cleared: false, remaining: list.length };
  let cleared = false;
  if (clearImmediately || (Number(list[idx].misses) || 1) <= 1) {
    list.splice(idx, 1);
    cleared = true;
  } else {
    list[idx].misses = (Number(list[idx].misses) || 1) - 1;
  }
  store('bq_wrong_bank', list);
  return { cleared, remaining: list.length };
}

export function removeWrongQuestion(key) {
  const list = loadWrongBank().filter(x => x.key !== key);
  store('bq_wrong_bank', list);
  return list;
}

export function clearWrongBank() {
  return store('bq_wrong_bank', []);
}
