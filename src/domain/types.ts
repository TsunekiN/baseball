// 選手・チームのドメイン型定義

/** 守備位置。OFは外野共通、Pは投手 */
export type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF';

/** 選手種別 */
export type PlayerType = 'BATTER' | 'PITCHER';

/** 成長タイプ */
export type GrowthType = 'EARLY' | 'NORMAL' | 'LATE' | 'SUSTAINED';

/** 外国人選手の出身地域 */
export type Country = 'JPN' | 'USA' | 'CUB' | 'DOM' | 'VEN';

/** 能力ランク */
export type Rank = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

/** 選手モデル（仕様書 4章に準拠） */
export interface Player {
  id: string;
  name: string;
  position: Position;
  type: PlayerType;
  age: number;
  growth_type: GrowthType;

  // 野手能力 (1-100+)
  contact: number;
  power: number;
  speed: number;
  defense: number;

  // 投手能力 (投手の場合)
  stuff: number; // 球威 (1-99+, 内部パラメータ・非表示)
  velocity: number; // km/h (計算結果: 球威 ÷ 2.5 + 124。画面表示用)
  breaking: number;
  control: number;
  stamina: number;

  // メンタル・体質パラメータ (1-99)
  talent: number;
  effort: number;
  health: number;
  luck: number;
  /** 適応値(1-99)。外国人のみ使用（effortの代わりに成長/衰えを決める）。日本人は0。 */
  adaptability: number;

  // 外国人フラグ
  is_foreign: boolean;
  country: Country;

  /** プロ登録年度（入団年）。新人王資格・在籍年数の判定に使用。 */
  debutYear: number;

  /** 出身地（日本人は都道府県名、外国人は国名） */
  hometown: string;
  /** 投球腕（L=左投 / R=右投） */
  throws: 'L' | 'R';
  /** 打席（L=左打 / R=右打 / S=両打） */
  bats: 'L' | 'R' | 'S';
}

/** リーグ区分 */
export type League = 'CENTRAL' | 'PACIFIC';

/** 一軍/二軍/故障者リストの登録区分 */
export type RosterLevel = 'FIRST' | 'FARM' | 'IL';

/** チームモデル */
export interface Team {
  id: string;
  name: string;
  shortName: string;
  /** 通称（順位表など一覧向けの短縮名。例: ヤクルト, DeNA, 日ハム） */
  nickName: string;
  /** 対戦表記用の1文字（例: ヤ, 中, 巨） */
  markChar: string;
  league: League;
  colorPrimary: string;
  players: Player[]; // 保有選手（最大50名）
  /** playerId -> 登録区分 */
  rosterLevel: Record<string, RosterLevel>;
}

/** チーム戦力（S〜Hランク評価対象の数値） */
export interface TeamStrength {
  batting: number; // 打力
  running: number; // 走力
  fielding: number; // 守備力
  pitching: number; // 投手力
  depth: number; // 選手層
  total: number; // 総合力
}

// ============================================================
// オーダー（打順・守備・投手起用）
// ============================================================

/** スタメンの守備位置。全試合DH制なのでDHを含む8守備位置。 */
export type FieldPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';

/** 守備位置の並び順（表示・自動編成用） */
export const FIELD_POSITIONS: FieldPosition[] = [
  'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH',
];

/** 打順1枠の割り当て（打者1名＝1守備位置） */
export interface LineupSlot {
  playerId: string;
  position: FieldPosition;
}

/** 投手の起用役割 */
export type PitcherRole =
  | 'STARTER' // 先発ローテーション（6名）
  | 'SETUP' // 勝ちパ・セットアッパー（1名）
  | 'CLOSER' // 勝ちパ・抑え（1名）
  | 'MIDDLE'; // 中継ぎ（6名）

/** 投手起用の割り当て */
export interface PitcherAssignment {
  playerId: string;
  role: PitcherRole;
  /** 先発の場合のローテーション順（1〜6）。それ以外はundefined */
  rotationOrder?: number;
}

/** チームのオーダー全体 */
export interface TeamOrder {
  /** 打順1〜9（配列インデックス0=1番打者） */
  lineup: LineupSlot[];
  /** 投手起用 */
  pitchers: PitcherAssignment[];
  /** 一軍控え野手のplayerId（表示・並べ替え順） */
  benchBatters: string[];
  /** 二軍野手のplayerId（表示・並べ替え順） */
  farmBatters: string[];
  /** 二軍投手のplayerId（表示・並べ替え順） */
  farmPitchers: string[];
}

/**
 * 球威から球速(km/h)を算出する計算式。
 * 球速 ＝ 球威 ÷ 2.5 ＋ 124
 */
export function calcVelocity(stuff: number): number {
  return Math.round(stuff / 2.5 + 124);
}

/**
 * 球速(km/h)から球威を逆算する（既存セーブデータ・過去履歴移行用）。
 * 球威 ＝ (球速 − 124) × 2.5
 */
export function calcStuff(velocity: number): number {
  return Math.round((velocity - 124) * 2.5);
}

/**
 * 投手の球威（stuff）を取得する。
 * 未設定・欠損時は球速(km/h)から逆算して安全に返す。
 */
export function getPitcherStuff(p: { velocity: number; stuff?: number }): number {
  return p.stuff ?? calcStuff(p.velocity);
}

