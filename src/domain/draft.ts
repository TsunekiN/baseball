// ============================================================
// ドラフト会議
// 候補選手プールの生成と、CPU指名・競合抽選のロジック（データ層）。
// UI／進行状態は draftState / DraftScreen 側で扱う。
// ============================================================

import type { Player, Position, Team } from './types';
import { generatePlayer } from './playerFactory';
import { randInt } from './random';

/** ポジション別の候補人数 */
const POOL_COUNTS: { position: Position; count: number }[] = [
  { position: 'P', count: 16 },
  { position: 'OF', count: 16 },
  { position: 'C', count: 8 },
  { position: '1B', count: 8 },
  { position: '2B', count: 8 },
  { position: '3B', count: 8 },
  { position: 'SS', count: 8 },
];

/** 経歴に応じた入団年齢を返す（独立リーグは約1/8） */
function prospectAge(): number {
  const r = Math.random();
  if (r < 0.125) {
    // 独立リーグ: 25〜27歳
    return 25 + randInt(0, 2);
  }
  const r2 = Math.random();
  if (r2 < 0.45) return 18; // 高卒
  if (r2 < 0.8) return 22; // 大卒
  return Math.random() < 0.5 ? 20 : 24; // 社会人
}

/**
 * ドラフト候補プールを生成する。
 * nextYear = 入団年度（＝翌シーズンの年度）。
 * 仕様:
 * - 初期能力値は基本的に15〜65の間でランダム。
 * - 高校生(18歳)の場合ある程度低めに設定される。
 * - 年齢が増えるほど（大卒22歳、社会人20/24歳、独立25-27歳等）、努力値や才能に応じて成長分を加算した値が初期能力値となる。
 */
export function generateDraftProspects(nextYear: number): Player[] {
  const pool: Player[] = [];
  for (const { position, count } of POOL_COUNTS) {
    for (let i = 0; i < count; i++) {
      const age = prospectAge();

      // 18歳高校生基準の初期能力ベース (18〜46のランダム)
      const base18 = 18 + Math.random() * 28;
      // 年齢増加分（大卒22歳、社会人20/24歳、独立25-27歳等）
      const extraYears = Math.max(0, age - 18);
      const calculatedMean = Math.min(62, Math.round(base18 + extraYears * 1.5));

      const p = generatePlayer({
        type: position === 'P' ? 'PITCHER' : 'BATTER',
        position: position === 'P' ? undefined : position,
        age,
        debutYear: nextYear,
        baseMean: calculatedMean,
      });

      pool.push(p);
    }
  }
  return pool;
}

/** 選手の総合評価（CPU指名・並び用）。表能力ベース。 */
export function prospectScore(p: Player): number {
  if (p.type === 'PITCHER') {
    const velo = Math.max(0, Math.min(110, (p.velocity - 125) * 2.5));
    return velo * 0.35 + p.breaking * 0.35 + p.control * 0.3;
  }
  return p.contact * 0.3 + p.power * 0.3 + p.speed * 0.2 + p.defense * 0.2;
}

/** チームがそのポジションをどれだけ必要としているか（少ないほど補強優先） */
function positionNeed(team: Team, position: Position): number {
  const count = team.players.filter((p) => {
    if (position === 'P') return p.type === 'PITCHER';
    if (position === 'OF') return p.position === 'OF';
    return p.position === position;
  }).length;
  // 保有が少ないほど need 大（投手・外野は多めが普通なので基準を分ける）
  const baseline = position === 'P' ? 13 : position === 'OF' ? 6 : 3;
  return Math.max(0, baseline - count);
}

/**
 * CPU（他球団）が指名する選手を選ぶ。
 * チーム事情（不足ポジション）を加味しつつ、能力上位からランダム性強めで選ぶ。
 */
export function pickForCpu(team: Team, available: Player[]): Player | null {
  if (available.length === 0) return null;
  const scored = available.map((p) => {
    const need = positionNeed(team, p.position);
    // 能力 + 補強needボーナス + 強めのランダム
    const score = prospectScore(p) + need * 6 + Math.random() * 45;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].p;
}

/**
 * 1巡目（および外れ1巡目）におけるCPU球団の同時指名を生成する。
 * 条件: 1人の選手を指名するのは最大2球団になるように調整する。
 */
export function generateRound1CpuBids(
  unresolvedCpuTeams: Team[],
  availablePool: Player[],
): Record<string, string> {
  const bids: Record<string, string> = {};
  const prospectBidCounts: Record<string, number> = {};

  for (const team of unresolvedCpuTeams) {
    // まだ2球団から指名されていない候補のみを対象とする
    const selectable = availablePool.filter((p) => (prospectBidCounts[p.id] ?? 0) < 2);
    const pick = pickForCpu(team, selectable);
    if (pick) {
      bids[team.id] = pick.id;
      prospectBidCounts[pick.id] = (prospectBidCounts[pick.id] ?? 0) + 1;
    }
  }
  return bids;
}

/**
 * CPUチーム間の1巡目入札における競合を抽選で解決する。
 * - 単独指名は即決定（winnersに追加）。
 * - 競合していた選手は抽選で1球団のみ当選（winnersに追加）、外れた球団はlosersへ。
 */
export function resolveCpuCompetitions(cpuBids: Record<string, string>): {
  winners: Record<string, string>; // prospectId -> winningTeamId
  losers: string[]; // 外れたteamId配列
} {
  const prospectToTeams = new Map<string, string[]>();
  for (const [teamId, prospectId] of Object.entries(cpuBids)) {
    const list = prospectToTeams.get(prospectId) ?? [];
    list.push(teamId);
    prospectToTeams.set(prospectId, list);
  }

  const winners: Record<string, string> = {};
  const losers: string[] = [];

  for (const [prospectId, teams] of prospectToTeams.entries()) {
    if (teams.length === 1) {
      // 単独指名成功
      winners[prospectId] = teams[0];
    } else {
      // 競合: 抽選で1チームが当選
      const winningTeam = teams[Math.floor(Math.random() * teams.length)];
      winners[prospectId] = winningTeam;
      for (const t of teams) {
        if (t !== winningTeam) losers.push(t);
      }
    }
  }

  return { winners, losers };
}

/**
 * 1巡目の競合くじ引きセットを生成する。
 * totalCards = 自チーム1 + 競合CPU数（2または3）。
 * winningIndex = 0..(totalCards - 1) のいずれか1枚が当たり（「交渉権獲得」）。
 */
export function createLotteryDraw(competitorTeamIds: string[]): {
  totalCards: number;
  winningIndex: number;
} {
  const totalCards = competitorTeamIds.length + 1; // 2または3
  const winningIndex = Math.floor(Math.random() * totalCards);
  return { totalCards, winningIndex };
}


