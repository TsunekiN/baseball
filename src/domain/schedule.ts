import type { Team } from './types';

// ============================================================
// 日程（シーズン週構成）
// 2027年開幕。全試合DH制。週単位で進行する。
//
// レギュラーシーズン: 4月1週〜9月4週（24週 / 各チーム143試合）
//   - 通常週: 6試合（3連戦×2カード）
//   - 交流戦: 6月1〜3週（各週6試合、他リーグ球団と対戦）
//   - 変則週: 9月4週（5試合。同一リーグ5球団と1試合ずつ）
//   合計: 23週×6 + 5 = 143試合
//
// ポストシーズン: 10月1〜3週
//   - 10月1週: CSファーストステージ（2位 vs 3位 / 2位ホーム / 3試合・2勝先勝）
//   - 10月2週: CSファイナルステージ（1位 vs FS勝者 / 1位ホーム / 6試合・4勝先勝 / 1位に1勝アドバンテージ）
//   - 10月3週: 日本シリーズ（セ王者 vs パ王者 / 7試合・4勝先勝 / 全試合DH）
// ============================================================

export const SEASON_START_YEAR = 2027;
export const GAMES_PER_TEAM = 143;

/** 週の種別 */
export type WeekKind =
  | 'REGULAR' // 通常週（同一リーグ・6試合）
  | 'INTERLEAGUE' // 交流戦（他リーグ・6試合）
  | 'REGULAR_ODD' // 変則週（同一リーグ5球団と1試合ずつ・5試合）
  | 'CS_FIRST' // CSファーストステージ
  | 'CS_FINAL' // CSファイナルステージ
  | 'JAPAN_SERIES'; // 日本シリーズ

/** 各週の定義（0始まりのweekIndex順） */
export interface WeekDef {
  kind: WeekKind;
  /** レギュラーシーズンの試合数（ポストシーズンは0＝通算試合数に含めない） */
  games: number;
}

/** 月ごとに4週ずつ。4月(0)〜10月(6)。 */
const MONTHS = [4, 5, 6, 7, 8, 9, 10];
const WEEKS_PER_MONTH = 4;

/** レギュラーシーズンの週数（4月1週〜9月4週 = 6か月×4週） */
export const REGULAR_WEEKS = 24;
/** 全体の週数（レギュラー + ポストシーズン3週） */
export const TOTAL_WEEKS = REGULAR_WEEKS + 3;

/** weekIndex から週定義を返す */
export function weekDef(weekIndex: number): WeekDef {
  // ポストシーズン
  if (weekIndex === 24) return { kind: 'CS_FIRST', games: 0 };
  if (weekIndex === 25) return { kind: 'CS_FINAL', games: 0 };
  if (weekIndex === 26) return { kind: 'JAPAN_SERIES', games: 0 };

  // 交流戦: 6月1〜3週（6月=月インデックス2 → weekIndex 8,9,10）
  if (weekIndex >= 8 && weekIndex <= 10) return { kind: 'INTERLEAGUE', games: 6 };

  // 変則週: 9月4週（9月=月インデックス5 → weekIndex 23）
  if (weekIndex === 23) return { kind: 'REGULAR_ODD', games: 5 };

  // それ以外の通常週
  return { kind: 'REGULAR', games: 6 };
}

/** weekIndex が レギュラーシーズンか */
export function isRegularSeason(weekIndex: number): boolean {
  return weekIndex < REGULAR_WEEKS;
}

/**
 * weekIndex から「2027年 4月1週」のような和文ラベルを作る。
 * 各月4週として順に割り当てる。
 */
export function weekLabel(weekIndex: number, year: number = SEASON_START_YEAR): string {
  const monthPos = Math.floor(weekIndex / WEEKS_PER_MONTH);
  const weekInMonth = (weekIndex % WEEKS_PER_MONTH) + 1;
  const month = MONTHS[Math.min(monthPos, MONTHS.length - 1)];
  return `${year}年 ${month}月${weekInMonth}週`;
}

/** ポストシーズンの週ラベル（例: 10月1週 CSファースト） */
export function weekKindLabel(kind: WeekKind): string {
  switch (kind) {
    case 'REGULAR':
    case 'REGULAR_ODD':
      return 'ペナント';
    case 'INTERLEAGUE':
      return '交流戦';
    case 'CS_FIRST':
      return 'CSファースト';
    case 'CS_FINAL':
      return 'CSファイナル';
    case 'JAPAN_SERIES':
      return '日本シリーズ';
  }
}

/**
 * 指定週のマイチームの対戦相手リストを返す（表示用）。
 * - 通常週: 同一リーグの2球団と3連戦ずつ（6試合）
 * - 交流戦: 他リーグの2球団と3連戦ずつ（6試合）
 * - 変則週: 同一リーグ5球団と1試合ずつ（5試合）
 * - ポストシーズン: 相手未確定のため空配列
 */
export function weekOpponents(teams: Team[], myTeam: Team, weekIndex: number): Team[] {
  const def = weekDef(weekIndex);

  if (def.kind === 'CS_FIRST' || def.kind === 'CS_FINAL' || def.kind === 'JAPAN_SERIES') {
    return [];
  }

  if (def.kind === 'REGULAR_ODD') {
    // 同一リーグの他5球団と1試合ずつ
    return teams.filter((t) => t.league === myTeam.league && t.id !== myTeam.id);
  }

  if (def.kind === 'INTERLEAGUE') {
    // 他リーグの球団と3連戦×2
    const others = teams.filter((t) => t.league !== myTeam.league);
    return threeGameCards(others, weekIndex);
  }

  // 通常週: 同一リーグの他球団と3連戦×2
  const rivals = teams.filter((t) => t.league === myTeam.league && t.id !== myTeam.id);
  return threeGameCards(rivals, weekIndex);
}

/** 相手プールから、週ごとにずらした2球団を3連戦ずつ並べる（6試合分） */
function threeGameCards(pool: Team[], weekIndex: number): Team[] {
  if (pool.length === 0) return [];
  const a = pool[(weekIndex * 2) % pool.length];
  const b = pool[(weekIndex * 2 + 1) % pool.length];
  return [a, a, a, b, b, b];
}

/**
 * その週の開始時点での通算試合番号（1始まり）を返す。
 * レギュラーシーズンの累計。ポストシーズン週は143を返す。
 */
export function nextGameNumber(weekIndex: number): number {
  let total = 0;
  for (let w = 0; w < weekIndex && w < REGULAR_WEEKS; w++) {
    total += weekDef(w).games;
  }
  return Math.min(total + 1, GAMES_PER_TEAM);
}

/** 開発用: 週定義を全て集計してレギュラーシーズン試合数を検算する */
export function totalRegularGames(): number {
  let total = 0;
  for (let w = 0; w < REGULAR_WEEKS; w++) total += weekDef(w).games;
  return total;
}
