import type { GameState, TeamRecord, InjuryEntry, RecentGame } from '../domain/gameState';
import { normalizeRoster } from '../domain/gameState';
import type { Team, TeamOrder } from '../domain/types';
import { buildBestOrder } from '../domain/orderFactory';
import { applyInjury, tickInjuries, returnToFarm } from '../domain/injuryManager';
import { simulateGame, type SideInput } from './simulate';
import type { GameResult } from './matchTypes';
import {
  accumulateBatting,
  accumulatePitching,
  emptyBatting,
  emptyPitching,
  type PlayerSeasonStats,
} from './matchStats';
import { buildMatchReport } from './matchReport';

export interface AdvanceOutput {
  records: Record<string, TeamRecord>;
  gameCursor: number;
  weekIndex: number;
  /** マイチームの試合結果（進めた範囲で、新しい順ではなく消化順） */
  myResults: GameResult[];
  /** 更新後の選手累計成績 */
  playerStats: Record<string, PlayerSeasonStats>;
  finished: boolean; // シーズン終了
  /** 更新後の全チーム（マイチームの負傷IL・補充を反映） */
  teams: Team[];
  /** 更新後の全オーダー（マイチームの補充を反映） */
  orders: Record<string, TeamOrder>;
  /** 更新後のマイチーム故障者リスト */
  injuries: Record<string, InjuryEntry>;
  /** 更新後のマイチーム直近試合結果（最大6件、消化順） */
  recentGames: RecentGame[];
  /** 更新後の先発登板日マップ（全球団、ローテ管理用） */
  starterLastDay: Record<string, number>;
}

/**
 * 進行単位（game/day/week）に応じて日程を消化し、勝敗を集計する。
 * 他カードは即計算、マイチームの試合結果は myResults に格納して返す。
 */
