import { AI_CONF } from '../data/sets.js';

export const pick = a => a[(Math.random() * a.length) | 0];

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getLines(N = 5) {
  const L = [];
  for (let r = 0; r < N; r++) L.push(Array.from({ length: N }, (_, c) => r * N + c));
  for (let c = 0; c < N; c++) L.push(Array.from({ length: N }, (_, r) => r * N + c));
  L.push(Array.from({ length: N }, (_, k) => k * (N + 1)));
  L.push(Array.from({ length: N }, (_, k) => (k + 1) * (N - 1)));
  return L;
}

export function neighbors(i, N = 5) {
  const r = (i / N) | 0;
  const c = i % N;
  const n = [];
  if (r > 0) n.push(i - N);
  if (r < N - 1) n.push(i + N);
  if (c > 0) n.push(i - 1);
  if (c < N - 1) n.push(i + 1);
  return n;
}

export function emptyStats() {
  return { correct: 0, wrong: 0, shieldsBlocked: 0, lucky: 0, steals: 0, maxBingo: 0, maxCombo: 0 };
}

export function boardN(S, fallbackSize = 5) {
  if (S) {
    const n = S.size || Math.round(Math.sqrt((S.tiles && S.tiles.length) || 25));
    return [3, 4, 5].includes(n) ? n : 5;
  }
  return [3, 4, 5].includes(fallbackSize) ? fallbackSize : 5;
}

export function lineOwners(S) {
  return getLines(boardN(S)).map(l => {
    const o = S.tiles[l[0]].owner;
    return o >= 0 && l.every(i => S.tiles[i].owner === o) ? o : -1;
  });
}

export function tileCount(S, t) {
  return S.tiles.filter(x => x.owner === t).length;
}

export function bingoCount(S, t) {
  return lineOwners(S).filter(o => o === t).length;
}

export function score(S, t) {
  let s = S.teams[t].bonus;
  S.tiles.forEach(x => {
    if (x.owner === t) s += S.settings.tilePts * (x.golden ? 2 : 1);
  });
  return s + bingoCount(S, t) * S.settings.bingoPts;
}

export function computeStanding(S) {
  const scores = S.teams.map((_, k) => score(S, k));
  const gw = Array.isArray(S.goalWinners) && S.goalWinners.length ? S.goalWinners : null;
  const isGW = k => (gw && gw.includes(k) ? 1 : 0);
  const order = S.teams.map((_, k) => k).sort((a, b) => (isGW(b) - isGW(a)) || (scores[b] - scores[a]) || (tileCount(S, b) - tileCount(S, a)));
  const rank = k => {
    if (gw) {
      if (isGW(k)) return 1 + gw.filter(j => scores[j] > scores[k]).length;
      return gw.length + 1 + S.teams.map((_, j) => j).filter(j => !isGW(j) && scores[j] > scores[k]).length;
    }
    return 1 + scores.filter(s => s > scores[k]).length;
  };
  return { scores, order, rank, goalWinners: gw };
}

export function validTargets(S, p) {
  const N = boardN(S);
  const total = N * N;
  const me = S.turn;
  const idx = [...Array(total).keys()];
  const own = idx.filter(i => S.tiles[i].owner === me);
  const opp = idx.filter(i => S.tiles[i].owner >= 0 && S.tiles[i].owner !== me);
  const empty = idx.filter(i => S.tiles[i].owner < 0);
  switch (p.type) {
    case 'grab': {
      const adj = empty.filter(i => neighbors(i, N).some(n => S.tiles[n].owner === me));
      return adj.length ? adj : empty;
    }
    case 'steal':
      return opp;
    case 'swap':
      return p.step === 1 ? (opp.length ? own : []) : opp;
    case 'bomb':
      return idx.filter(i => [i, ...neighbors(i, N)].some(k => opp.includes(k)));
  }
  return [];
}

export function computeReachMap(S) {
  const map = new Map();
  if (!S || !S.settings.reachHint || S.over) return map;
  const N = boardN(S);
  getLines(N).forEach(line => {
    const counts = new Map();
    let blank = -1;
    let blanks = 0;
    line.forEach(idx => {
      const o = S.tiles[idx].owner;
      if (o >= 0) counts.set(o, (counts.get(o) || 0) + 1);
      else { blank = idx; blanks++; }
    });
    if (blanks === 1) {
      for (const [teamIdx, cnt] of counts) {
        if (cnt === N - 1 && (!map.has(blank) || teamIdx === S.turn)) map.set(blank, teamIdx);
      }
    }
  });
  return map;
}

