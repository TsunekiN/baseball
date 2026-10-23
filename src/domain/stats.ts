import { getPitcherStuff, type Player } from './types';
import type { SeasonStatLine } from './gameState';
import type { SeasonBatting, SeasonPitching } from '../match/matchStats';
import {
  battingAvg, battingObp, battingSlg, battingOps,
  pitchingEra, pitchingWhip, pitchingWinPct,
} from '../match/matchStats';

// ============================================================
// 成績データモデルと、能力ベースのダミー成績生成
// ※ フェーズ2時点では試合結果が無いため、選手能力から擬似的な
//   シーズン成績を決定的に生成する（同じ選手なら常に同じ値）。
//   フェーズ3の試合エンジン導入後、実集計に差し替える。
// ============================================================

const GAMES = 143;

/** 野手のシーズン成績 */
export interface BattingStats {
  games: number;
  ab: number; // 打数
  hits: number; // 安打
  hr: number; // 本塁打
  rbi: number; // 打点
  runs: number; // 得点
  bb: number; // 四球
  so: number; // 三振
  sb: number; // 盗塁
  avg: number; // 打率
  obp: number; // 出塁率
  slg: number; // 長打率
  ops: number; // OPS
  errors: number; // 失策
  qualified: boolean; // 規定打席到達
}

/** 投手のシーズン成績 */
export interface PitchingStats {
  games: number;
  wins: number;
  losses: number;
  saves: number; // セーブ
  holds: number; // ホールド
  ip: number; // 投球回
  so: number; // 奪三振
  bb: number; // 与四球
  hits: number; // 被安打
  er: number; // 自責点
  era: number; // 防御率
  whip: number;
  winPct: number; // 勝率
  errors: number; // 失策
  qualified: boolean; // 規定投球回到達
}

/** 選手 + 成績（ランキング/一覧用） */
export interface BattingRow {
  player: Player;
  stats: BattingStats;
}
export interface PitchingRow {
  player: Player;
  stats: PitchingStats;
}

// ---- 決定的な擬似乱数（選手idベース） ----
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 投手能力を0-100スケールの総合質に換算 */
function pitcherQuality(p: Player): number {
  const stuff = getPitcherStuff(p);
  return (stuff + p.control + p.breaking) / 3;
}

/** 野手のダミー成績を生成 */
export function makeBattingStats(p: Player): BattingStats {
  const r = hash(p.id + 'bat');
  const r2 = hash(p.id + 'bat2');
  // 出場度合い（能力が高いほど打数が多い＝主力）
  const overall = (p.contact + p.power) / 2;
  const ab = Math.round(clamp(overall * 4 + 120 + r * 120, 60, 620));
  const avg = clamp(0.21 + (p.contact - 60) * 0.0022 + (r - 0.5) * 0.03, 0.17, 0.37);
  const hits = Math.round(ab * avg);
  const hr = Math.round(clamp((p.power - 40) * 0.5 * (ab / 550) + r2 * 4, 0, 60));
  const rbi = Math.round(hr * 2.4 + hits * 0.22 + r * 10);
  const runs = Math.round(hits * 0.45 + hr * 0.6 + r2 * 8);
  const bb = Math.round(ab * (0.07 + (p.contact - 60) * 0.0008) + r * 15);
  const so = Math.round(ab * (0.18 - (p.contact - 60) * 0.0006) + r2 * 15);
  const sb = Math.round(clamp((p.speed - 60) * 0.55 + r * 4, 0, 60));
  const pa = ab + bb;
  const obp = clamp((hits + bb) / pa, 0.2, 0.48);
  const slg = clamp(avg + (p.power - 45) * 0.0032 + hr / Math.max(ab, 1) * 1.2, 0.25, 0.75);
  const ops = obp + slg;
  const qualified = ab >= 380; // 規定打席の簡易判定

  return { games: GAMES, ab, hits, hr, rbi, runs, bb, so, sb, avg, obp, slg, ops, errors: 0, qualified };
}

