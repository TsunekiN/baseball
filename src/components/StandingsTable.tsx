import { useState } from 'react';
import type { League, Team } from '../domain/types';
import type { TeamRecord } from '../domain/gameState';
import type { ScheduleGame } from '../domain/seasonSchedule';
import {
  buildStandings,
  formatAvg,
  formatEra,
  formatGamesBehind,
  formatWinRate,
} from '../domain/standings';

interface Props {
  teams: Team[];
  /** マイチームの所属リーグ（上に表示） */
  myLeague: League;
  myTeamId: string;
  records: Record<string, TeamRecord>;
  schedule: ScheduleGame[];
  gameCursor: number;
}

type Mode = 'record' | 'stats';

function leagueLabel(league: League): string {
  return league === 'CENTRAL' ? 'セ・リーグ' : 'パ・リーグ';
}

/** 順位表（マイチームの所属リーグ→もう一方のリーグの順で両方表示） */
export function StandingsTable({ teams, myLeague, myTeamId, records, schedule, gameCursor }: Props) {
  const [mode, setMode] = useState<Mode>('record');
  const otherLeague: League = myLeague === 'CENTRAL' ? 'PACIFIC' : 'CENTRAL';

  return (
    <div className="standings-wrap">
      <LeagueTable teams={teams} league={myLeague} mode={mode} myTeamId={myTeamId} records={records} schedule={schedule} gameCursor={gameCursor} />
      <LeagueTable teams={teams} league={otherLeague} mode={mode} myTeamId={myTeamId} records={records} schedule={schedule} gameCursor={gameCursor} />

      <div className="standings-actions">
        <button
          className="ghost-btn switch-btn"
          onClick={() => setMode((m) => (m === 'record' ? 'stats' : 'record'))}
        >
          切替
        </button>
      </div>
    </div>
  );
}

/** 1リーグ分の順位表 */
function LeagueTable({
  teams,
  league,
  mode,
  myTeamId,
  records,
  schedule,
  gameCursor,
}: {
  teams: Team[];
  league: League;
  mode: Mode;
  myTeamId: string;
  records: Record<string, TeamRecord>;
  schedule: ScheduleGame[];
  gameCursor: number;
}) {
  const rows = buildStandings(teams, league, records, schedule, gameCursor);

  return (
    <div className="standings-block">
      <h3 className="league-heading">{leagueLabel(league)}</h3>
      <div className={`standings ${mode}`}>
        {mode === 'record' ? (
          <div className="standings-head">
            <span className="col-rank">順</span>
            <span className="col-team">チーム</span>
            <span className="col-num">試</span>
            <span className="col-num">勝</span>
            <span className="col-num">敗</span>
            <span className="col-num">分</span>
            <span className="col-rate">勝率</span>
            <span className="col-gb">差</span>
          </div>
        ) : (
          <div className="standings-head">
            <span className="col-rank">順</span>
            <span className="col-team">チーム</span>
            <span className="col-stat">打率</span>
            <span className="col-stat">OPS</span>
            <span className="col-stat">本塁打</span>
            <span className="col-stat">盗塁</span>
            <span className="col-stat">防御率</span>
            <span className="col-stat">失策</span>
          </div>
        )}

        {rows.map((r) => (
          <div
            key={r.team.id}
            className={`standings-row${r.team.id === myTeamId ? ' mine' : ''}`}
          >
            <span className="col-rank">{r.rank}</span>
            <span className="col-team">
              <span className="team-badge sm" style={{ background: r.team.colorPrimary }}>
                {r.team.markChar}
              </span>
              {mode === 'record' && <span className="std-name">{r.team.nickName}</span>}
            </span>

            {mode === 'record' ? (
              <>
                <span className="col-num">{r.games}</span>
                <span className="col-num">{r.wins}</span>
                <span className="col-num">{r.losses}</span>
                <span className="col-num">{r.draws}</span>
                <span className="col-rate">{formatWinRate(r.winRate)}</span>
                {r.magic != null ? (
                  <span className="col-gb magic">M{r.magic}</span>
                ) : (
                  <span className="col-gb">{formatGamesBehind(r.gamesBehind)}</span>
                )}
              </>
            ) : (
              <>
                <span className="col-stat">{formatAvg(r.avg)}</span>
                <span className="col-stat">{r.ops.toFixed(3).replace(/^0/, '')}</span>
                <span className="col-stat">{r.hr}</span>
                <span className="col-stat">{r.sb}</span>
                <span className="col-stat">{formatEra(r.era)}</span>
                <span className="col-stat">{r.errors}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
