import type { GrowthType, Player, PlayerType, Position } from './types';
import { generateForeignName, generateJapaneseName } from './names';
import { gaussian, pick, randInt } from './random';
import { SEASON_START_YEAR } from './schedule';

let seq = 0;
function nextId(): string {
  seq += 1;
  return `player_${String(seq).padStart(5, '0')}`;
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
  const sd = 10;

  // 野手能力
  const contact = type === 'BATTER' ? gaussian(mean, sd, 20, 105) : gaussian(35, 8, 10, 60);
  const power = type === 'BATTER' ? gaussian(mean, sd, 20, 105) : gaussian(30, 8, 10, 55);
  const speed = gaussian(type === 'BATTER' ? mean - 2 : 45, sd, 20, 105);
  const defense = type === 'BATTER' ? gaussian(mean - 3, sd, 20, 105) : gaussian(45, 8, 20, 70);

  // 投手能力
  // 球速: 平均147km/h前後。主力(mean高)ほど速い傾向。
  const velocity =
    type === 'PITCHER'
      ? gaussian(140 + Math.round((mean - 60) * 0.35), 4, 128, 165)
      : gaussian(120, 5, 110, 135);
  const breaking = type === 'PITCHER' ? gaussian(mean, sd, 20, 105) : gaussian(20, 5, 10, 40);
  const control = type === 'PITCHER' ? gaussian(mean, sd, 20, 105) : gaussian(20, 5, 10, 40);
  const stamina = type === 'PITCHER' ? gaussian(mean, sd, 20, 105) : gaussian(30, 8, 10, 55);

  const age = opts.age ?? randInt(18, 38);

  return {
    id: nextId(),
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
    talent: randInt(30, 99),
    effort: randInt(30, 99),
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
