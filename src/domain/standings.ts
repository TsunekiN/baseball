import type { League, Team } from './types';
import type { TeamRecord } from './gameState';
import type { ScheduleGame } from './seasonSchedule';
import { GAMES_PER_TEAM } from './schedule';

/** 順位表の1行 */
export interface StandingRow {
  rank: number;
  team: Team;
  games: number; // 試合数
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 勝率
  gamesBehind: number; // 首位とのゲーム差
  /** 優勝マジック（点灯時のみ正の数。非点灯はnull） */
  magic: number | null;

  // チーム成績（フェーズ3で実集計に差し替え。現状は0）
  avg: number; // チーム打率
  ops: number; // チームOPS
  hr: number; // チーム本塁打
  sb: number; // チーム盗塁
  era: number; // チーム防御率
  errors: number; // チーム失策
}

/**
 * 指定リーグの順位表を作る（勝率順・ゲーム差計算）。
 * records: teamId -> 勝敗記録。
 * チーム打撃/守備成績（avg等）は個人成績集計の実装後に反映（現状0）。
 */
export function buildStandings(
  teams: Team[],
  league: League,
  records: Record<string, TeamRecord>,
  schedule?: ScheduleGame[],
  gameCursor?: number,
): StandingRow[] {
  const leagueTeams = teams.filter((t) => t.league === league);

  const rows: StandingRow[] = leagueTeams.map((team): StandingRow => {
    const r = records[team.id] ?? { wins: 0, losses: 0, draws: 0 };
    const decided = r.wins + r.losses;
    return {
      rank: 0,
      team,
      games: r.wins + r.losses + r.draws,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      winRate: decided > 0 ? r.wins / decided : 0,
      gamesBehind: 0,
      magic: null,
      avg: 0,
      ops: 0,
      hr: 0,
      sb: 0,
      era: 0,
      errors: 0,
    };
  });

  // 勝率降順（同率は勝利数）
  rows.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

  // 首位基準のゲーム差
  const lead = rows[0];
  rows.forEach((row, i) => {
    row.rank = i + 1;
    row.gamesBehind = lead ? ((lead.wins - row.wins) + (row.losses - lead.losses)) / 2 : 0;
  });

  // 首位の優勝マジック（厳密判定: 2位以下の自力優勝が全員消滅したら点灯）
  const leader = rows[0];
  const rivals = rows.slice(1);
  if (leader && rivals.length > 0 && schedule && gameCursor != null) {
    const future = schedule.slice(gameCursor); // 未消化の全カード
    const remTotal = (r: StandingRow) => GAMES_PER_TEAM - r.games; // 残り全試合数
    // x と y の直接対決の残数
    const directRem = (x: string, y: string) =>
      future.filter(
        (g) => (g.awayId === x && g.homeId === y) || (g.awayId === y && g.homeId === x),
      ).length;

    // チームBの自力優勝が生存しているか（残り全勝すれば単独首位になれる）
    const alive = (b: StandingRow): boolean => {
      const bMax = b.wins + remTotal(b); // Bが全勝したときの勝利数
      return rows.every((a) => {
        if (a.team.id === b.team.id) return true;
        // Bが全勝＝A対B戦はAが負ける。Aの到達可能勝利はその分を除く
        const aReach = a.wins + remTotal(a) - directRem(a.team.id, b.team.id);
        return aReach < bMax; // すべてのAが届かなければ生存
      });
    };

    // 2位以下が全員、自力優勝消滅していれば首位にマジック点灯
    const allRivalsEliminated = rivals.every((b) => !alive(b));
    if (allRivalsEliminated) {
      const m = Math.max(
        ...rivals.map((b) => {
          // 首位が全勝＝首位対B戦はBが負ける
          const threat = b.wins + remTotal(b) - directRem(b.team.id, leader.team.id);
          return threat - leader.wins + 1;
        }),
      );
      leader.magic = m > 0 ? m : null;
    }
  }

  return rows;
}

/** マイチームの同一リーグ内順位（1始まり） */
export function leagueRank(
  teams: Team[],
  myTeam: Team,
  records: Record<string, TeamRecord>,
): number {
  const rows = buildStandings(teams, myTeam.league, records);
  const found = rows.find((r) => r.team.id === myTeam.id);
  return found ? found.rank : 1;
}

/** 勝率の表示文字列（.000 形式） */
export function formatWinRate(rate: number): string {
  return rate.toFixed(3).replace(/^0/, '');
}

/** ゲーム差の表示文字列（0なら「-」、それ以外は「N.N」） */
export function formatGamesBehind(gb: number): string {
  if (gb <= 0) return '-';
  return gb % 1 === 0 ? String(gb) : gb.toFixed(1);
}

/** 打率の表示文字列（.000 形式。勝率と同形式） */
export function formatAvg(avg: number): string {
  return formatWinRate(avg);
}

/** 防御率の表示文字列（0.00 形式） */
export function formatEra(era: number): string {
  return era.toFixed(2);
}

/**
 * 首位チームの優勝マジック状況を返す。
 *  - マジックが点灯していない（2位以下に自力優勝の可能性が残る）: null
 *  - 点灯: { teamId, magic } を返す。magic >= 1 はマジック点灯中、magic <= 0 は優勝確定。
 * schedule/gameCursor が無い場合は null。
 */
export function pennantMagicInfo(
  teams: Team[],
  league: League,
  records: Record<string, TeamRecord>,
  schedule: ScheduleGame[],
  gameCursor: number,
): { teamId: string; magic: number } | null {
  const rows = buildStandings(teams, league, records);
  const leader = rows[0];
  const rivals = rows.slice(1);
  if (!leader || rivals.length === 0) return null;

  const future = schedule.slice(gameCursor);
  const remTotal = (r: StandingRow) => GAMES_PER_TEAM - r.games;
  const directRem = (x: string, y: string) =>
    future.filter(
      (g) => (g.awayId === x && g.homeId === y) || (g.awayId === y && g.homeId === x),
    ).length;

  const alive = (b: StandingRow): boolean => {
    const bMax = b.wins + remTotal(b);
    return rows.every((a) => {
      if (a.team.id === b.team.id) return true;
      const aReach = a.wins + remTotal(a) - directRem(a.team.id, b.team.id);
      return aReach < bMax;
    });
  };

  // 2位以下に自力優勝の可能性が残っていればマジックは点灯しない
  if (!rivals.every((b) => !alive(b))) return null;

  // マジックナンバー（2位以下の脅威の最大値から算出）。
  // magic >= 1: 点灯中 / magic <= 0: すでに優勝確定。
  const magic = Math.max(
    ...rivals.map((b) => {
      const threat = b.wins + remTotal(b) - directRem(b.team.id, leader.team.id);
      return threat - leader.wins + 1;
    }),
  );
  return { teamId: leader.team.id, magic };
}
