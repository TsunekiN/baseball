import { useState } from 'react';
import type { League, Player, Team, TeamOrder } from '../domain/types';
import type { AbilitySnapshot, PlayerCareer, TeamRecord } from '../domain/gameState';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { TitleCounts } from '../domain/stats';
import type { ScheduleGame } from '../domain/seasonSchedule';
import { buildBestOrder } from '../domain/orderFactory';
import { orderedByOrder } from '../domain/rosterOrder';
import { StandingsTable } from './StandingsTable';
import { PlayerTable } from './PlayerTable';
import { PlayerStatsTable } from './PlayerStatsTable';
import { PlayerDetailModal } from './PlayerDetailModal';

interface Props {
  teams: Team[];
  myLeague: League;
  myTeamId: string;
  records: Record<string, TeamRecord>;
  schedule: ScheduleGame[];
  gameCursor: number;
  orders: Record<string, TeamOrder>;
  playerStats: Record<string, PlayerSeasonStats>;
  postseasonStats: Record<string, PlayerSeasonStats>;
  playerCareers: Record<string, PlayerCareer>;
  playerTitles: Record<string, TitleCounts>;
  seasonStartAbilities: Record<string, AbilitySnapshot>;
  year: number;
}

type SubTab = 'standings' | 'teamInfo';
type Group = 'BATTER' | 'PITCHER';
type Mode = 'LIST' | 'STATS';

/** 順位画面: 順位表と12球団のチーム情報（一軍選手）を切り替え表示 */
export function StandingsScreen({
  teams,
  myLeague,
  myTeamId,
  records,
  schedule,
  gameCursor,
  orders,
  playerStats,
  postseasonStats,
  playerCareers,
  playerTitles,
  seasonStartAbilities,
  year,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('standings');

  // チーム情報タブ内のステート
  const [selectedTeamId, setSelectedTeamId] = useState<string>(myTeamId);
  const [group, setGroup] = useState<Group>('BATTER');
  const [mode, setMode] = useState<Mode>('LIST');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const currentTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];
  const currentOrder = orders[currentTeam.id] ?? buildBestOrder(currentTeam);

  // 各チームの一軍選手のみ抽出
  const { first: firstPlayers } = orderedByOrder(currentTeam, currentOrder, group);

  const centralTeams = teams.filter((t) => t.league === 'CENTRAL');
  const pacificTeams = teams.filter((t) => t.league === 'PACIFIC');

  return (
    <div className="standings-screen-wrap">
      {/* 画面上部の切り替えボタン: 順位表 / チーム情報 */}
      <div className="standings-view-tabs">
        <button
          className={`standings-view-tab${subTab === 'standings' ? ' active' : ''}`}
          onClick={() => setSubTab('standings')}
        >
          順位表
        </button>
        <button
          className={`standings-view-tab${subTab === 'teamInfo' ? ' active' : ''}`}
          onClick={() => setSubTab('teamInfo')}
        >
          チーム情報
        </button>
      </div>

      {subTab === 'standings' && (
        <StandingsTable
          teams={teams}
          myLeague={myLeague}
          myTeamId={myTeamId}
          records={records}
          schedule={schedule}
          gameCursor={gameCursor}
        />
      )}

      {subTab === 'teamInfo' && (
        <div className="team-info-view">
          {/* 12球団セレクター */}
          <div className="team-selector-bar">
            <div className="team-selector-league">
              <span className="team-selector-label ce">セ</span>
              <div className="team-selector-chips">
                {centralTeams.map((t) => (
                  <button
                    key={t.id}
                    className={`team-chip${t.id === selectedTeamId ? ' active' : ''}${t.id === myTeamId ? ' is-my-team' : ''}`}
                    onClick={() => {
                      setSelectedTeamId(t.id);
                      setSelectedPlayer(null);
                    }}
                    title={t.name}
                  >
                    <span className="team-badge xs" style={{ background: t.colorPrimary }}>
                      {t.markChar}
                    </span>
                    <span className="team-chip-name">{t.shortName}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="team-selector-league">
              <span className="team-selector-label pa">パ</span>
              <div className="team-selector-chips">
                {pacificTeams.map((t) => (
                  <button
                    key={t.id}
                    className={`team-chip${t.id === selectedTeamId ? ' active' : ''}${t.id === myTeamId ? ' is-my-team' : ''}`}
                    onClick={() => {
                      setSelectedTeamId(t.id);
                      setSelectedPlayer(null);
                    }}
                    title={t.name}
                  >
                    <span className="team-badge xs" style={{ background: t.colorPrimary }}>
                      {t.markChar}
                    </span>
                    <span className="team-chip-name">{t.shortName}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 大タブ: 野手 / 投手 */}
          <div className="roster-tabs">
            <button
              className={`roster-tab${group === 'BATTER' ? ' active' : ''}`}
              onClick={() => {
                setGroup('BATTER');
                setSelectedPlayer(null);
              }}
            >
              野手
            </button>
            <button
              className={`roster-tab${group === 'PITCHER' ? ' active' : ''}`}
              onClick={() => {
                setGroup('PITCHER');
                setSelectedPlayer(null);
              }}
            >
              投手
            </button>
          </div>

          {/* 小タブ: 一覧 / 成績 */}
          <div className="segmented">
            <button
              className={`seg${mode === 'LIST' ? ' active' : ''}`}
              onClick={() => {
                setMode('LIST');
                setSelectedPlayer(null);
              }}
            >
              一覧
            </button>
            <button
              className={`seg${mode === 'STATS' ? ' active' : ''}`}
              onClick={() => {
                setMode('STATS');
                setSelectedPlayer(null);
              }}
            >
              成績
            </button>
          </div>

          {/* 各チームの一軍選手のみ表示 */}
          {mode === 'LIST' && (
            <>
              <div className="roster-group-title">
                {currentTeam.name} 一軍{group === 'BATTER' ? '野手' : '投手'} ({firstPlayers.length})
              </div>
              <PlayerTable players={firstPlayers} type={group} onSelect={setSelectedPlayer} />
            </>
          )}

          {mode === 'STATS' && (
            <>
              <div className="roster-group-title">
                {currentTeam.name} 一軍{group === 'BATTER' ? '野手' : '投手'}成績 ({firstPlayers.length})
              </div>
              <PlayerStatsTable
                players={firstPlayers}
                type={group}
                onSelect={setSelectedPlayer}
                playerStats={playerStats}
              />
            </>
          )}

          {selectedPlayer && (
            <PlayerDetailModal
              player={selectedPlayer}
              stats={playerStats[selectedPlayer.id]}
              postseasonStats={postseasonStats[selectedPlayer.id]}
              career={playerCareers[selectedPlayer.id]}
              titles={playerTitles[selectedPlayer.id]}
              startAbilities={seasonStartAbilities[selectedPlayer.id]}
              year={year}
              onClose={() => setSelectedPlayer(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
