import { getPitcherStuff, type Player } from '../domain/types';
import type { AtBatOutcome } from './matchTypes';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 1打席の結果を判定する。
 * @param batter 打者
 * @param pitcher 投手
 * @param stamina 投手の残スタミナ係数(0..1)。疲労で能力低下。
 * @param rng 0..1 の乱数生成器
 */
export function simulateAtBat(
  batter: Player,
  pitcher: Player,
  stamina: number,
  rng: () => number,
  batterIsHome = false,
): AtBatOutcome {
  const stamFactor = 0.72 + 0.28 * clamp(stamina, 0, 1); // 疲労時は最大28%減

  // 投手支配力（0〜110程度）
  const dom =
    (getPitcherStuff(pitcher) * 0.35 + pitcher.breaking * 0.35 + pitcher.control * 0.3) *
    stamFactor;

  // 打者総合力（ミート重視）
  const bat = batter.contact * 0.55 + batter.power * 0.45;

  const diff = bat - dom; // 正=打者有利

  // 幸運（僅差の微補正）。ホーム打者はアドバンテージで幸運+5
  const batterLuck = batter.luck + (batterIsHome ? 5 : 0);
  const luck = ((batterLuck - pitcher.luck) / 100) * 3;
  const adjDiff = diff + luck;

  // 各確率（打撃抑制の調整: 好打者 vs 並投手帯の打ちすぎ・本塁打過多を抑える。投手支配力 dom は不変）
  const kRate = clamp(0.25 - adjDiff * 0.0075 + (dom - 60) * 0.0034, 0.07, 0.52);
  const bbRate = clamp(0.066 - (pitcher.control - 60) * 0.0015 + (batter.contact - 60) * 0.0004, 0.02, 0.14);
  // 本塁打はパワー依存を「二次関数」にして、中位は控えめ・上位で急増させる。
  // power60=基礎のみ、power100で約40本/143試合、power120+の天才はそれを大きく超える。
  const powExcess = Math.max(0, batter.power - 60);
  const hrRate = clamp(0.009 + (powExcess * powExcess / 1600) * 0.061 - (dom - 60) * 0.0028, 0.001, 0.12);

  const rem = Math.max(0, 1 - kRate - bbRate - hrRate); // インプレー(non-HR)
  // BABIP上限を高めにして、好打者（高diff）の首位打者が.310〜.320、天才はそれ以上に届くように。
  const babip = clamp(0.212 + adjDiff * 0.0019, 0.15, 0.34);
  const hitInPlay = rem * babip;

  // 判定（累積確率）
  let r = rng();
  if ((r -= hrRate) < 0) return 'HR';
  if ((r -= kRate) < 0) return 'K';
  if ((r -= bbRate) < 0) return 'BB';
  // インプレー安打
  if ((r -= hitInPlay) < 0) {
    // 長打種別（パワーで二塁打が増える）
    const doubleShare = clamp(0.18 + (batter.power - 60) * 0.0015, 0.1, 0.32);
    const tripleShare = clamp(0.02 + (batter.speed - 60) * 0.0006, 0.005, 0.05);
    const s = rng();
    if (s < tripleShare) return '3B';
    if (s < tripleShare + doubleShare) return '2B';
    return '1B';
  }
  return 'OUT';
}
