import type { Player } from '../domain/types';
import type { BatterLine, GameResult, InjuryReport, PitcherLine } from './matchTypes';
import { emptyBatting, emptyPitching, type PlayerSeasonStats } from './matchStats';

// ============================================================
// 達成記録（マイルストーン）
// ============================================================

interface Milestone {
  get: (s: PlayerSeasonStats) => number;
  step: number;
  label: string; // 単位（○○達成）
}

const BAT_MILESTONES: Milestone[] = [
  { get: (s) => s.batting?.games ?? 0, step: 1000, label: '試合出場' },
  { get: (s) => s.batting?.hits ?? 0, step: 500, label: '安打' },
  { get: (s) => s.batting?.hr ?? 0, step: 100, label: '本塁打' },
  { get: (s) => s.batting?.rbi ?? 0, step: 100, label: '打点' },
  { get: (s) => s.batting?.sb ?? 0, step: 100, label: '盗塁' },
];
const PIT_MILESTONES: Milestone[] = [
  { get: (s) => s.pitching?.wins ?? 0, step: 50, label: '勝利' },
  { get: (s) => s.pitching?.saves ?? 0, step: 50, label: 'セーブ' },
  { get: (s) => s.pitching?.holds ?? 0, step: 50, label: 'ホールド' },
  { get: (s) => s.pitching?.so ?? 0, step: 500, label: '奪三振' },
];

/**
 * 達成記録を判定する。before(試合前の通算)とafter(試合後の通算)で刻みを跨いだら達成メッセージを返す。
 */
export function checkMilestones(
  name: string,
  before: PlayerSeasonStats,
  after: PlayerSeasonStats,
): string[] {
  const msgs: string[] = [];
  const check = (list: Milestone[]) => {
    for (const m of list) {
      const b = m.get(before);
      const a = m.get(after);
      const crossed = Math.floor(a / m.step) * m.step;
      if (a >= m.step && Math.floor(b / m.step) < Math.floor(a / m.step)) {
        msgs.push(`${name} ${crossed}${m.label}達成！！`);
      }
    }
  };
  check(BAT_MILESTONES);
  check(PIT_MILESTONES);
  return msgs;
}

/** 打者/投手ラインを通算へ足した「after」を作る（before非破壊） */
export function statAfter(
  before: PlayerSeasonStats,
  bat?: BatterLine,
  pit?: PitcherLine,
): PlayerSeasonStats {
  const after: PlayerSeasonStats = {
    batting: before.batting ? { ...before.batting } : undefined,
    pitching: before.pitching ? { ...before.pitching } : undefined,
  };
  if (bat) {
    const b = after.batting ?? emptyBatting();
    after.batting = {
      ...b,
      games: b.games + (bat.ab > 0 || bat.bb > 0 ? 1 : 0),
      hits: b.hits + bat.hits,
      hr: b.hr + bat.hr,
      rbi: b.rbi + bat.rbi,
      sb: b.sb + bat.sb,
    };
  }
  if (pit) {
    const p = after.pitching ?? emptyPitching();
    after.pitching = {
      ...p,
      wins: p.wins + (pit.win ? 1 : 0),
      saves: p.saves + (pit.save ? 1 : 0),
      holds: p.holds + (pit.hold ? 1 : 0),
      so: p.so + pit.so,
    };
  }
  return after;
}

// ============================================================
// 負傷判定
// ============================================================

/**
 * 負傷判定（1試合あたり）。
 * 負傷確率 = 0.025% + ((100 - health)/100)^2 * 0.345%
 * 離脱期間 = 11〜90試合（軽症が出やすい重み付け: 乱数の3乗で重傷ほど起きにくい）、60試合以上を大ケガ扱い
 */
export function rollInjury(player: Player, rng: () => number = Math.random): InjuryReport | null {
  const h = player.health;
  const prob = 0.00025 + ((100 - h) / 100) ** 2 * 0.00345;
  if (rng() >= prob) return null;
  const r = rng();
  const games = 11 + Math.floor(r * r * r * 79); // 11〜90、軽症寄り（3乗で短期に集中＝重傷ほど起きにくい）
  return { playerId: player.id, name: player.name, games, severe: games >= 60 };
}

/**
 * マイチーム視点の試合レポート（達成記録・負傷）を作る。
 * statsBefore は「この試合を反映する前」の累計であること。
 */
export function buildMatchReport(
  res: GameResult,
  myId: string,
  statsBefore: Record<string, PlayerSeasonStats>,
  myPlayers: Player[],
  rng: () => number = Math.random,
): { achievements: string[]; injuries: InjuryReport[] } {
  const isHome = res.homeTeamId === myId;
  const myBatters = isHome ? res.homeBatters : res.awayBatters;
  const myPitchers = isHome ? res.homePitchers : res.awayPitchers;
  const playerMap = new Map(myPlayers.map((p) => [p.id, p]));

  // 達成記録
  const achievements: string[] = [];
  for (const bl of myBatters) {
    const before = statsBefore[bl.playerId] ?? {};
    const after = statAfter(before, bl, undefined);
    achievements.push(...checkMilestones(bl.name, before, after));
  }
  for (const pl of myPitchers) {
    const before = statsBefore[pl.playerId] ?? {};
    const after = statAfter(before, undefined, pl);
    achievements.push(...checkMilestones(pl.name, before, after));
  }

  // 負傷（出場選手のみ判定）
  const injuries: InjuryReport[] = [];
  for (const bl of myBatters) {
    if (bl.ab > 0 || bl.bb > 0) {
      const p = playerMap.get(bl.playerId);
      if (p) {
        const inj = rollInjury(p, rng);
        if (inj) injuries.push(inj);
      }
    }
  }
  for (const pl of myPitchers) {
    if (pl.batters > 0) {
      const p = playerMap.get(pl.playerId);
      if (p) {
        const inj = rollInjury(p, rng);
        if (inj) injuries.push(inj);
      }
    }
  }

  return { achievements, injuries };
}
