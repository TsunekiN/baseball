import type { GrowthType, Player, PlayerType, Position } from './types';
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

import { getBatterArchetype, getPitcherArchetype } from './growthEngine';

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

  // --- 野手能力の生成（アーキタイプによる大きなばらつき・個性の付与） ---
  let contact = 32;
  let power = 28;
  let speed = 42;
  let defense = 45;

  // --- 投手能力の生成（アーキタイプによる大きなばらつき・個性の付与） ---
  let velocity = 120;
  let breaking = 20;
  let control = 20;
  let stamina = 28;

  if (type === 'BATTER') {
    const arch = getBatterArchetype(id, position);
    switch (arch) {
      case 'SLUGGER':
        power = gaussian(mean + 18, 5, 30, 105);
        contact = gaussian(mean - 10, 5, 20, 95);
        speed = gaussian(mean - 12, 5, 20, 90);
        defense = gaussian(mean - 4, 5, 20, 95);
        break;
      case 'CONTACT':
        contact = gaussian(mean + 18, 5, 30, 105);
        power = gaussian(mean - 14, 5, 20, 90);
        speed = gaussian(mean + 4, 5, 25, 98);
        defense = gaussian(mean - 1, 5, 20, 95);
        break;
      case 'SPEED_DEFENSE':
        speed = gaussian(mean + 20, 5, 35, 105);
        defense = gaussian(mean + 10, 5, 25, 100);
        power = gaussian(mean - 18, 5, 15, 85);
        contact = gaussian(mean + 0, 5, 20, 95);
        break;
      case 'DEFENSIVE':
        defense = gaussian(mean + 20, 5, 35, 105);
        speed = gaussian(mean + 2, 5, 25, 95);
        contact = gaussian(mean - 8, 5, 20, 90);
        power = gaussian(mean - 16, 5, 15, 85);
        break;
      case 'BALANCED':
      default:
        contact = gaussian(mean, 5, 20, 100);
        power = gaussian(mean, 5, 20, 100);
        speed = gaussian(mean, 5, 20, 100);
        defense = gaussian(mean, 5, 20, 100);
        break;
    }
    velocity = gaussian(120, 4, 110, 135);
    breaking = gaussian(20, 4, 10, 35);
    control = gaussian(20, 4, 10, 35);
    stamina = gaussian(28, 5, 10, 45);
  } else {
    // 投手能力
    const arch = getPitcherArchetype(id);
    switch (arch) {
      case 'FLAMETHROWER':
        velocity = Math.max(128, Math.min(163, Math.round(144 + (mean - 55) * 0.4 + randInt(5, 9))));
        control = gaussian(mean - 14, 5, 20, 85);
        breaking = gaussian(mean + 2, 5, 25, 98);
        stamina = gaussian(mean + 0, 5, 20, 95);
        break;
      case 'CONTROL_CRAFT':
        velocity = Math.max(125, Math.min(148, Math.round(138 + (mean - 55) * 0.3 - randInt(2, 6))));
        control = gaussian(mean + 18, 5, 35, 105);
        breaking = gaussian(mean + 8, 5, 25, 100);
        stamina = gaussian(mean + 0, 5, 20, 95);
        break;
      case 'BREAKING_SPECIALIST':
        velocity = Math.max(126, Math.min(154, Math.round(141 + (mean - 55) * 0.35 + randInt(-2, 3))));
        breaking = gaussian(mean + 18, 5, 35, 105);
        control = gaussian(mean + 0, 5, 20, 95);
        stamina = gaussian(mean - 2, 5, 20, 90);
        break;
      case 'WORKHORSE':
        velocity = Math.max(126, Math.min(154, Math.round(142 + (mean - 55) * 0.35 + randInt(-2, 3))));
        stamina = gaussian(mean + 20, 5, 35, 105);
        control = gaussian(mean + 6, 5, 25, 98);
        breaking = gaussian(mean - 2, 5, 20, 90);
        break;
      case 'BALANCED':
      default:
        velocity = Math.max(126, Math.min(154, Math.round(143 + (mean - 55) * 0.35 + randInt(-2, 3))));
        breaking = gaussian(mean, 5, 20, 100);
        control = gaussian(mean, 5, 20, 100);
        stamina = gaussian(mean, 5, 20, 100);
        break;
    }
    contact = gaussian(32, 6, 10, 55);
    power = gaussian(28, 6, 10, 50);
    speed = gaussian(42, 6, 20, 65);
    defense = gaussian(45, 6, 20, 70);
  }

  const age = opts.age ?? randInt(18, 38);

  // 才能値: 正規分布（中心は平均能力-5程度、標準偏差11）。
  // 平均的な選手は45〜62程度に収まり、80以上のスター選手は上位数％の希少存在。
  const talent = gaussian(Math.max(38, Math.min(68, mean - 5)), 11, 20, 98);
  // 努力値: 正規分布（平均53, sd 13）
  const effort = gaussian(53, 13, 20, 98);

  return {
    id,
    name: nameInfo.fullName,
    position,
    type,
    age,
    growth_type: opts.growthType ?? pick(GROWTH_TYPES),

    contact,
    power,
    speed,
    defense,

    velocity,
    breaking,
    control,
    stamina,

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
