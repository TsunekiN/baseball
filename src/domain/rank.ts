import type { Rank } from './types';

/**
 * 能力値(1-100+)からランクを判定する。
 * 仕様書 4章の能力値数値の区分に準拠。
 *  SS: 100以上 / S: 90-99 / A: 80-89 / B: 70-79 / C: 60-69
 *  D: 50-59 / E: 40-49 / F: 30-39 / G: 20-29 / H: 20未満
 */
export function rankFromValue(value: number): Rank {
  if (value >= 100) return 'SS';
  if (value >= 90) return 'S';
  if (value >= 80) return 'A';
  if (value >= 70) return 'B';
  if (value >= 60) return 'C';
  if (value >= 50) return 'D';
  if (value >= 40) return 'E';
  if (value >= 30) return 'F';
  if (value >= 20) return 'G';
  return 'H';
}

/**
 * 投手の球速(km/h)からランクを判定する。
 * 仕様書 4章の球速基準に準拠。
 *  SS: 162以上 / S: 158-161 / A: 154-157 / B: 150-153 / C: 146-149
 *  D: 142-145 / E: 138-141 / F: 134-137 / G: 130-133 / H: 130未満
 */
export function rankFromVelocity(kmh: number): Rank {
  if (kmh >= 162) return 'SS';
  if (kmh >= 158) return 'S';
  if (kmh >= 154) return 'A';
  if (kmh >= 150) return 'B';
  if (kmh >= 146) return 'C';
  if (kmh >= 142) return 'D';
  if (kmh >= 138) return 'E';
  if (kmh >= 134) return 'F';
  if (kmh >= 130) return 'G';
  return 'H';
}

/**
 * ランクごとの表示色。
 * 仕様書指定:
 *  SS/S = ゴールド, A = 赤, B = オレンジ,
 *  能力が低いほど寒色系, G = グレー, H = 黒に近いグレー。
 * 文字色(fg)と背景色(bg)のペアで返す。
 */
export interface RankColor {
  fg: string;
  bg: string;
  border: string;
}

const RANK_COLORS: Record<Rank, RankColor> = {
  // ゴールド系
  SS: { fg: '#3a2c00', bg: '#ffd447', border: '#f5c518' },
  S: { fg: '#3a2c00', bg: '#ffdf6b', border: '#f5c518' },
  // 赤
  A: { fg: '#ffffff', bg: '#e23b3b', border: '#c62828' },
  // オレンジ
  B: { fg: '#3a1e00', bg: '#ff9f43', border: '#f57c00' },
  // ここから寒色系へ（能力が低いほど寒色）
  C: { fg: '#08343a', bg: '#8fe3d8', border: '#4db6ac' }, // ティール
  D: { fg: '#062a3a', bg: '#7fc9e8', border: '#4a9fd0' }, // ライトブルー
  E: { fg: '#ffffff', bg: '#4a8bd6', border: '#3a6fb0' }, // ブルー
  F: { fg: '#ffffff', bg: '#4a5fb0', border: '#3a4a8f' }, // 濃いブルー
  // グレー
  G: { fg: '#ffffff', bg: '#8a8f99', border: '#6f757f' },
  // 黒に近いグレー
  H: { fg: '#d8d8d8', bg: '#33373d', border: '#22262b' },
};

export function rankColor(rank: Rank): RankColor {
  return RANK_COLORS[rank];
}

/**
 * 能力値の表示用整数。能力は内部的に小数で保持するため、
 * 画面表示時はこの関数で四捨五入する。
 */
export function displayAbility(value: number): number {
  return Math.round(value);
}