export function advanceMatches(state: GameState): AdvanceOutput {
  const games = state.schedule;
  const unit = state.advanceUnit;
  const myId = state.myTeamId;

  // records をディープコピー
  const records: Record<string, TeamRecord> = {};
  for (const [id, r] of Object.entries(state.records)) records[id] = { ...r };

  // playerStats をディープコピー
  const playerStats: Record<string, PlayerSeasonStats> = structuredClone(state.playerStats ?? {});

  const accBatting = (id: string, line: Parameters<typeof accumulateBatting>[1]) => {
    const ps = (playerStats[id] ??= {});
    ps.batting ??= emptyBatting();
    accumulateBatting(ps.batting, line);
  };
  const accPitching = (id: string, line: Parameters<typeof accumulatePitching>[1]) => {
    const ps = (playerStats[id] ??= {});
    ps.pitching ??= emptyPitching();
    accumulatePitching(ps.pitching, line);
  };

  // マイチームの team / order / injuries は負傷補充で書き換わるため可変コピーを持つ
  const teamMut: Record<string, Team> = { ...Object.fromEntries(state.teams.map((t) => [t.id, t])) };
  const orderMut: Record<string, TeamOrder> = { ...state.orders };
  let injuries: Record<string, InjuryEntry> = structuredClone(state.injuries ?? {});
  let recentGames: RecentGame[] = [...(state.recentGames ?? [])];
  // 先発登板日マップ（全球団）。中5日（day差>5）の登板間隔を守るための状態
  const starterLastDay: Record<string, number> = { ...(state.starterLastDay ?? {}) };

  // マイチームの一軍が規定人数（野手15・投手14）からずれていたら正規化し、オーダーを再編成する。
  // 負傷補充などでシーズン中に一軍人数が崩れたケースを開幕以外でも補正する。
  if (myId) {
    const myTeam0 = teamMut[myId];
    if (myTeam0) {
      const firstBatters = myTeam0.players.filter((p) => p.type === 'BATTER' && myTeam0.rosterLevel[p.id] === 'FIRST').length;
      const firstPitchers = myTeam0.players.filter((p) => p.type === 'PITCHER' && myTeam0.rosterLevel[p.id] === 'FIRST').length;
      // 二軍に補充可能な控えがいる場合のみ補正（枠が埋められないときは現状維持）
      const farmBatters = myTeam0.players.filter((p) => p.type === 'BATTER' && myTeam0.rosterLevel[p.id] === 'FARM').length;
      const farmPitchers = myTeam0.players.filter((p) => p.type === 'PITCHER' && myTeam0.rosterLevel[p.id] === 'FARM').length;
      const needFix =
        (firstBatters !== 15 && !(firstBatters < 15 && farmBatters === 0)) ||
        (firstPitchers !== 14 && !(firstPitchers < 14 && farmPitchers === 0));
      if (needFix) {
        // シーズン中は IL を維持（負傷選手を即復帰させない）。FARM からのみ昇格して補充する。
        const normalized = normalizeRoster(myTeam0, true);
        teamMut[myId] = normalized;
        orderMut[myId] = buildBestOrder(normalized);
      }
    }
  }

  const teamMap = new Map(state.teams.map((t) => [t.id, t]));

  /**
   * この試合の先発投手を選ぶ。
   * 中5日ルール: 直近に先発した日からの経過が5日以下の投手は避ける。
   * 候補（登板可能な先発）の中で「最後に先発した日が最も古い」投手を選ぶ。
   * 全員が中5日未満なら、やむなく最も古い投手を選ぶ（登板間隔の長い順を優先）。
   */
  const pickStarter = (team: Team, order: TeamOrder, day: number): string | undefined => {
    const starters = order.pitchers
      .filter((a) => a.role === 'STARTER')
      .map((a) => a.playerId)
      .filter((id) => team.players.some((p) => p.id === id)); // 在籍確認
    if (starters.length === 0) return undefined;

    // 最後に先発した日（未登板は -Infinity 相当で最優先）昇順＝休養が長い順
    const lastDay = (id: string) => starterLastDay[id] ?? Number.NEGATIVE_INFINITY;
    const sorted = [...starters].sort((a, b) => lastDay(a) - lastDay(b));

    // 中5日（day - lastDay > 5）を満たす最も休養の長い投手を優先
    const rested = sorted.find((id) => day - lastDay(id) > 5);
    return rested ?? sorted[0];
  };

  const side = (teamId: string, day: number): SideInput => {
    const team = teamMut[teamId] ?? teamMap.get(teamId)!;
    const order = orderMut[teamId] ?? buildBestOrder(team);
    const startPitcherId = pickStarter(team, order, day);
    return { team, order, startPitcherId };
  };

  let cursor = state.gameCursor;
  const myResults: GameResult[] = [];

  const finalTeams = () => state.teams.map((t) => teamMut[t.id] ?? t);

  if (cursor >= games.length) {
    return {
      records, gameCursor: cursor, weekIndex: state.weekIndex, myResults, playerStats,
      finished: true, teams: finalTeams(), orders: orderMut, injuries, recentGames, starterLastDay,
    };
  }

  const startWeek = games[cursor].week;
  const startMonth = Math.floor(startWeek / 4);

  while (cursor < games.length) {
    const g = games[cursor];

    // 単位の境界で停止（消化前に判定）
    if (unit === 'week' && g.week !== startWeek) break;
    if (unit === 'month' && Math.floor(g.week / 4) !== startMonth) break;

    const awaySide = side(g.awayId, g.day);
    const homeSide = side(g.homeId, g.day);
    const res = simulateGame(awaySide, homeSide);
    applyResult(records, res);
    // 先発登板日を記録（実際に先発した投手＝pitchers配列の先頭）
    const awayStarter = awaySide.startPitcherId ?? res.awayPitchers[0]?.playerId;
    const homeStarter = homeSide.startPitcherId ?? res.homePitchers[0]?.playerId;
    if (awayStarter) starterLastDay[awayStarter] = g.day;
    if (homeStarter) starterLastDay[homeStarter] = g.day;
    const isMy = !!myId && (g.awayId === myId || g.homeId === myId);
    // マイチーム試合はレポート（達成記録・負傷）を累計反映「前」に算出
    if (isMy) {
      const myTeam = teamMut[myId!] ?? teamMap.get(myId!)!;
      const rep = buildMatchReport(res, myId!, playerStats, myTeam.players);
      res.achievements = rep.achievements;
      res.injuries = rep.injuries;

      // 1) この試合を1消化として離脱カウントを進め、満了者は二軍へ復帰
      const ticked = tickInjuries(injuries);
      injuries = ticked.injuries;
      if (ticked.returned.length > 0) {
        let t = teamMut[myId!] ?? teamMap.get(myId!)!;
        let o = orderMut[myId!] ?? buildBestOrder(t);
        for (const r of ticked.returned) {
          const back = returnToFarm(t, o, r.playerId);
          t = back.team;
          o = back.order;
        }
        teamMut[myId!] = t;
        orderMut[myId!] = o;
        res.returns = ticked.returned.map((r) => `${r.name}`);
      }

      // 2) 新規負傷を登録（今試合発生分は0試合目＝今回はカウントしない）→ IL化と補充
      if (rep.injuries.length > 0) {
        let t = teamMut[myId!] ?? teamMap.get(myId!)!;
        let o = orderMut[myId!] ?? buildBestOrder(t);
        for (const inj of rep.injuries) {
          const injured = t.players.find((p) => p.id === inj.playerId);
          const applied = applyInjury(t, o, inj.playerId);
          t = applied.team;
          o = applied.order;
          injuries[inj.playerId] = {
            playerId: inj.playerId,
            name: inj.name,
            position: injured?.position ?? '',
            gamesLeft: inj.games,
            totalGames: inj.games,
            severe: inj.severe,
          };
        }
        teamMut[myId!] = t;
        orderMut[myId!] = o;
      }
    }
    // 個人成績を累計へ反映
    for (const bl of [...res.awayBatters, ...res.homeBatters]) accBatting(bl.playerId, bl);
    for (const pl of [...res.awayPitchers, ...res.homePitchers]) accPitching(pl.playerId, pl);
    // 守備失策を累計へ反映（投手なら投手欄、それ以外は野手欄）
    if (res.fieldErrors) {
      for (const [pid, n] of Object.entries(res.fieldErrors)) {
        const ps = (playerStats[pid] ??= {});
        if (ps.pitching && !ps.batting) {
          ps.pitching.errors += n;
        } else {
          ps.batting ??= emptyBatting();
          ps.batting.errors += n;
        }
      }
    }
    if (isMy) {
      myResults.push(res);
      // 直近試合結果を記録（マイチーム視点の勝敗）
      const myResult: RecentGame['myResult'] = res.draw
        ? 'draw'
        : res.winnerId === myId
          ? 'win'
          : 'lose';
      recentGames.push({
        myResult,
        homeMark: teamMap.get(g.homeId)?.markChar ?? '?',
        awayMark: teamMap.get(g.awayId)?.markChar ?? '?',
        homeScore: res.homeScore,
        awayScore: res.awayScore,
      });
      recentGames = recentGames.slice(-6);
    }
    cursor++;

    // 1試合単位: マイチームの試合を1つ消化したら停止
    if (unit === 'game' && myId && (g.awayId === myId || g.homeId === myId)) break;
  }

  const weekIndex = cursor < games.length ? games[cursor].week : games[games.length - 1].week;
  const finished = cursor >= games.length;
  return {
    records, gameCursor: cursor, weekIndex, myResults, playerStats, finished,
    teams: finalTeams(), orders: orderMut, injuries, recentGames, starterLastDay,
  };
}

function applyResult(records: Record<string, TeamRecord>, res: GameResult): void {
  const away = records[res.awayTeamId];
  const home = records[res.homeTeamId];
  if (!away || !home) return;
  if (res.draw) {
    away.draws++;
    home.draws++;
  } else if (res.winnerId === res.homeTeamId) {
    home.wins++;
    away.losses++;
  } else {
    away.wins++;
    home.losses++;
  }
}
