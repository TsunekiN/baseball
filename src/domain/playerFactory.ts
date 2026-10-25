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
  TALENT_MIN,
  TALENT_MAX,
  EFFORT_MAX,
  ADAPTABILITY_MIN,
  ADAPTABILITY_MAX,
} from './growthEngine';

// --- 野手アーキタイプごとの基本能力オフセット定義 ---
interface BatterArchetypeProfile {
  contactDelta: number;
  powerDelta: number;
  speedDelta: number;
  defenseDelta: number;
}

const BATTER_ARCHETYPE_PROFILES: Record<BatterArchetype, BatterArchetypeProfile> = {
  SLUGGER: { powerDelta: 16, contactDelta: -8, speedDelta: -10, defenseDelta: -3 },
  CONTACT: { contactDelta: 16, powerDelta: -12, speedDelta: 4, defenseDelta: -1 },
  SPEED_DEFENSE: { speedDelta: 18, defenseDelta: 8, powerDelta: -14, contactDelta: 0 },
  DEFENSIVE: { defenseDelta: 18, speedDelta: 2, contactDelta: -6, powerDelta: -12 },
  BALANCED: { contactDelta: 0, powerDelta: 0, speedDelta: 0, defenseDelta: 0 },
};

/**
 * 才能値(1-95)を生成する。
 * 下限min（既定45）からmax（既定95）の範囲で、
 * べき乗分布（指数2.0）により高い値ほど出現率が急激に低下する（高才能は希少）。
 * 目安: 45〜59が約50%, 60〜74が約25%, 75〜84が約15%, 85〜94が約7%, 95は希少存在
 */
export function generateTalent(min = TALENT_MIN, max = TALENT_MAX): number {
  const r = Math.pow(Math.random(), 2.0);
  return Math.min(max, Math.round(min + r * (max - min)));
}

// --- 投手アーキタイプごとの基本能力オフセット定義（球威・制球・変化・スタミナ） ---
interface PitcherArchetypeProfile {
  stuffDelta: number;
  controlDelta: number;
  breakingDelta: number;
  staminaDelta: number;
}

const PITCHER_ARCHETYPE_PROFILES: Record<PitcherArchetype, PitcherArchetypeProfile> = {
  FLAMETHROWER: {
    stuffDelta: 16,
    controlDelta: -10,
    breakingDelta: 2,
    staminaDelta: -4,
  },
  CONTROL_CRAFT: {
    stuffDelta: -12,
    controlDelta: 16,
    breakingDelta: 6,
    staminaDelta: -4,
  },
  BREAKING_SPECIALIST: {
    stuffDelta: -8,
    controlDelta: 2,
    breakingDelta: 16,
    staminaDelta: -4,
  },
  WORKHORSE: {
    stuffDelta: -12,
    controlDelta: 4,
    breakingDelta: -2,
    staminaDelta: 18,
  },
  BALANCED: {
    stuffDelta: 0,
    controlDelta: 0,
    breakingDelta: 0,
    staminaDelta: 0,
  },
};

/** 野手の能力値を生成する（型通りになり過ぎず多様な特徴を生み出す） */
function generateBatterStats(mean: number, arch: BatterArchetype) {
  const p = BATTER_ARCHETYPE_PROFILES[arch] ?? BATTER_ARCHETYPE_PROFILES.BALANCED;

  // 1. 各能力に選手独自のランダムな揺らぎ（-8〜+8）を付与
  let contactDelta = p.contactDelta + randInt(-8, 8);
  let powerDelta = p.powerDelta + randInt(-8, 8);
  let speedDelta = p.speedDelta + randInt(-8, 8);
  let defenseDelta = p.defenseDelta + randInt(-8, 8);

  // 2. 約20%の確率で「型破りな特徴・ユニークな個性」を発現
  if (Math.random() < 0.22) {
    const trait = randInt(0, 5);
    if (trait === 0) {
      // 俊足強打のトリプルスリー候補（パワーと走力の両立）
      powerDelta = Math.max(powerDelta, 12 + randInt(-3, 8));
      speedDelta = Math.max(speedDelta, 12 + randInt(-3, 8));
      contactDelta = Math.max(contactDelta, randInt(-2, 6));
    } else if (trait === 1) {
      // 天才打者（ミートとパワーが両立した強打者）
      contactDelta = Math.max(contactDelta, 14 + randInt(-2, 8));
      powerDelta = Math.max(powerDelta, 10 + randInt(-3, 8));
    } else if (trait === 2) {
      // 強肩強打の守備職人（パワーと守備力の両立）
      powerDelta = Math.max(powerDelta, 10 + randInt(-3, 8));
      defenseDelta = Math.max(defenseDelta, 14 + randInt(-2, 8));
    } else if (trait === 3) {
      // 韋駄天スピードスター（走力超特化＋ミート）
      speedDelta = Math.max(speedDelta, 20 + randInt(0, 10));
      contactDelta = Math.max(contactDelta, 4 + randInt(-2, 8));
    } else if (trait === 4) {
      // 鉄壁の守備職人（守備超特化＋走力）
      defenseDelta = Math.max(defenseDelta, 20 + randInt(0, 10));
      speedDelta = Math.max(speedDelta, 4 + randInt(-2, 8));
    } else {
      // 一撃必殺のロマン砲（パワー極振り）
      powerDelta = Math.max(powerDelta, 22 + randInt(0, 8));
      contactDelta = Math.min(contactDelta, -12 + randInt(-6, 2));
    }
  }

  const stuff = gaussian(15, 6, 1, 45);
  return {
    contact: gaussian(mean + contactDelta, 7.5, 15, 105),
    power: gaussian(mean + powerDelta, 7.5, 15, 105),
    speed: gaussian(mean + speedDelta, 7.5, 15, 105),
    defense: gaussian(mean + defenseDelta, 7.5, 15, 105),
    stuff,
    velocity: calcVelocity(stuff),
    breaking: gaussian(20, 5, 10, 40),
    control: gaussian(20, 5, 10, 40),
    stamina: gaussian(28, 6, 10, 50),
  };
}

