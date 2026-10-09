import type { BatterLine, PitcherLine } from './matchTypes';

/** 打者の累計シーズン成績（実データ） */
export interface SeasonBatting {
  games: number;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  runs: number;
  bb: number;
  hbp: number; // 死球
  so: number;
  sac: number; // 犠打（犠牲バント）
  sf: number; // 犠飛（犠牲フライ）
  sb: number; // 盗塁
  errors: number; // 失策（守備）
}

/** 投手の累計シーズン成績（実データ） */
export interface SeasonPitching {
  games: number; // 登板
  outs: number; // 取ったアウト数（IP×3）
  batters: number;
  hits: number;
  hr: number;
  bb: number;
  hbp: number; // 与死球
  so: number;
  runs: number; // 失点
  unearnedRuns: number; // 非自責失点（失策絡み）
  wins: number;
  losses: number;
  saves: number;
  holds: number;
  errors: number; // 失策（守備）
}

/** 選手の累計成績（打撃・投手） */
export interface PlayerSeasonStats {
  batting?: SeasonBatting;
  pitching?: SeasonPitching;
}

export function emptyBatting(): SeasonBatting {
  return { games: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, so: 0, sac: 0, sf: 0, sb: 0, errors: 0 };
}
export function emptyPitching(): SeasonPitching {
  return {
    games: 0, outs: 0, batters: 0, hits: 0, hr: 0, bb: 0, hbp: 0, so: 0, runs: 0, unearnedRuns: 0,
    wins: 0, losses: 0, saves: 0, holds: 0, errors: 0,
  };
}

/** 打者の1試合成績を累計へ加算 */
export function accumulateBatting(acc: SeasonBatting, line: BatterLine): void {
  // 出場（打席がある or 打数がある）試合のみ試合数カウント
  if (line.ab > 0 || line.bb > 0) acc.games++;
  acc.ab += line.ab;
  acc.hits += line.hits;
  acc.doubles += line.doubles;
  acc.triples += line.triples;
  acc.hr += line.hr;
  acc.rbi += line.rbi;
  acc.runs += line.runs;
  acc.bb += line.bb;
  acc.hbp += line.hbp;
  acc.so += line.so;
  acc.sac += line.sac;
  acc.sf += line.sf;
  acc.sb += line.sb;
}

/** 投手の1試合成績を累計へ加算 */
export function accumulatePitching(acc: SeasonPitching, line: PitcherLine): void {
  if (line.batters > 0) acc.games++;
  acc.outs += line.outs;
  acc.batters += line.batters;
  acc.hits += line.hits;
  acc.hr += line.hr;
  acc.bb += line.bb;
  acc.hbp += line.hbp;
  acc.so += line.so;
  acc.runs += line.runs;
  acc.unearnedRuns += line.unearnedRuns;
  if (line.win) acc.wins++;
  if (line.loss) acc.losses++;
  if (line.save) acc.saves++;
  if (line.hold) acc.holds++;
}

// ---- 導出値 ----
export function battingAvg(s: SeasonBatting): number {
  return s.ab > 0 ? s.hits / s.ab : 0;
}
export function battingObp(s: SeasonBatting): number {
  // 出塁率 = (安打 + 四球 + 死球) / (打数 + 四球 + 死球 + 犠飛)
  const denom = s.ab + s.bb + s.hbp + s.sf;
  return denom > 0 ? (s.hits + s.bb + s.hbp) / denom : 0;
}
export function battingSlg(s: SeasonBatting): number {
  if (s.ab === 0) return 0;
  const singles = s.hits - s.doubles - s.triples - s.hr;
  const tb = singles + s.doubles * 2 + s.triples * 3 + s.hr * 4;
  return tb / s.ab;
}
export function battingOps(s: SeasonBatting): number {
  return battingObp(s) + battingSlg(s);
}
export function pitchingEra(s: SeasonPitching): number {
  const ip = s.outs / 3;
  const earned = Math.max(0, s.runs - s.unearnedRuns); // 自責点
  return ip > 0 ? (earned * 9) / ip : 0;
}
export function pitchingWhip(s: SeasonPitching): number {
  const ip = s.outs / 3;
  return ip > 0 ? (s.bb + s.hits) / ip : 0;
}
export function pitchingWinPct(s: SeasonPitching): number {
  const d = s.wins + s.losses;
  return d > 0 ? s.wins / d : 0;
}
