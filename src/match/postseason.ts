import type { GameResult } from './matchTypes';
import { simulateGame, type SideInput } from './simulate';

export type SeriesKind = 'CS_FIRST' | 'CS_FINAL' | 'JAPAN';
export type PostseasonStage = 'CS_FIRST' | 'CS_FINAL' | 'JAPAN' | 'DONE';

export interface SeriesGameScore {
  homeScore: number;
  awayScore: number;
  draw?: boolean;
}

/** 1シリーズの状態（homeが上位／ホーム球団） */
export interface SeriesState {
  kind: SeriesKind;
  homeId: string;
  awayId: string;
  homeWins: number;
  awayWins: number;
  target: number; // 到達勝利数（2 or 4）
  gamesPlayed: number; // 実施した試合数（引き分け含む）
  done: boolean;
  winnerId: string | null;
  /**
   * 日本シリーズのホーム配分パターン。
   * '1267' = 第1・2・6・7戦が上位(homeId)ホーム / 第3・4・5戦が下位(awayId)ホーム。
   * '345'  = 第3・4・5戦が上位(homeId)ホーム / 第1・2・6・7戦が下位(awayId)ホーム。
   * CSは全試合上位ホームなので使わない（undefined）。
   */
  japanHomePattern?: '1267' | '345';
  /** アドバンテージ1勝の有無（CSファイナル） */
  advantage?: boolean;
  /** 各試合のスコア（上位球団視点: homeScore=series.homeId, awayScore=series.awayId） */
  gameScores?: SeriesGameScore[];
}

/** ポストシーズン全体の状態 */
export interface PostseasonState {
  stage: PostseasonStage;
  centralLeaderId: string; // セ1位（CSファイナルのホーム）
  pacificLeaderId: string; // パ1位
  /** 各リーグの2位・3位の「1位からのゲーム差」（CSファイナルのアドバンテージ判定用） */
  centralGamesBehind: { second: number; third: number };
  pacificGamesBehind: { second: number; third: number };
  central: { first: SeriesState; final: SeriesState | null };
  pacific: { first: SeriesState; final: SeriesState | null };
  japan: SeriesState | null;
  championId: string | null; // 日本一
}

/**
 * シリーズを作る（目標勝利を設定）。
 * CS_FINAL で advantage=true のとき、1位(homeId)に1勝のアドバンテージを付与。
 */
export function makeSeries(kind: SeriesKind, homeId: string, awayId: string, advantage = false): SeriesState {
  if (kind === 'CS_FIRST') {
    return { kind, homeId, awayId, homeWins: 0, awayWins: 0, target: 2, gamesPlayed: 0, done: false, winnerId: null, gameScores: [] };
  }
  if (kind === 'CS_FINAL') {
    // ゲーム差5以上のときのみ1位に1勝のアドバンテージ
    return { kind, homeId, awayId, homeWins: advantage ? 1 : 0, awayWins: 0, target: 4, gamesPlayed: 0, done: false, winnerId: null, advantage, gameScores: [] };
  }
  // 日本シリーズ: ホーム配分パターンをランダムに決定
  const pattern: '1267' | '345' = Math.random() < 0.5 ? '1267' : '345';
  return { kind, homeId, awayId, homeWins: 0, awayWins: 0, target: 4, gamesPlayed: 0, done: false, winnerId: null, japanHomePattern: pattern, gameScores: [] };
}

/**
 * レギュラー順位からポストシーズンを初期化。
 * centralTop3 / pacificTop3: 各リーグの1〜3位 teamId。
 * centralGb / pacificGb: 各リーグ2位・3位の1位からのゲーム差（CSファイナルのアドバンテージ判定用）。
 */
export function initPostseason(
  centralTop3: string[],
  pacificTop3: string[],
  centralGb: { second: number; third: number } = { second: 0, third: 0 },
  pacificGb: { second: number; third: number } = { second: 0, third: 0 },
): PostseasonState {
  return {
    stage: 'CS_FIRST',
    centralLeaderId: centralTop3[0],
    pacificLeaderId: pacificTop3[0],
    centralGamesBehind: centralGb,
    pacificGamesBehind: pacificGb,
    // ファースト: 2位ホーム vs 3位
    central: { first: makeSeries('CS_FIRST', centralTop3[1], centralTop3[2]), final: null },
    pacific: { first: makeSeries('CS_FIRST', pacificTop3[1], pacificTop3[2]), final: null },
    japan: null,
    championId: null,
  };
}

/**
 * シリーズを1試合進める。引き分けはノーカウント（再試合扱い）。
 * side(teamId) で SideInput を返す関数を渡す。GameResult を返す。
 */
export function playSeriesGame(
  series: SeriesState,
  side: (teamId: string) => SideInput,
  rng: () => number = Math.random,
): GameResult {
  // 日本シリーズのホームは配分パターンで決まる。CSは全試合上位(homeId)ホーム。
  const idx = series.gamesPlayed; // 0始まりの試合番号（第idx+1戦）
  let awayHome = false;
  if (series.kind === 'JAPAN') {
    // 第3・4・5戦（index 2,3,4）
    const isMiddle = idx >= 2 && idx <= 4;
    // '1267': 中3戦が下位ホーム / '345': 中3戦が上位ホーム（＝それ以外が下位ホーム）
    awayHome = series.japanHomePattern === '345' ? !isMiddle : isMiddle;
  }
  const gameHomeId = awayHome ? series.awayId : series.homeId; // その試合のホーム
  const gameAwayId = awayHome ? series.homeId : series.awayId;

  const res = simulateGame(side(gameAwayId), side(gameHomeId), rng);
  series.gamesPlayed++;

  // 上位(homeId)球団視点のスコアを記録
  const homeScore = gameHomeId === series.homeId ? res.homeScore : res.awayScore;
  const awayScore = gameHomeId === series.homeId ? res.awayScore : res.homeScore;
  series.gameScores ??= [];
  series.gameScores.push({ homeScore, awayScore, draw: res.draw });

  if (!res.draw) {
    if (res.winnerId === series.homeId) series.homeWins++;
    else series.awayWins++;
    if (series.homeWins >= series.target) {
      series.done = true;
      series.winnerId = series.homeId;
    } else if (series.awayWins >= series.target) {
      series.done = true;
      series.winnerId = series.awayId;
    }
  }
  return res;
}

/** シリーズを決着まで一気に消化（結果だけ）。rng使用。 */
export function finishSeries(series: SeriesState, side: (teamId: string) => SideInput, rng: () => number = Math.random) {
  let guard = 0;
  while (!series.done && guard < 50) {
    playSeriesGame(series, side, rng);
    guard++;
  }
}


