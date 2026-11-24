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

export function loadMyCloudCodes() {
  const list = load('bq_my_codes', []);
  return Array.isArray(list) ? list : [];
}

export function saveMyCloudCode(entry) {
  if (!entry || !entry.code) return;
  const list = loadMyCloudCodes().filter(x => x.code !== entry.code);
  list.unshift({ code: entry.code, title: entry.title || '공유 문제 세트', count: entry.count || 0, createdAt: entry.createdAt || new Date().toISOString() });
  store('bq_my_codes', list.slice(0, 30));
}
