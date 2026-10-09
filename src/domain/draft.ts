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
      const p = generatePlayer({
        type: position === 'P' ? 'PITCHER' : 'BATTER',
        position: position === 'P' ? undefined : position,
        age,
        debutYear: nextYear,
      });

      // 18歳高校生基準の初期能力ベース (15〜55のランダム)
      const base18 = 15 + Math.random() * 40; // 15〜55
      // 年齢増加分（年数）
      const extraYears = Math.max(0, age - 18);
      // 才能・努力に応じた年あたり成長加算（0.8〜2.5pt/年程度）
      const growthRate = 0.5 + ((p.talent + p.effort) / 198) * 2.2;
      const calculatedMean = Math.min(65, Math.round(base18 + extraYears * growthRate));

      const clampStat = (val: number) => Math.max(15, Math.min(65, Math.round(val)));

      // 表能力を再設定
      if (p.type === 'PITCHER') {
        // 球速: 15〜65のランク値に対応させると 126km/h 〜 152km/h
        const velo = Math.max(126, Math.min(154, Math.round(124 + calculatedMean * 0.45 + (Math.random() * 6 - 3))));
        p.velocity = velo;
        p.breaking = clampStat(calculatedMean + (Math.random() * 12 - 6));
        p.control = clampStat(calculatedMean + (Math.random() * 12 - 6));
        p.stamina = clampStat(calculatedMean + (Math.random() * 12 - 6));
      } else {
        p.contact = clampStat(calculatedMean + (Math.random() * 12 - 6));
        p.power = clampStat(calculatedMean + (Math.random() * 12 - 6));
        p.speed = clampStat(calculatedMean + (Math.random() * 12 - 6));
        p.defense = clampStat(calculatedMean + (Math.random() * 12 - 6));
      }

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
 * マイチームが1巡目に指名した選手に対する他球団の競合判定。
 * 他の11球団のうち、最大2球団が競合（マイチーム含めて最大3チーム）。
 * @returns 競合するCPUチームID配列（0〜2チーム）
 */
export function determineFirstRoundCompetitors(prospect: Player, cpuTeams: Team[]): string[] {
  const score = prospectScore(prospect);
  // 能力が高いほど競合確率が高い（0%〜最大80%）
  const pCompete = Math.max(0, Math.min(0.8, (score - 45) / 55));
  const competitors: string[] = [];

  // CPUチームをランダムにシャッフルして判定
  const shuffled = [...cpuTeams].sort(() => Math.random() - 0.5);
  for (const t of shuffled) {
    if (competitors.length >= 2) break; // 最大3チーム競合（自チーム+CPU2チーム）
    if (Math.random() < pCompete) {
      competitors.push(t.id);
    }
  }
  return competitors;
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