export function scoreTileForAI(S, i, me) {
  const N = boardN(S);
  const lines = getLines(N);
  let pts = 0;
  lines.forEach(line => {
    if (!line.includes(i)) return;
    let aiCnt = 0;
    let oppCnt = 0;
    line.forEach(idx => {
      const o = S.tiles[idx].owner;
      if (o === me) aiCnt++;
      else if (o >= 0) oppCnt++;
    });
    if (oppCnt === 0) pts += aiCnt === N - 1 ? 1000 : 20 + aiCnt * 25;
    else if (aiCnt === 0) pts += oppCnt === N - 1 ? 700 : 10 + oppCnt * 15;
  });
  const r = (i / N) | 0;
  const c = i % N;
  const mid = (N - 1) / 2;
  pts += Math.max(0, 4 - (Math.abs(r - mid) + Math.abs(c - mid)));
  return pts;
}

export function chooseAITile(S, level) {
  const me = S.turn;
  const open = S.tiles.map((t, i) => (t.opened ? -1 : i)).filter(i => i >= 0);
  if (!open.length) return -1;
  const conf = AI_CONF[level] || AI_CONF.normal;
  const scored = open.map(i => ({ i, s: scoreTileForAI(S, i, me) + Math.random() * 2 })).sort((a, b) => b.s - a.s);
  if (Math.random() < conf.tileSmart) {
    if (level === 'normal' && scored[0].s < 700) {
      const top = scored.slice(0, Math.min(3, scored.length));
      return pick(top).i;
    }
    return scored[0].i;
  }
  return pick(open);
}

export function computeAwards(S, order, scores, rankFn = null) {
  const awards = new Array(S.teams.length).fill('');
  const used = new Set();
  const assign = (k, label) => {
    if (k >= 0 && !awards[k] && !used.has(label)) {
      awards[k] = label;
      used.add(label);
      return true;
    }
    return false;
  };
  if (order.length) {
    const topTeams = order.filter(k => (rankFn ? rankFn(k) === 1 : scores[k] === scores[order[0]]));
    if (topTeams.length === 1) {
      assign(topTeams[0], '👑 최종 우승');
    } else if (topTeams.length > 1) {
      const tieLabel = S.settings.playMode === 'solo' ? '🤝 무승부' : '👑 공동 우승';
      topTeams.forEach(k => { awards[k] = tieLabel; });
      used.add(tieLabel);
    }
  }
  const maxOf = fn => {
    let best = -1;
    let val = 0;
    order.forEach(k => {
      const v = fn(k);
      if (!awards[k] && v > val) { val = v; best = k; }
    });
    return best;
  };
  assign(maxOf(k => bingoCount(S, k)), '🎯 빙고 마스터');
  assign(maxOf(k => tileCount(S, k)), '🗺️ 땅부자');
  assign(maxOf(k => (S.teams[k].stats && S.teams[k].stats.shieldsBlocked) || 0), '🛡️ 철벽 수비');
  assign(maxOf(k => (S.teams[k].stats && S.teams[k].stats.steals) || 0), '⚡ 역전 승부사');
  assign(maxOf(k => (S.teams[k].stats && S.teams[k].stats.maxCombo >= 3 ? S.teams[k].stats.maxCombo : 0)), '🔥 콤보 장인');
  assign(maxOf(k => S.teams[k].bonus), '💎 보너스 부자');
  assign(maxOf(k => (S.teams[k].stats && S.teams[k].stats.correct) || 0), '🧠 퀴즈 박사');
  const fallbacks = ['🔥 끝까지 도전상', '🤝 팀워크상', '🍀 행운의 팀', '🌟 응원상'];
  order.forEach(k => {
    if (!awards[k]) {
      awards[k] = fallbacks.find(f => !used.has(f)) || '🌟 응원상';
      used.add(awards[k]);
    }
  });
  return awards;
}

export function computeSetStars(won, correct, wrong) {
  const total = (correct || 0) + (wrong || 0);
  if (total === 0) return 0;
  const acc = correct / total;
  if (won && acc >= 0.85) return 3;
  if (won || acc >= 0.7) return 2;
  return 1;
}
