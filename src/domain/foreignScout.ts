// ============================================================
// 外国人スカウト
// 指定ポジションの新外国人選手を生成する（オフシーズンのスカウトイベント）。
// 外国人は努力値の代わりに適応値(adaptability)を持ち、成長が日本人と異なる。
// ============================================================

import type { Player, Position } from './types';
import { generatePlayer } from './playerFactory';
import { randInt } from './random';

/** 外国人の初期能力レンジ（20〜80、最低1項目が70以上） */
const FOREIGN_MIN = 20;
const FOREIGN_MAX = 80;

/** 4つの主要能力を生成。各20〜80、最低1つは70以上を保証 */
function generateForeignCoreStats(): [number, number, number, number] {
  let stats: [number, number, number, number];
  do {
    stats = [
      randInt(FOREIGN_MIN, FOREIGN_MAX),
      randInt(FOREIGN_MIN, FOREIGN_MAX),
      randInt(FOREIGN_MIN, FOREIGN_MAX),
      randInt(FOREIGN_MIN, FOREIGN_MAX),
    ];
  } while (Math.max(...stats) < 70);
  return stats;
}

/**
 * 指定ポジションの外国人選手を1名生成する。
 * 主要4能力は20〜80（最低1項目は70以上）。年齢20〜32、健康・才能・適応は1〜99。
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

  // 健康は30～99、適応は1～99の完全ランダム（才能は初期実力に応じた適正値）
  p.health = randInt(30, 99);
  p.adaptability = randInt(1, 99);

  const [s1, s2, s3, s4] = generateForeignCoreStats();

  if (p.type === 'PITCHER') {
    // 球速: ランク20〜80 を km/h へ（約134〜161km/h）
    p.velocity = Math.round(125 + s1 * 0.45);
    p.breaking = s2;
    p.control = s3;
    p.stamina = s4;
  } else {
    p.contact = s1;
    p.power = s2;
    p.speed = s3;
    p.defense = s4;
  }

  return p;
}

/**
 * スカウトが提示する外国人候補（既定5名）を生成する。
 */
export function generateForeignProspects(position: Position, nextYear: number, count = 5): Player[] {
  const list: Player[] = [];
  for (let i = 0; i < count; i++) {
    list.push(generateForeignPlayer(position, nextYear));
  }
  return list;
}
