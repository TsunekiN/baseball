// 試合シミュレーションの結果型

/** 1打席の結果種別 */
export type AtBatOutcome =
  | 'K' // 三振
  | 'BB' // 四球
  | 'OUT' // 凡打（インプレーのアウト）
  | '1B' // 単打
  | '2B' // 二塁打
  | '3B' // 三塁打
  | 'HR'; // 本塁打

/** 攻撃の表裏 */
export type Half = 'T' | 'B'; // T=表(ビジター攻撃) / B=裏(ホーム攻撃)

/** アウトの細分（犠打・犠飛・ゴロの間の得点・内野安打） */
export type AtBatSubType = 'sacBunt' | 'sacFly' | 'groundRBI' | 'infieldHit';

/** 1打席のログ */
export interface PlateAppearance {
  inning: number; // 回（1〜）
  half: Half;
  batterId: string;
  batterName: string;
  pitcherId: string;
  pitcherName: string;
  outcome: AtBatOutcome;
  /** 結果の説明文（表示用の基本種別名） */
  desc: string;
  /** この打席で入った得点 */
  runsScored: number;
  /** 打席後のアウトカウント（0〜3） */
  outs: number;
  /** 打席前の両チーム得点（状況判定用） */
  awayScoreBefore: number;
  homeScoreBefore: number;
  /** 打席前の塁上走者数（0〜3） */
  runnersOn: number;
  /** この打席から投手が交代したか */
  pitcherChanged: boolean;
  /** アウトの細分（犠打・犠飛・ゴロの間の得点） */
  subType?: AtBatSubType;
  /** 詳細な打球結果の表記（例: 二ゴロ、レフトフライ、併殺打、内野安打）。イニング詳細表示用 */
  outDesc?: string;
}

/** 投手の1試合成績 */
export interface PitcherLine {
  playerId: string;
  name: string;
  outs: number; // 取ったアウト数（投球回×3）
  batters: number; // 対戦打者数
  hits: number; // 被安打
  hr: number; // 被本塁打
  bb: number; // 与四球
  hbp: number; // 与死球
  so: number; // 奪三振
  runs: number; // 失点
  unearnedRuns: number; // 非自責失点（失策絡み。防御率から除外）
  win: boolean;
  loss: boolean;
  save: boolean;
  hold: boolean;
}

/** 打者の1試合成績 */
export interface BatterLine {
  playerId: string;
  name: string;
  ab: number; // 打数
  hits: number; // 安打
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  runs: number; // 得点
  bb: number;
  hbp: number; // 死球
  so: number;
  sac: number; // 犠打（犠牲バント）
  sf: number; // 犠飛（犠牲フライ）
  sb: number; // 盗塁
}

/** 各回の得点 */
export interface InningScore {
  top: number | null; // ビジター（nullは未実施＝サヨナラで裏なし等）
  bottom: number | null; // ホーム
}

/** 試合結果 */
export interface GameResult {
  awayTeamId: string;
  homeTeamId: string;
  awayScore: number;
  homeScore: number;
  awayHits: number;
  homeHits: number;
  innings: InningScore[];
  winnerId: string | null; // 引き分けはnull
  loserId: string | null;
  draw: boolean;
  extra: boolean; // 延長ありか
  log: PlateAppearance[];
  awayPitchers: PitcherLine[];
  homePitchers: PitcherLine[];
  awayBatters: BatterLine[];
  homeBatters: BatterLine[];
  /** マイチームの試合レポート用（進行時に付加。CPU同士では省略） */
  achievements?: string[]; // 達成記録
  injuries?: InjuryReport[]; // 負傷
  returns?: string[]; // ケガから復帰した選手名
  /** この試合の守備失策（playerId -> 失策数）。両チーム分 */
  fieldErrors?: Record<string, number>;
}

/** 負傷レポート */
export interface InjuryReport {
  playerId: string;
  name: string;
  games: number; // 離脱試合数
  severe: boolean; // 60試合以上=大ケガ
}
