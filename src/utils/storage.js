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
    stage: 0,
    nextReviewAt: now,
    lastMissedAt: now
  };
  if (idx >= 0) list[idx] = nextItem;
  else list.unshift(nextItem);
  list.sort((a, b) => (b.misses - a.misses) || String(b.lastMissedAt).localeCompare(String(a.lastMissedAt)));
  const trimmed = list.slice(0, 100);
  store('bq_wrong_bank', trimmed);
  return trimmed;
}

const SRS_DAYS = [1, 3, 7];

export function isWeakDue(item, nowMs = Date.now()) {
  if (!item || !item.nextReviewAt) return true;
  const t = Date.parse(item.nextReviewAt);
  return Number.isNaN(t) || t <= nowMs;
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
    const nextStage = Math.min(SRS_DAYS.length - 1, (Number(list[idx].stage) || 0) + 1);
    list[idx].stage = nextStage;
    const waitDays = SRS_DAYS[nextStage] || 3;
    list[idx].nextReviewAt = new Date(Date.now() + waitDays * 86400000).toISOString();
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

/* ---------- 학급 프로파일 ---------- */
export function loadClassProfiles() {
  const list = load('bq_class_profiles', []);
  return Array.isArray(list) ? list : [];
}

export function saveClassProfile({ name, teamCount, teams, boardSize, settings }) {
  const cleanName = String(name || '').trim().slice(0, 24);
  if (!cleanName) return null;
  const list = loadClassProfiles();
  const existing = list.find(p => p.name === cleanName);
  const entry = {
    id: existing ? existing.id : 'cls_' + Date.now().toString(36),
    name: cleanName,
    teamCount: Number(teamCount) || 2,
    boardSize: Number(boardSize) || 5,
    teams: Array.isArray(teams) ? teams.slice(0, 6).map(t => ({ name: String(t.name || '').slice(0, 8), emoji: t.emoji || '🦊' })) : [],
    settings: settings && typeof settings === 'object' ? { ...settings } : {},
    updatedAt: new Date().toISOString()
  };
  const next = [entry, ...list.filter(p => p.id !== entry.id)].slice(0, 20);
  store('bq_class_profiles', next);
  return entry;
}

export function deleteClassProfile(id) {
  const next = loadClassProfiles().filter(p => p.id !== id);
  store('bq_class_profiles', next);
  return next;
}

/* ---------- 대용량 세트 순환 출제 풀 ---------- */
export function loadSeenPool(setId) {
  if (!setId) return [];
  const all = load('bq_seen_pool', {});
  return all && Array.isArray(all[setId]) ? all[setId] : [];
}

export function saveSeenPool(setId, keys) {
  if (!setId) return;
  const all = load('bq_seen_pool', {}) || {};
  all[setId] = Array.isArray(keys) ? keys.slice(-200) : [];
  store('bq_seen_pool', all);
}

export function selectPooledQuestions(setId, parsedList, total, { shuffleEnabled = true, noRepeat = true, shuffleFn = null } = {}) {
  const arr = Array.isArray(parsedList) ? [...parsedList] : [];
  if (!arr.length) return [];
  const doShuffle = a => (typeof shuffleFn === 'function' ? shuffleFn(a) : a);
  if (!noRepeat || !setId || arr.length <= total) {
    if (shuffleEnabled) doShuffle(arr);
    return arr.slice(0, total);
  }
  const seen = new Set(loadSeenPool(setId));
  const unseen = arr.filter(q => !seen.has(wrongBankKey(q.q)));
  const already = arr.filter(q => seen.has(wrongBankKey(q.q)));
  if (shuffleEnabled) {
    doShuffle(unseen);
    doShuffle(already);
  }
  const picked = [...unseen, ...already].slice(0, total);
  if (picked.length) {
    const nextSeen = unseen.length < total
      ? picked.map(q => wrongBankKey(q.q))
      : [...seen, ...picked.map(q => wrongBankKey(q.q))];
    saveSeenPool(setId, [...new Set(nextSeen)]);
  }
  return picked;
}

/* ---------- 학습 리포트 · 연속 학습일 · 배지 도감 ---------- */
export function loadLearningLog() {
  const d = { days: [], subjects: {}, totalCorrect: 0, totalWrong: 0, gamesPlayed: 0, maxBingoSingle: 0, weakCleared: 0 };
  const v = load('bq_learning_log', null);
  if (!v || typeof v !== 'object') return d;
  return {
    ...d,
    ...v,
    days: Array.isArray(v.days) ? v.days : [],
    subjects: v.subjects && typeof v.subjects === 'object' ? v.subjects : {}
  };
}

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeStudyStreak(days, todayKey = localDateKey()) {
  const set = new Set(Array.isArray(days) ? days : []);
  if (!set.size) return 0;
  let cur = new Date(todayKey + 'T00:00:00');
  if (!set.has(localDateKey(cur))) {
    cur = new Date(cur.getTime() - 86400000);
    if (!set.has(localDateKey(cur))) return 0;
  }
  let streak = 0;
  while (set.has(localDateKey(cur))) {
    streak++;
    cur = new Date(cur.getTime() - 86400000);
  }
  return streak;
}

export function recordLearningSession({ subject = '일반', correct = 0, wrong = 0, maxBingo = 0, weakCleared = 0 } = {}) {
  const log = loadLearningLog();
  const today = localDateKey();
  if (!log.days.includes(today)) {
    log.days.push(today);
    log.days = log.days.slice(-120);
  }
  const subj = String(subject || '일반').trim() || '일반';
  const prev = log.subjects[subj] || { correct: 0, wrong: 0, games: 0 };
  prev.correct += Math.max(0, Number(correct) || 0);
  prev.wrong += Math.max(0, Number(wrong) || 0);
  prev.games += 1;
  log.subjects[subj] = prev;
  log.totalCorrect += Math.max(0, Number(correct) || 0);
  log.totalWrong += Math.max(0, Number(wrong) || 0);
  log.gamesPlayed += 1;
  log.maxBingoSingle = Math.max(log.maxBingoSingle || 0, Number(maxBingo) || 0);
  log.weakCleared += Math.max(0, Number(weakCleared) || 0);
  store('bq_learning_log', log);
  return log;
}

export function computeAchievements(soloStats = {}, log = null) {
  const st = soloStats || {};
  const lg = log || loadLearningLog();
  const streak = computeStudyStreak(lg.days);
  const totalSolved = (lg.totalCorrect || 0) + (lg.totalWrong || 0);
  const acc = totalSolved ? Math.round((lg.totalCorrect * 100) / totalSolved) : 0;
  return [
    { id: 'first_play', icon: '🌱', name: '첫 빙고 도전', desc: '첫 게임을 완료했어요', unlocked: (lg.gamesPlayed || 0) >= 1 },
    { id: 'first_win', icon: '🏆', name: 'PC 첫 승리', desc: '1인 모드에서 PC를 이겼어요', unlocked: (st.wins || 0) >= 1 },
    { id: 'streak3', icon: '🔥', name: '3일 연속 학습', desc: '3일 연속으로 퀴즈를 풀었어요', unlocked: streak >= 3 || (lg.days || []).length >= 3 },
    { id: 'hard_clear', icon: '👑', name: '최고 난이도 정복', desc: 'PC 어려움 난이도를 이겼어요', unlocked: !!(st.cleared && st.cleared.hard) },
    { id: 'bingo3', icon: '🎯', name: '트리플 빙고', desc: '한 게임에서 3줄 이상 빙고 달성', unlocked: (lg.maxBingoSingle || 0) >= 3 },
    { id: 'solver50', icon: '📚', name: '퀴즈 탐험가', desc: '누적 50문제 이상 풀었어요', unlocked: totalSolved >= 50 },
    { id: 'acc80', icon: '💎', name: '정확도 80%+', desc: '누적 정답률 80% 이상 (20문제+)', unlocked: totalSolved >= 20 && acc >= 80 },
    { id: 'all_subj', icon: '🌈', name: '올라운더', desc: '3개 이상 과목을 플레이했어요', unlocked: Object.keys(lg.subjects || {}).length >= 3 }
  ];
}

/* ---------- 공개 창고 추천·신고 상태 ---------- */
export function loadLibLiked() {
  const a = load('bq_lib_liked', []);
  return Array.isArray(a) ? a : [];
}

export function toggleLibLiked(id) {
  const list = loadLibLiked();
  const on = !list.includes(id);
  const next = on ? [...list, id] : list.filter(x => x !== id);
  store('bq_lib_liked', next.slice(-200));
  return { liked: on, list: next };
}

export function loadLibReported() {
  const a = load('bq_lib_reported', []);
  return Array.isArray(a) ? a : [];
}

export function markLibReported(id) {
  const list = loadLibReported();
  if (!list.includes(id)) {
    list.push(id);
    store('bq_lib_reported', list.slice(-100));
  }
}
