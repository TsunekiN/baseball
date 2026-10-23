import { calcVelocity, type GrowthType, type Player, type PlayerType, type Position } from './types';
import { generateForeignName, generateJapaneseName } from './names';
import { gaussian, pick, randInt } from './random';
import { SEASON_START_YEAR } from './schedule';

export function generateUniquePlayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `p_${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `p_${time}_${rand}`;
}

const GROWTH_TYPES: GrowthType[] = ['EARLY', 'NORMAL', 'LATE', 'SUSTAINED'];

/** 野手の守備位置プール（スタメン9名を組みやすいよう分布させる） */
const BATTER_POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF'];

/** 出身地（都道府県。野球所縁の地を中心に） */
const PREFECTURES = [
  '北海道', '青森', '宮城', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京',
  '神奈川', '新潟', '富山', '石川', '長野', '岐阜', '静岡', '愛知', '三重', '京都',
  '大阪', '兵庫', '奈良', '和歌山', '岡山', '広島', '山口', '徳島', '香川', '愛媛',
  '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄',
];

/** 外国人の国名ラベル */
const COUNTRY_NAMES: Record<string, string> = {
  USA: 'アメリカ', CUB: 'キューバ', DOM: 'ドミニカ', VEN: 'ベネズエラ', JPN: '日本',
};

import {
  type BatterArchetype,
  type PitcherArchetype,
  getBatterArchetype,
  getPitcherArchetype,
} from './growthEngine';

// --- 野手アーキタイプごとの能力オフセット定義 ---
interface BatterArchetypeProfile {
  contactDelta: number;
  powerDelta: number;
  speedDelta: number;
  defenseDelta: number;
}

const BATTER_ARCHETYPE_PROFILES: Record<BatterArchetype, BatterArchetypeProfile> = {
  SLUGGER: { powerDelta: 18, contactDelta: -10, speedDelta: -12, defenseDelta: -4 },
  CONTACT: { contactDelta: 18, powerDelta: -14, speedDelta: 4, defenseDelta: -1 },
  SPEED_DEFENSE: { speedDelta: 20, defenseDelta: 10, powerDelta: -18, contactDelta: 0 },
  DEFENSIVE: { defenseDelta: 20, speedDelta: 2, contactDelta: -8, powerDelta: -16 },
  BALANCED: { contactDelta: 0, powerDelta: 0, speedDelta: 0, defenseDelta: 0 },
};

/**
 * 才能値(1-99)を生成する。
 * 下限min（既定45）からmax（既定98）の範囲で、
 * べき乗分布（指数2.0）により高い値ほど出現率が急激に低下する（高才能は希少）。
 * 目安: 45〜59が約50%, 60〜74が約25%, 75〜84が約15%, 85〜94が約7%, 95以上が約3%
 */
export function generateTalent(min = 45, max = 98): number {
  const r = Math.pow(Math.random(), 2.0);
  return Math.min(max, Math.round(min + r * (max - min)));
}

// --- 投手アーキタイプごとの能力オフセット定義（球威・制球・変化・スタミナ） ---
interface PitcherArchetypeProfile {
  stuffDelta: number;
  controlDelta: number;
  breakingDelta: number;
  staminaDelta: number;
}

const PITCHER_ARCHETYPE_PROFILES: Record<PitcherArchetype, PitcherArchetypeProfile> = {
  FLAMETHROWER: {
    stuffDelta: 18,
    controlDelta: -14,
    breakingDelta: 2,
    staminaDelta: -6,
  },
  CONTROL_CRAFT: {
    stuffDelta: -16,
    controlDelta: 16,
    breakingDelta: 6,
    staminaDelta: -6,
  },
  BREAKING_SPECIALIST: {
    stuffDelta: -12,
    controlDelta: 2,
    breakingDelta: 16,
    staminaDelta: -6,
  },
  WORKHORSE: {
    stuffDelta: -18,
    controlDelta: 4,
    breakingDelta: -4,
    staminaDelta: 18,
  },
  BALANCED: {
    stuffDelta: 0,
    controlDelta: 0,
    breakingDelta: 0,
    staminaDelta: 0,
  },
};

/** 野手の能力値を生成する */
function generateBatterStats(mean: number, arch: BatterArchetype) {
  const p = BATTER_ARCHETYPE_PROFILES[arch] ?? BATTER_ARCHETYPE_PROFILES.BALANCED;
  const stuff = gaussian(15, 4, 1, 35);
  return {
    contact: gaussian(mean + p.contactDelta, 5, 20, 105),
    power: gaussian(mean + p.powerDelta, 5, 15, 105),
    speed: gaussian(mean + p.speedDelta, 5, 20, 105),
    defense: gaussian(mean + p.defenseDelta, 5, 20, 105),
    stuff,
    velocity: calcVelocity(stuff),
    breaking: gaussian(20, 4, 10, 35),
    control: gaussian(20, 4, 10, 35),
    stamina: gaussian(28, 5, 10, 45),
  };
}

/** 投手の能力値を生成する（主要4能力: 球威・制球・変化・スタミナの平均がmean） */
function generatePitcherStats(mean: number, arch: PitcherArchetype) {
  const p = PITCHER_ARCHETYPE_PROFILES[arch] ?? PITCHER_ARCHETYPE_PROFILES.BALANCED;
  const stuff = gaussian(mean + p.stuffDelta, 5, 1, 105);
  const velocity = calcVelocity(stuff);

  return {
    stuff,
    velocity,
    control: gaussian(mean + p.controlDelta, 5, 1, 105),
    breaking: gaussian(mean + p.breakingDelta, 5, 1, 105),
    stamina: gaussian(mean + p.staminaDelta, 5, 1, 105),
    contact: gaussian(32, 6, 10, 55),
    power: gaussian(28, 6, 10, 50),
    speed: gaussian(42, 6, 20, 65),
    defense: gaussian(45, 6, 20, 70),
  };
}

export interface GeneratePlayerOptions {
  type: PlayerType;
  position?: Position;
  isForeign?: boolean;
  /** 能力の基準値（平均）。主力ほど高く、控えほど低く。 */
  baseMean?: number;
  /** プロ登録年度（未指定なら年齢から推定）。ドラフト新人・外国人加入で指定。 */
  debutYear?: number;
  /** 年齢（未指定なら18〜38のランダム）。ドラフト新人で指定。 */
  age?: number;
  /** 才能値（未指定なら45〜98のべき乗分布で自動生成）。 */
  talent?: number;
  /** 成長タイプ（未指定なら4種からランダム）。 */
  growthType?: GrowthType;
  /** 適応値（外国人の成長を決める1-99）。未指定なら外国人はランダム、日本人は0。 */
  adaptability?: number;
}

/** 1人の選手を生成する */
export function generatePlayer(opts: GeneratePlayerOptions): Player {
  const type = opts.type;
  const isForeign = opts.isForeign ?? false;
  const nameInfo = isForeign ? generateForeignName() : generateJapaneseName();

  const position: Position =
    type === 'PITCHER' ? 'P' : opts.position ?? pick(BATTER_POSITIONS);

  const mean = opts.baseMean ?? 62;
  const id = generateUniquePlayerId();

  // アーキタイプに基づく能力の生成
  const stats = type === 'BATTER'
    ? generateBatterStats(mean, getBatterArchetype(id, position))
    : generatePitcherStats(mean, getPitcherArchetype(id));

  const age = opts.age ?? randInt(18, 38);

  // 才能値: 下限45、高い値ほど出にくい分布
  const talent = opts.talent ?? generateTalent(45, 98);
  // 努力値: 正規分布（平均53, sd 13）
  const effort = gaussian(53, 13, 20, 98);

  return {
    id,
    name: nameInfo.fullName,
    position,
    type,
    age,
    growth_type: opts.growthType ?? pick(GROWTH_TYPES),

    ...stats,

    // メンタル・体質 (1-99)
    talent,
    effort,
    health: randInt(20, 99),
    luck: randInt(20, 99),

    adaptability: opts.adaptability ?? (isForeign ? randInt(1, 99) : 0),

    is_foreign: isForeign,
    country: nameInfo.country,
    debutYear: opts.debutYear ?? SEASON_START_YEAR - (Math.max(1, age - 17) - 1),
    hometown: isForeign ? (COUNTRY_NAMES[nameInfo.country] ?? nameInfo.country) : pick(PREFECTURES),
    throws: Math.random() < 0.55 ? 'R' : 'L',
    bats: (() => {
      const r = Math.random();
      // 投手は両打なし（右55% / 左45%）
      if (type === 'PITCHER') return r < 0.55 ? 'R' : 'L';
      // 野手は両打3%、残りを右55:左45で按分（右約53% / 左約44% / 両3%）
      if (r < 0.97) return r < 0.97 * 0.55 ? 'R' : 'L';
      return 'S';
    })(),
  };
}