/** 投手のダミー成績を生成 */
export function makePitchingStats(p: Player): PitchingStats {
  const r = hash(p.id + 'pit');
  const r2 = hash(p.id + 'pit2');
  const q = pitcherQuality(p);
  // 投球回（スタミナが多いほど多い＝先発格）
  const ip = Math.round(clamp(p.stamina * 1.4 + 30 + r * 40, 20, 210));
  const era = clamp(6.2 - q * 0.04 + (r - 0.5) * 0.9, 1.2, 6.5);
  const er = Math.round((era * ip) / 9);
  const so = Math.round(ip * (0.6 + q * 0.004) + r2 * 15);
  const bb = Math.round(ip * (0.42 - p.control * 0.0016) + r * 10);
  const hits = Math.round(ip * (1.05 - q * 0.002));
  const whip = (bb + hits) / Math.max(ip, 1);
  const isStarter = ip >= 100;
  const wins = Math.round(clamp(ip / 160 * 14 - (era - 3.5) * 2 + r * 3, 0, 22));
  const losses = Math.round(clamp(8 + (era - 3.5) * 2 - r2 * 3, 0, 18));
  // リリーフ格にセーブ/ホールドを付与
  const saves = !isStarter && r > 0.75 ? Math.round(clamp(q * 0.4 + r2 * 15, 0, 45)) : 0;
  const holds = !isStarter && saves === 0 ? Math.round(clamp(q * 0.3 + r * 20, 0, 40)) : 0;
  const winPct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const qualified = ip >= 143; // 規定投球回の簡易判定

  return { games: isStarter ? Math.round(ip / 6) : Math.round(ip / 1.2), wins, losses, saves, holds, ip, so, bb, hits, er, era, whip, winPct, errors: 0, qualified };
}

// ============================================================
// 実集計(SeasonBatting/SeasonPitching) → 表示用(BattingStats/PitchingStats) 変換
// ============================================================

/** 規定打席 */
const QUAL_PA = 443;
/** 規定投球回（アウト数） */
const QUAL_OUTS = 143 * 3;

/** 実集計の打撃成績を表示用 BattingStats へ変換 */
export function toBattingStats(s: SeasonBatting): BattingStats {
  return {
    games: s.games,
    ab: s.ab,
    hits: s.hits,
    hr: s.hr,
    rbi: s.rbi,
    runs: s.runs,
    bb: s.bb,
    so: s.so,
    sb: s.sb,
    avg: battingAvg(s),
    obp: battingObp(s),
    slg: battingSlg(s),
    ops: battingOps(s),
    errors: s.errors,
    qualified: s.ab + s.bb >= QUAL_PA,
  };
}

/** 実集計の投手成績を表示用 PitchingStats へ変換 */
export function toPitchingStats(s: SeasonPitching): PitchingStats {
  return {
    games: s.games,
    wins: s.wins,
    losses: s.losses,
    saves: s.saves,
    holds: s.holds,
    ip: s.outs / 3,
    so: s.so,
    bb: s.bb,
    hits: s.hits,
    er: Math.max(0, s.runs - s.unearnedRuns), // 自責点（失策絡みを除く）
    era: pitchingEra(s),
    whip: pitchingWhip(s),
    winPct: pitchingWinPct(s),
    errors: s.errors,
    qualified: s.outs >= QUAL_OUTS,
  };
}

// ============================================================
// ランキング指標定義
// ============================================================

export interface BattingMetric {
  key: string;
  label: string;
  get: (s: BattingStats) => number;
  format: (v: number) => string;
  higherIsBetter: boolean;
  /** ランキング対象に規定到達が必要か（率系） */
  requiresQualified?: boolean;
}

export interface PitchingMetric {
  key: string;
  label: string;
  get: (s: PitchingStats) => number;
  format: (v: number) => string;
  higherIsBetter: boolean;
  requiresQualified?: boolean;
}

const avg3 = (v: number) => v.toFixed(3).replace(/^0/, '');
const dec2 = (v: number) => v.toFixed(2);
const int0 = (v: number) => String(Math.round(v));

export const BATTING_METRICS: BattingMetric[] = [
  { key: 'avg', label: '打率', get: (s) => s.avg, format: avg3, higherIsBetter: true, requiresQualified: true },
  { key: 'hr', label: '本塁打', get: (s) => s.hr, format: int0, higherIsBetter: true },
  { key: 'rbi', label: '打点', get: (s) => s.rbi, format: int0, higherIsBetter: true },
  { key: 'hits', label: '安打', get: (s) => s.hits, format: int0, higherIsBetter: true },
  { key: 'obp', label: '出塁率', get: (s) => s.obp, format: avg3, higherIsBetter: true, requiresQualified: true },
  { key: 'ops', label: 'OPS', get: (s) => s.ops, format: (v) => v.toFixed(3), higherIsBetter: true, requiresQualified: true },
  { key: 'sb', label: '盗塁', get: (s) => s.sb, format: int0, higherIsBetter: true },
];

