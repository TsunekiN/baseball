import type { Team } from './types';
import { weekDef, REGULAR_WEEKS } from './schedule';

/** Fisher-Yates シャッフル（非破壊）。rng は 0..1 の乱数生成器 */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 1試合（=1カードの1日分） */
export interface ScheduleGame {
  day: number; // シーズン通しの日（0始まり）
  week: number; // 週インデックス
  awayId: string;
  homeId: string;
  /** 交流戦か */
  interleague: boolean;
}

/**
 * 円卓法で総当たり1巡（n=6なら5ラウンド、各3ペア）を生成。
 * flip=true でホーム/アウェイを反転。
 */
function circleRounds(ids: string[], flip: boolean): { home: string; away: string }[][] {
  const n = ids.length;
  const idx = ids.map((_, i) => i);
  const result: { home: string; away: string }[][] = [];
  const arr = [...idx];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      let a = arr[i];
      let b = arr[n - 1 - i];
      // ラウンドごとに少しホーム/アウェイを入れ替え
      if ((r + i) % 2 === 0) [a, b] = [b, a];
      if (flip) [a, b] = [b, a];
      pairs.push([a, b]);
    }
    result.push(pairs.map(([h, a]) => ({ home: ids[h], away: ids[a] })));
    // 回転（先頭固定、残りを回す）
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return result;
}

/** 同一リーグの40ラウンド（8巡＝各巡5ラウンド、巡ごとにホーム反転） */
function leagueRoundPool(ids: string[]): { home: string; away: string }[][] {
  const pool: { home: string; away: string }[][] = [];
  for (let cycle = 0; cycle < 8; cycle++) {
    const rounds = circleRounds(ids, cycle % 2 === 1);
    pool.push(...rounds);
  }
  return pool; // 40ラウンド
}

/** 交流戦の6ラウンド（ラテン方格：セ各球団がパ各球団と1回ずつ） */
function interleagueRoundPool(ce: string[], pa: string[]): { home: string; away: string }[][] {
  const pool: { home: string; away: string }[][] = [];
  for (let r = 0; r < 6; r++) {
    const round: { home: string; away: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const c = ce[i];
      const p = pa[(i + r) % 6];
      // 半分ずつホーム/アウェイ
      if ((i + r) % 2 === 0) round.push({ home: c, away: p });
      else round.push({ home: p, away: c });
    }
    pool.push(round);
  }
  return pool; // 6ラウンド（各6カード）
}

/**
 * シーズン全日程を生成する。
 * - 通常週20週: 同一リーグ、週2カード（各3連戦）
 * - 交流戦3週: 他リーグ、週2カード（各3連戦）
 * - 変則週(9月4週): 同一リーグ5球団と1試合ずつ（単発5日）
 * 各チーム 120 + 18 + 5 = 143試合。
 */
export function generateSeason(teams: Team[], rng: () => number = Math.random): ScheduleGame[] {
  // 毎年、対戦の並び順が変わるよう各リーグの球団順をシャッフルしてから円卓法に渡す。
  // 総当たり回数は円卓法1巡で保証されるため、順序の入れ替えでは対戦数は変わらない。
  const ce = shuffle(teams.filter((t) => t.league === 'CENTRAL').map((t) => t.id), rng);
  const pa = shuffle(teams.filter((t) => t.league === 'PACIFIC').map((t) => t.id), rng);

  // プールは円卓法の順序のまま使う（連続ラウンドが必ず異なる対戦ペアになるので6連戦が出ない）。
  // 毎年のランダム性は上の ids シャッフルで確保する（どのカードがどの週になるかが変わる）。
  const cePool = leagueRoundPool(ce); // 40
  const paPool = leagueRoundPool(pa); // 40
  const interPool = interleagueRoundPool(ce, pa); // 6（各ペア1回ずつ）

  let cePtr = 0;
  let paPtr = 0;
  let interPtr = 0;

  const games: ScheduleGame[] = [];
  let day = 0;

  // 変則週用: 同一リーグ円卓1巡（単発・各1日）。円卓順のまま使う
  const ceOdd = circleRounds(ce, false); // 5ラウンド
  const paOdd = circleRounds(pa, false);

  for (let week = 0; week < REGULAR_WEEKS; week++) {
    const kind = weekDef(week).kind;

    if (kind === 'REGULAR' || kind === 'INTERLEAGUE') {
      // 週2カード（前半・後半）。各カード=3連戦（3日）
      for (let card = 0; card < 2; card++) {
        let dayRound: { home: string; away: string }[];
        let inter = false;
        if (kind === 'INTERLEAGUE') {
          dayRound = interPool[interPtr++];
          inter = true;
        } else {
          const ceR = cePool[cePtr++];
          const paR = paPool[paPtr++];
          dayRound = [...ceR, ...paR];
        }
        for (let rep = 0; rep < 3; rep++) {
          for (const m of dayRound) {
            games.push({ day, week, awayId: m.away, homeId: m.home, interleague: inter });
          }
          day++;
        }
      }
    } else if (kind === 'REGULAR_ODD') {
      // 変則週: 同一リーグ円卓1巡（5ラウンド）を単発（各1日）
      for (let r = 0; r < 5; r++) {
        const dayRound = [...ceOdd[r], ...paOdd[r]];
        for (const m of dayRound) {
          games.push({ day, week, awayId: m.away, homeId: m.home, interleague: false });
        }
        day++;
      }
    }
  }

  return games;
}
