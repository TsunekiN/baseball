import type { GameState, RecentGame } from '../domain/gameState';
import { buildBestOrder } from '../domain/orderFactory';
import type { SideInput } from './simulate';
import type { GameResult } from './matchTypes';
import {
  accumulateBatting,
  accumulatePitching,
  emptyBatting,
  emptyPitching,
  type PlayerSeasonStats,
} from './matchStats';
import {
  finishSeries,
  makeSeries,
  playSeriesGame,
  type PostseasonState,
  type SeriesState,
} from './postseason';
import { buildMatchReport } from './matchReport';

export interface PostAdvanceOutput {
  postseason: PostseasonState;
  myResults: GameResult[];
  /** 更新後のマイチーム直近試合結果（最大6件、消化順）。ポストシーズン分も反映 */
  recentGames: RecentGame[];
  /** 更新後のポストシーズン累計成績（マイチームのみ。年間/通算とは独立） */
  postseasonStats: Record<string, PlayerSeasonStats>;
  /** ポストシーズン用ローテーション状態（teamId -> 次に先発するローテ番号 0始まり） */
  postRotationIdx: Record<string, number>;
}

/**
 * ポストシーズンを進める。
 * - マイチームが出るシリーズは1試合ずつ（観戦）。同時に他シリーズは即消化。
 * - マイチームが出ないステージは全シリーズ即消化。
 * - シリーズ／ステージ完了で次ステージへ遷移。
 */
export function advancePostseason(game: GameState): PostAdvanceOutput {
  const ps: PostseasonState = structuredClone(game.postseason!);
  const myId = game.myTeamId;
  const teamMap = new Map(game.teams.map((t) => [t.id, t]));

  // ポストシーズン用ローテーション管理（試合ごとにインクリメントしてシリーズをまたいでも回す）
  const postRotationIdx: Record<string, number> = { ...(game.postRotationIdx ?? {}) };

  /**
   * チームの先発ローテから今回登板する投手IDを取得し、インデックスを進める。
   * rotationOrder 昇順に並べ、インデックスを round-robin で使う。
   */
  const pickPostStarter = (teamId: string): string | undefined => {
    const team = teamMap.get(teamId);
    if (!team) return undefined;
    const order = game.orders[teamId] ?? buildBestOrder(team);
    const starters = order.pitchers
      .filter((a) => a.role === 'STARTER')
      .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))
      .map((a) => a.playerId);
    if (starters.length === 0) return undefined;
    const idx = (postRotationIdx[teamId] ?? 0) % starters.length;
    postRotationIdx[teamId] = idx + 1;
    return starters[idx];
  };

  /** side + startPitcherId を組み立てる（ローテを消費する） */
  const sideWithStarter = (id: string): SideInput => {
    const team = teamMap.get(id)!;
    const order = game.orders[id] ?? buildBestOrder(team);
    const startPitcherId = pickPostStarter(id);
    return { team, order, startPitcherId };
  };
  const myResults: GameResult[] = [];
  let recentGames: RecentGame[] = [...(game.recentGames ?? [])];
  const postseasonStats: Record<string, PlayerSeasonStats> = structuredClone(game.postseasonStats ?? {});

  // マイチームの1試合をポストシーズン累計へ加算（年間/通算の playerStats とは独立）
  const accumulateMyGame = (res: GameResult): void => {
    const isHome = res.homeTeamId === myId;
    const batters = isHome ? res.homeBatters : res.awayBatters;
    const pitchers = isHome ? res.homePitchers : res.awayPitchers;
    for (const bl of batters) {
      const ps = (postseasonStats[bl.playerId] ??= {});
      ps.batting ??= emptyBatting();
      accumulateBatting(ps.batting, bl);
    }
    for (const pl of pitchers) {
      const ps = (postseasonStats[pl.playerId] ??= {});
      ps.pitching ??= emptyPitching();
      accumulatePitching(ps.pitching, pl);
    }
  };

  // 現ステージのアクティブ（未完了）シリーズ
  const active = activeSeries(ps).filter((s) => !s.done);
  const involvesMy = (s: SeriesState) => !!myId && (s.homeId === myId || s.awayId === myId);
  const mySeries = active.find((s) => involvesMy(s));

  if (mySeries) {
    // マイの1試合
    const res = playSeriesGame(mySeries, sideWithStarter);
    const myTeam = teamMap.get(myId!)!;
    const rep = buildMatchReport(res, myId!, game.playerStats, myTeam.players);
    res.achievements = rep.achievements;
    res.injuries = rep.injuries;
    myResults.push(res);
    // ポストシーズン成績を独立して集計（年間/通算には含めない）
    accumulateMyGame(res);
    // 直近試合結果を記録（マイチーム視点の勝敗）。ポストシーズンの観戦試合も反映。
    const myResult: RecentGame['myResult'] = res.draw ? 'draw' : res.winnerId === myId ? 'win' : 'lose';
    recentGames.push({
      myResult,
      homeMark: teamMap.get(res.homeTeamId)?.markChar ?? '?',
      awayMark: teamMap.get(res.awayTeamId)?.markChar ?? '?',
      homeScore: res.homeScore,
      awayScore: res.awayScore,
    });
    recentGames = recentGames.slice(-6);
    // 他のアクティブは即消化
    for (const s of active) if (s !== mySeries && !s.done) finishSeries(s, sideWithStarter);
  } else {
    // マイ不在: 全アクティブ即消化
    for (const s of active) finishSeries(s, sideWithStarter);
  }

  advanceStage(ps);
  return { postseason: ps, myResults, recentGames, postseasonStats, postRotationIdx };
}

