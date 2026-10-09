// ============================================================
// 外国人スカウト
// 指定ポジションの新外国人選手を生成する（オフシーズンのスカウトイベント）。
// 外国人は努力値の代わりに適応値(adaptability)を持ち、成長が日本人と異なる。
// ============================================================

import type { Player, Position } from './types';
import { generatePlayer } from './playerFactory';
import { randInt } from './random';

/** 外国人の初期能力レンジ（日本人より幅広くランダム） */
const FOREIGN_MIN = 15;
const FOREIGN_MAX = 80;

const randStat = () => randInt(FOREIGN_MIN, FOREIGN_MAX);

/**
 * 指定ポジションの外国人選手を1名生成する。
 * 能力は15〜80で各能力独立にランダム（ばらつき大）。年齢20〜32、適応値1〜99。
 */
function generateForeignPlayer(position: Position, nextYear: number): Player {
  const age = randInt(20, 32);
  const p = generatePlayer({
    type: position === 'P' ? 'PITCHER' : 'BATTER',
    position: position === 'P' ? undefined : position,
    isForeign: true,
    age,
    debutYear: nextYear,
    adaptability: randInt(1, 99),
  });

  if (p.type === 'PITCHER') {
    // 球速: ランク15〜80 を km/h へ（約131〜161km/h）
    const veloRank = randStat();
    p.velocity = Math.round(125 + veloRank * 0.45);
    p.breaking = randStat();
    p.control = randStat();
    p.stamina = randStat();
  } else {
    p.contact = randStat();
    p.power = randStat();
    p.speed = randStat();
    p.defense = randStat();
  }

  return p;
}

/**
 * スカウトが提示する外国人候補（既定3名）を生成する。
 */
export function generateForeignProspects(position: Position, nextYear: number, count = 3): Player[] {
  const list: Player[] = [];
  for (let i = 0; i < count; i++) {
    list.push(generateForeignPlayer(position, nextYear));
  }
  return list;
}
