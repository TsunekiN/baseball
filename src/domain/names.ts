import type { Country } from './types';
import { JP_LAST_NAMES, JP_FIRST_NAMES } from './namesData';

// ============================================================
// 日本人選手の名前生成
// 姓256個 × 名256個（約6.5万通り）。名には珍名・キラキラネームも含む。
// データ本体は namesData.ts に分離。
// ============================================================

/** 日本人選手のフルネームを生成 */
export function generateJapaneseName(): { fullName: string; country: Country } {
  const last = JP_LAST_NAMES[Math.floor(Math.random() * JP_LAST_NAMES.length)];
  const first = JP_FIRST_NAMES[Math.floor(Math.random() * JP_FIRST_NAMES.length)];
  return { fullName: `${last} ${first}`, country: 'JPN' };
}

// ============================================================
// 外国人選手の名前生成（仕様書 6章のデータをそのまま採用）
// ============================================================

export const FOREIGN_NAME_DB = {
  USA: {
    lastNames: [
      'スミス', 'ジョンソン', 'ブラウン', 'ジョーンズ', 'ミラー', 'デイビス',
      'バーガー', 'バンガーナー', 'マック', 'パンチ', 'キング', 'ハンター',
      'キャノン', 'ボルト', 'ウッド', 'キャッシュ',
    ],
    firstNames: [
      'ジョー', 'マイク', 'ビル', 'ボブ', 'バディ', 'トム', 'デューク', 'ジャック',
    ],
  },
  CUB: {
    lastNames: [
      'リナレス', 'グリエル', 'バルデス', 'モレノ', 'デスパイネ', 'マルティネス',
      'チョコ', 'マンボ', 'エスプレッソ', 'カストロ', 'シルバ', 'ロドリゲス',
      'ゴメス', 'ペレス', 'ディアス', 'クルーズ',
    ],
    firstNames: [
      'オスカー', 'ヨアン', 'ペドロ', 'エルビス', 'ダリオ', 'アレロ', 'ヤセル', 'ラウル',
    ],
  },
  DOM: {
    lastNames: [
      'サンタナ', 'ロドリゲス', 'ペーニャ', 'フェリス', 'ロサリオ', 'バティスタ',
      'マンゴー', 'コロン', 'ゲレーロ', 'ポランコ', 'フランコ', 'ソト',
      'メヒア', 'バルデス', 'レイエス', 'モラレス',
    ],
    firstNames: [
      'ホセ', 'ラモン', 'カルロス', 'ジュニア', 'ネルソン', 'ファン', 'マニー', 'フェリックス',
    ],
  },
  VEN: {
    lastNames: [
      'アブレユ', 'カブレラ', 'ヘルナンデス', 'ガルシア', 'アルトゥーベ', 'スアレス',
      'アレパ', 'ボリバル', 'コロナ', 'サンチェス', 'ロペス', 'トーレス',
      'メンドーサ', 'ロメロ', 'ベラスケス', 'カステロ',
    ],
    firstNames: [
      'ルイス', 'ウィルソン', 'エンリケ', 'ロベルト', 'オスカー', 'フェルナンド', 'ミゲル', 'ヨハン',
    ],
  },
} as const;

/** 外国人選手のフルネームを生成（仕様書 6章の関数準拠） */
export function generateForeignName(): { fullName: string; country: Country } {
  const countries = ['USA', 'CUB', 'DOM', 'VEN'] as const;
  const country = countries[Math.floor(Math.random() * countries.length)];
  const db = FOREIGN_NAME_DB[country];

  const firstName = db.firstNames[Math.floor(Math.random() * db.firstNames.length)];
  const lastName = db.lastNames[Math.floor(Math.random() * db.lastNames.length)];

  return {
    fullName: `${firstName}・${lastName}`, // 例: "ボブ・バーガー"
    country,
  };
}