/** 投手の能力値を生成する（型通りになり過ぎず多様な特徴を生み出す） */
function generatePitcherStats(mean: number, arch: PitcherArchetype) {
  const p = PITCHER_ARCHETYPE_PROFILES[arch] ?? PITCHER_ARCHETYPE_PROFILES.BALANCED;

  // 1. 各能力に選手独自のランダムな揺らぎ（-8〜+8）を付与
  let stuffDelta = p.stuffDelta + randInt(-8, 8);
  let controlDelta = p.controlDelta + randInt(-8, 8);
  let breakingDelta = p.breakingDelta + randInt(-8, 8);
  let staminaDelta = p.staminaDelta + randInt(-8, 8);

  // 2. 約22%の確率で「型破りな特徴・ユニークな個性」を発現
  if (Math.random() < 0.22) {
    const trait = randInt(0, 5);
    if (trait === 0) {
      // 本格派パワーエース（球威・制球・スタミナの3拍子が高水準）
      stuffDelta = Math.max(stuffDelta, 12 + randInt(-3, 8));
      controlDelta = Math.max(controlDelta, 6 + randInt(-2, 8));
      staminaDelta = Math.max(staminaDelta, 8 + randInt(-2, 8));
    } else if (trait === 1) {
      // ドクターK（球速と切れ味鋭い魔球で三振を量産）
      stuffDelta = Math.max(stuffDelta, 14 + randInt(-3, 8));
      breakingDelta = Math.max(breakingDelta, 14 + randInt(-3, 8));
    } else if (trait === 2) {
      // 実戦派技巧派（針の穴を通す制球＋変化球、球速も水準を維持）
      controlDelta = Math.max(controlDelta, 16 + randInt(-2, 8));
      breakingDelta = Math.max(breakingDelta, 10 + randInt(-2, 8));
      stuffDelta = randInt(-4, 6); // 球威を落としすぎない
    } else if (trait === 3) {
      // 鉄腕完投型（スタミナ超特化＋制球安定）
      staminaDelta = Math.max(staminaDelta, 18 + randInt(0, 10));
      controlDelta = Math.max(controlDelta, 6 + randInt(-2, 8));
    } else if (trait === 4) {
      // 剛腕リリーバー / 荒れ球の球速特化（超速球＋制球難）
      stuffDelta = Math.max(stuffDelta, 20 + randInt(0, 8));
      controlDelta = Math.min(controlDelta, -14 + randInt(-6, 2));
    } else {
      // 軟投派クラフトマン（球速控えめ、変化球とスタミナで打たせて取る）
      breakingDelta = Math.max(breakingDelta, 14 + randInt(-2, 8));
      staminaDelta = Math.max(staminaDelta, 12 + randInt(-2, 8));
      stuffDelta = Math.min(stuffDelta, -14 + randInt(-4, 2));
    }
  }

  const stuff = gaussian(mean + stuffDelta, 7.5, 1, 105);
  const velocity = calcVelocity(stuff);

  return {
    stuff,
    velocity,
    control: gaussian(mean + controlDelta, 7.5, 1, 105),
    breaking: gaussian(mean + breakingDelta, 7.5, 1, 105),
    stamina: gaussian(mean + staminaDelta, 7.5, 1, 105),
    contact: gaussian(32, 7, 10, 60),
    power: gaussian(28, 7, 10, 55),
    speed: gaussian(42, 7, 20, 70),
    defense: gaussian(45, 7, 20, 75),
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
  /** 才能値（未指定なら45〜95のべき乗分布で自動生成、上限95）。 */
  talent?: number;
  /** 成長タイプ（未指定なら4種からランダム）。 */
  growthType?: GrowthType;
  /** 適応値（外国人の成長を決める1-95）。未指定なら外国人はランダム、日本人は0。 */
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

  // 才能値: 下限45、上限95、高い値ほど出にくい分布
  const talent = opts.talent != null ? Math.min(TALENT_MAX, opts.talent) : generateTalent(TALENT_MIN, TALENT_MAX);
  // 努力値: 正規分布（平均53, sd 13、上限95）
  const effort = Math.min(EFFORT_MAX, gaussian(53, 13, 20, EFFORT_MAX));

  return {
    id,
    name: nameInfo.fullName,
    position,
    type,
    age,
    growth_type: opts.growthType ?? pick(GROWTH_TYPES),

    ...stats,

    // メンタル・体質 (才能・努力・適応は上限95)
    talent,
    effort,
    health: randInt(20, 99),
    luck: randInt(20, 99),

    adaptability: opts.adaptability != null ? Math.min(ADAPTABILITY_MAX, opts.adaptability) : (isForeign ? randInt(ADAPTABILITY_MIN, ADAPTABILITY_MAX) : 0),

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