/** 現ステージのシリーズ配列 */
function activeSeries(ps: PostseasonState): SeriesState[] {
  if (ps.stage === 'CS_FIRST') return [ps.central.first, ps.pacific.first];
  if (ps.stage === 'CS_FINAL') return [ps.central.final, ps.pacific.final].filter(Boolean) as SeriesState[];
  if (ps.stage === 'JAPAN') return ps.japan ? [ps.japan] : [];
  return [];
}

/** ステージ完了なら次ステージへ遷移 */
function advanceStage(ps: PostseasonState): void {
  if (ps.stage === 'CS_FIRST') {
    if (ps.central.first.done && ps.pacific.first.done) {
      // 1位は無条件に1勝のアドバンテージ
      const cWinner = ps.central.first.winnerId!;
      const pWinner = ps.pacific.first.winnerId!;
      ps.central.final = makeSeries('CS_FINAL', ps.centralLeaderId, cWinner, true);
      ps.pacific.final = makeSeries('CS_FINAL', ps.pacificLeaderId, pWinner, true);
      ps.stage = 'CS_FINAL';
    }
  } else if (ps.stage === 'CS_FINAL') {
    if (ps.central.final?.done && ps.pacific.final?.done) {
      // 先にCSファイナルを勝ち上がった方（実施試合数が少ない方）が第1・2・6・7戦ホーム
      const cGames = ps.central.final.gamesPlayed;
      const pGames = ps.pacific.final.gamesPlayed;
      const cWinner = ps.central.final.winnerId!;
      const pWinner = ps.pacific.final.winnerId!;
      let first: string;
      let second: string;
      if (cGames < pGames) {
        first = cWinner;
        second = pWinner;
      } else if (pGames < cGames) {
        first = pWinner;
        second = cWinner;
      } else {
        // 同数はランダム
        [first, second] = Math.random() < 0.5 ? [cWinner, pWinner] : [pWinner, cWinner];
      }
      ps.japan = makeSeries('JAPAN', first, second); // first=第1・2戦ホーム
      ps.stage = 'JAPAN';
    }
  } else if (ps.stage === 'JAPAN') {
    if (ps.japan?.done) {
      ps.championId = ps.japan.winnerId;
      ps.stage = 'DONE';
    }
  }
}
