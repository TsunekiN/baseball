// ============================================================
// 外国人スカウト
// 指定ポジションの新外国人選手を生成する（オフシーズンのスカウトイベント）。
// 外国人は努力値の代わりに適応値(adaptability)を持ち、成長が日本人と異なる。
// ============================================================

import { calcVelocity, type Player, type Position } from './types';
import { generatePlayer, generateTalent } from './playerFactory';
import { randInt } from './random';
import { ADAPTABILITY_MIN, ADAPTABILITY_MAX, TALENT_MIN, TALENT_MAX } from './growthEngine';

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
 * 主要4能力は20〜80（最低1項目は70以上）。年齢20〜29、健康30〜99、才能・適応は上限95。
 */
function generateForeignPlayer(position: Position, nextYear: number): Player {
  const age = randInt(20, 29);
  const p = generatePlayer({
    type: position === 'P' ? 'PITCHER' : 'BATTER',
    position: position === 'P' ? undefined : position,
    isForeign: true,
    age,
    debutYear: nextYear,
    adaptability: randInt(ADAPTABILITY_MIN, ADAPTABILITY_MAX),
  });

  // 健康は30～99、適応は5～95、才能は下限45〜上限95で高い値ほど出にくい分布
  p.health = randInt(30, 99);
  p.adaptability = randInt(ADAPTABILITY_MIN, ADAPTABILITY_MAX);
  p.talent = generateTalent(TALENT_MIN, TALENT_MAX);

  const [s1, s2, s3, s4] = generateForeignCoreStats();

  if (p.type === 'PITCHER') {
    // 球威: ランク20〜80、球速は計算式 (球威÷2.5＋124) で算出（約132〜156km/h）
    p.stuff = s1;
    p.velocity = calcVelocity(s1);
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