export const PITCHING_METRICS: PitchingMetric[] = [
  { key: 'era', label: '防御率', get: (s) => s.era, format: dec2, higherIsBetter: false, requiresQualified: true },
  { key: 'wins', label: '勝利', get: (s) => s.wins, format: int0, higherIsBetter: true },
  { key: 'so', label: '奪三振', get: (s) => s.so, format: int0, higherIsBetter: true },
  { key: 'winPct', label: '勝率', get: (s) => s.winPct, format: avg3, higherIsBetter: true, requiresQualified: true },
  { key: 'saves', label: 'セーブ', get: (s) => s.saves, format: int0, higherIsBetter: true },
  { key: 'holds', label: 'ホールド', get: (s) => s.holds, format: int0, higherIsBetter: true },
  { key: 'whip', label: 'WHIP', get: (s) => s.whip, format: dec2, higherIsBetter: false, requiresQualified: true },
];

// ============================================================
// 年度別 / 通算 / 殿堂（フェーズ3で実データ化）
// ============================================================

/** 年度別成績1行（野手 or 投手） */
export interface SeasonRecord {
  year: number;
  teamName: string;
  batting?: BattingStats;
  pitching?: PitchingStats;
}

/** 通算成績 */
export interface CareerRecord {
  seasons: number;
  batting?: BattingStats;
  pitching?: PitchingStats;
}

/** タイトル獲得回数（0は未獲得） */
export interface TitleCounts {
  crown: number; // 三冠王
  battingAvg: number; // 首位打者
  hr: number; // 最多本塁打
  rbi: number; // 最多打点
  hits: number; // 最多安打
  obp: number; // 最高出塁率
  sb: number; // 盗塁王
  era: number; // 最優秀防御率
  wins: number; // 最多勝利
  so: number; // 最多奪三振
  winPct: number; // 最高勝率
  saves: number; // 最多セーブ
  holds: number; // 最多ホールド
  mvp: number; // MVP
  rookie: number; // 新人王
  sawamura: number; // 沢村賞
}

/** 全タイトル0で初期化 */
export function emptyTitleCounts(): TitleCounts {
  return {
    crown: 0, battingAvg: 0, hr: 0, rbi: 0, hits: 0, obp: 0, sb: 0,
    era: 0, wins: 0, so: 0, winPct: 0, saves: 0, holds: 0,
    mvp: 0, rookie: 0, sawamura: 0,
  };
}

/** タイトルの表示順・ラベル（三冠王を先頭に） */
export const TITLE_DEFS: { key: keyof TitleCounts; label: string }[] = [
  { key: 'crown', label: '三冠王' },
  { key: 'mvp', label: 'MVP' },
  { key: 'sawamura', label: '沢村賞' },
  { key: 'rookie', label: '新人王' },
  { key: 'battingAvg', label: '首位打者' },
  { key: 'hr', label: '本塁打王' },
  { key: 'rbi', label: '打点王' },
  { key: 'hits', label: '最多安打' },
  { key: 'obp', label: '最高出塁率' },
  { key: 'sb', label: '盗塁王' },
  { key: 'era', label: '最優秀防御率' },
  { key: 'wins', label: '最多勝利' },
  { key: 'so', label: '最多奪三振' },
  { key: 'winPct', label: '最高勝率' },
  { key: 'saves', label: '最多セーブ' },
  { key: 'holds', label: '最多ホールド' },
];

/** 殿堂入り選手 */
export interface HallOfFamer {
  player: Player;
  joinYear: number; // 入団年度
  leaveYear: number; // 退団年度
  career: CareerRecord;
  titles: TitleCounts;
  /** 年度別成績（能力推移・年度別表示用。新しい年が先頭） */
  seasons?: SeasonStatLine[];
}

/**
 * 殿堂入り資格を満たすか判定
 * - 打者: 1600本安打以上 or 300本塁打以上
 * - 投手: 150勝以上 or (セーブ+ホールドの合計) >= 200
 */
export function meetsHofCriteria(totals?: {
  batting?: { hits?: number; hr?: number };
  pitching?: { wins?: number; saves?: number; holds?: number };
}): boolean {
  if (!totals) return false;
  const b = totals.batting;
  const p = totals.pitching;
  if (b && ((b.hits ?? 0) >= 1600 || (b.hr ?? 0) >= 300)) return true;
  if (p && ((p.wins ?? 0) >= 150 || ((p.saves ?? 0) + (p.holds ?? 0)) >= 200)) return true;
  return false;
}

/** 殿堂入り選手オブジェクトが新基準を満たしているか（過去の殿堂入りデータの整理・検証用） */
export function isHallOfFamerQualified(hof: HallOfFamer): boolean {
  return meetsHofCriteria(hof.career);
}


