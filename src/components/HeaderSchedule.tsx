import { useMemo } from 'react';
import type { Team } from '../domain/types';
import type { TeamRecord } from '../domain/gameState';
import type { ScheduleGame } from '../domain/seasonSchedule';
import {
  GAMES_PER_TEAM,
  isRegularSeason,
  weekDef,
  weekKindLabel,
  weekLabel,
} from '../domain/schedule';
import { leagueRank } from '../domain/standings';

interface Props {
  teams: Team[];
  myTeam: Team;
  weekIndex: number;
  year: number;
  records: Record<string, TeamRecord>;
  gameCursor: number;
  schedule: ScheduleGame[];
}

/** ヘッダーの日程バー: 左=日付/次戦, 中央=試合予定, 右=順位 */
export function HeaderSchedule({ teams, myTeam, weekIndex, year, records, gameCursor, schedule }: Props) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // マイチームの消化試合数と次戦番号
  const played = useMemo(
    () =>
      schedule
        .slice(0, gameCursor)
        .filter((g) => g.awayId === myTeam.id || g.homeId === myTeam.id).length,
    [schedule, gameCursor, myTeam.id],
  );
  const gameNo = Math.min(played + 1, GAMES_PER_TEAM);

  // 今後のマイチーム対戦相手（直近6試合）
  const upcoming = useMemo(() => {
    return schedule
      .slice(gameCursor)
      .filter((g) => g.awayId === myTeam.id || g.homeId === myTeam.id)
      .slice(0, 6)
      .map((g) => teamMap.get(g.awayId === myTeam.id ? g.homeId : g.awayId)!)
      .filter(Boolean);
  }, [schedule, gameCursor, myTeam.id, teamMap]);

  const def = weekDef(weekIndex);
  const regular = isRegularSeason(weekIndex);
  const rank = leagueRank(teams, myTeam, records);

  return (
    <div className="header-schedule">
      <span className="hs-date">
        <span className="hs-week">{weekLabel(weekIndex, year)}</span>
        {regular ? (
          <span className="hs-gameno">
            {gameNo}/{GAMES_PER_TEAM}
          </span>
        ) : (
          <span className="hs-phase">{weekKindLabel(def.kind)}</span>
        )}
      </span>

      {def.kind === 'INTERLEAGUE' && <span className="hs-tag">交流戦</span>}

      {upcoming.length > 0 ? (
        <span className="hs-plan">
          <span className="hs-plan-label">試合予定：</span>
          <span className="hs-marks">
            {upcoming.map((op, i) => (
              <span key={i} className="hs-mark" style={{ color: op.colorPrimary }}>
                {op.markChar}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="hs-plan" />
      )}

      <span className="hs-rank">順位：{rank}位</span>
    </div>
  );
}
