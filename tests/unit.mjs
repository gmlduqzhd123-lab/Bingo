import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. manifest + sw.js CORE asset integrity
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
assert(manifest.name && manifest.start_url, 'manifest.webmanifest invalid');

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const coreMatch = sw.match(/const CORE = \[([\s\S]*?)\];/);
assert(coreMatch, 'CORE array missing in sw.js');
const coreEntries = [...coreMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
assert.equal(coreEntries.length, 34, `Expected 34 CORE entries, got ${coreEntries.length}`);
for (const e of coreEntries) {
  if (e === './') continue;
  const p = path.join(root, e.replace(/^\.\//, ''));
  assert(fs.existsSync(p), `Missing CORE asset: ${e}`);
}

// 2. Mock localStorage for node unit tests
const memStore = new Map();
globalThis.localStorage = {
  get length() { return memStore.size; },
  key(i) { return [...memStore.keys()][i] ?? null; },
  getItem(k) { return memStore.has(k) ? memStore.get(k) : null; },
  setItem(k, v) { memStore.set(k, String(v)); },
  removeItem(k) { memStore.delete(k); },
  clear() { memStore.clear(); }
};

// 3. Data sets & defaults
const { DEFAULT_SETTINGS, BUILTIN_SETS } = await import('../src/data/sets.js');
assert.equal(BUILTIN_SETS.length, 10, 'Expected 10 builtin sets');
['stealOnWrong', 'comboBonus', 'listeningMode', 'jeopardyPts', 'poolNoRepeat', 'bigScreen', 'liveBuzzer'].forEach(k => {
  assert(k in DEFAULT_SETTINGS, `Missing DEFAULT_SETTINGS.${k}`);
});

// 4. Questions parser, OX, listening, points, cleanup, rich text
const {
  isSafeImageUrl,
  normalizeOX,
  isOXQuestion,
  parseQuestions,
  serializeQuestions,
  cleanupQuestionsText,
  makeChosungHint,
  formatRichText
} = await import('../src/core/questions.js');

BUILTIN_SETS.forEach(s => {
  const { list, errors } = parseQuestions(s.text);
  assert.equal(errors.length, 0, `Parse error in builtin set ${s.id}: ${JSON.stringify(errors)}`);
  assert(list.length >= 16, `Too few questions in ${s.id}: ${list.length}`);
});

assert(isSafeImageUrl('idb://img_abc123_xy'), 'idb:// ref should be allowed');
assert(!isSafeImageUrl('javascript:alert(1)'), 'javascript: must be blocked');
assert.equal(normalizeOX('⭕'), 'O');
assert.equal(normalizeOX('거짓'), 'X');
assert(isOXQuestion({ q: '지구?', a: 'O', opts: ['O', 'X'] }));
assert(!isOXQuestion({ q: '수도?', a: '서울', opts: ['서울', '부산'] }));

const richParsed = parseQuestions('물 공식은? | H_2O | CO_2 | O_2 | NaCl | 듣기: water | 배점: 30 | 해설: 물 분자').list[0];
assert.equal(richParsed.listen, 'water');
assert.equal(richParsed.pts, 30);
assert.equal(richParsed.explain, '물 분자');
assert(serializeQuestions([richParsed]).includes('배점: 30'));

const dirty = '```\n1. “사과”｜apple｜banana\n|---|---|---|\n2) 테스트? \t O | X | 배점: 20\n```';
const cleaned = cleanupQuestionsText(dirty);
assert.equal(cleaned.errorCount, 0);
assert.equal(cleaned.count, 2);
assert.equal(makeChosungHint('광합성'), 'ㄱㅎㅅ');
assert.equal(formatRichText('H_2O'), 'H<sub>2</sub>O');

// 5. Engine differential scoring & Jeopardy assignment
const { score, assignJeopardyPoints, emptyStats, computeStanding } = await import('../src/core/engine.js');
const dummyTiles = Array.from({ length: 9 }, (_, i) => ({ q: null, owner: i === 0 ? 0 : -1, opened: i === 0, golden: false, pts: 0 }));
assignJeopardyPoints(dummyTiles, 3);
assert.equal(dummyTiles[0].pts, 10);
assert.equal(dummyTiles[4].pts, 20);
assert.equal(dummyTiles[8].pts, 30);
const dummyState = {
  size: 3,
  settings: { tilePts: 10, bingoPts: 30 },
  teams: [{ bonus: 0, stats: emptyStats() }, { bonus: 0, stats: emptyStats() }],
  tiles: dummyTiles
};
dummyTiles[8].owner = 0;
assert.equal(score(dummyState, 0), 40);
assert.equal(computeStanding(dummyState).order[0], 0);

// 6. Storage: class profiles, pooling, SRS weak bank, learning streak & achievements
const storage = await import('../src/utils/storage.js');
const cp = storage.saveClassProfile({ name: '5-3반', teamCount: 4, boardSize: 5, teams: [{ name: 'A', emoji: '🦊' }] });
assert(cp && storage.loadClassProfiles().length === 1);
storage.deleteClassProfile(cp.id);
assert.equal(storage.loadClassProfiles().length, 0);

const bigPool = Array.from({ length: 10 }, (_, k) => ({ q: `Q${k}`, a: `A${k}` }));
const p1 = storage.selectPooledQuestions('testset', bigPool, 6, { shuffleEnabled: false, noRepeat: true });
const p2 = storage.selectPooledQuestions('testset', bigPool, 6, { shuffleEnabled: false, noRepeat: true });
assert.equal(p1.length, 6);
assert.equal(p2.length, 6);
assert.equal(p2[0].q, 'Q6');

storage.recordWrongQuestion({ q: '지구?', a: 'O' });
storage.recordWrongQuestion({ q: '지구?', a: 'O' });
assert.equal(storage.loadWrongBank()[0].misses, 2);
assert.equal(storage.resolveWrongQuestion('지구?').cleared, false);
assert.equal(storage.resolveWrongQuestion('지구?').cleared, true);

assert.equal(storage.computeStudyStreak(['2026-11-23', '2026-11-24', '2026-11-25'], '2026-11-25'), 3);
storage.recordLearningSession({ subject: '과학', correct: 5, wrong: 1, maxBingo: 3 });
const achs = storage.computeAchievements({ wins: 1, cleared: { hard: true } });
assert(achs.find(a => a.id === 'bingo3').unlocked);
assert(achs.find(a => a.id === 'hard_clear').unlocked);
assert(storage.getStorageUsage().usedBytes > 0);

// 7. Realtime backoff
const { getReconnectDelay, normalizeRoomCode } = await import('../src/utils/realtime.js');
assert.deepEqual([0, 1, 2, 3, 4].map(getReconnectDelay), [1500, 3000, 6000, 10000, 10000]);
assert.equal(normalizeRoomCode('k4m-8p2'), 'K4M8P2');

console.log('단위 테스트 통과: CORE 34종·세트 10종·OX/듣기/차등배점·SRS/스트릭/프로파일·재연결 백오프 정상');
