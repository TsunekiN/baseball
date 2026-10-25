import { useMemo, useState } from 'react';
import type { League, Player, Team } from '../domain/types';
import type { AbilitySnapshot, PlayerCareer, SeasonHistory, TeamSeasonResult } from '../domain/gameState';
import type { PlayerSeasonStats } from '../match/matchStats';
import { emptyBatting, emptyPitching } from '../match/matchStats';
import {
  BATTING_METRICS,
  PITCHING_METRICS,
  toBattingStats,
  toPitchingStats,
  type BattingMetric,
  type HallOfFamer,
  type PitchingMetric,
  type TitleCounts,
} from '../domain/stats';
import { PlayerDetailModal } from './PlayerDetailModal';

interface Props {
  teams: Team[];
  myTeam: Team;
  playerStats: Record<string, PlayerSeasonStats>;
  /** 当年ポストシーズン成績（詳細モーダルのPSタブ用。レギュラーとは独立） */
  postseasonStats: Record<string, PlayerSeasonStats>;
  playerCareers: Record<string, PlayerCareer>;
  playerTitles: Record<string, TitleCounts>;
  seasonHistory: SeasonHistory[];
  hallOfFame: HallOfFamer[];
  year: number;
  /** 今シーズン開幕時点の能力スナップショット（詳細モーダルの成長値表示用） */
  seasonStartAbilities: Record<string, AbilitySnapshot>;
}

type Section = 'ranking' | 'team' | 'hof';
type Group = 'BATTER' | 'PITCHER';

export function RecordScreen({ teams, myTeam, playerStats, postseasonStats, playerCareers, playerTitles, seasonHistory, hallOfFame, year, seasonStartAbilities }: Props) {
  const [section, setSection] = useState<Section>('ranking');
  const [selected, setSelected] = useState<Player | null>(null);

  return (
    <div>
      <div className="segmented">
        <button className={`seg${section === 'ranking' ? ' active' : ''}`} onClick={() => setSection('ranking')}>
          ランキング
        </button>
        <button className={`seg${section === 'team' ? ' active' : ''}`} onClick={() => setSection('team')}>
          チーム記録
        </button>
        <button className={`seg${section === 'hof' ? ' active' : ''}`} onClick={() => setSection('hof')}>
          殿堂入り
        </button>
      </div>

      {section === 'ranking' && <Ranking teams={teams} playerStats={playerStats} onSelect={setSelected} />}
      {section === 'team' && <TeamStats team={myTeam} seasonHistory={seasonHistory} />}
      {section === 'hof' && <HallOfFame hallOfFame={hallOfFame} playerCareers={playerCareers} />}

      {selected && (
        <PlayerDetailModal
          player={selected}
          stats={playerStats[selected.id]}
          postseasonStats={postseasonStats[selected.id]}
          career={playerCareers[selected.id]}
          titles={playerTitles[selected.id]}
          startAbilities={seasonStartAbilities[selected.id]}
          year={year}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ================= ランキング =================
const TOP_N = 5;

function Ranking({
  teams,
  playerStats,
  onSelect,
}: {
  teams: Team[];
  playerStats: Record<string, PlayerSeasonStats>;
  onSelect: (p: Player) => void;
}) {
  const [group, setGroup] = useState<Group>('BATTER');
  const metrics = group === 'BATTER' ? BATTING_METRICS : PITCHING_METRICS;

  return (
    <div>
      <div className="roster-tabs">
        <button className={`roster-tab${group === 'BATTER' ? ' active' : ''}`} onClick={() => setGroup('BATTER')}>
          打撃
        </button>
        <button className={`roster-tab${group === 'PITCHER' ? ' active' : ''}`} onClick={() => setGroup('PITCHER')}>
          投手
        </button>
      </div>

      <div className="rank-league-head">
        <span>{leagueLabel('CENTRAL')}</span>
        <span>{leagueLabel('PACIFIC')}</span>
      </div>

      {metrics.map((m) => (
        <div key={m.key} className="metric-block">
          <div className="metric-title">{m.label}</div>
          <div className="rank-columns">
            <LeagueRanking teams={teams} league="CENTRAL" group={group} metric={m} limit={TOP_N} playerStats={playerStats} onSelect={onSelect} />
            <LeagueRanking teams={teams} league="PACIFIC" group={group} metric={m} limit={TOP_N} playerStats={playerStats} onSelect={onSelect} />
          </div>
        </div>
      ))}
    </div>
  );
}

function leagueLabel(l: League) {
  return l === 'CENTRAL' ? 'セ・リーグ' : 'パ・リーグ';
}

function LeagueRanking({
  teams,
  league,
  group,
  metric,
  limit,
  playerStats,
  onSelect,
}: {
  teams: Team[];
  league: League;
  group: Group;
  metric: BattingMetric | PitchingMetric;
  limit: number;
  playerStats: Record<string, PlayerSeasonStats>;
  onSelect: (p: Player) => void;
}) {
  const rows = useMemo(() => {
    const entries: { player: Player; teamMark: string; color: string }[] = [];
    teams
      .filter((t) => t.league === league)
      .forEach((t) => {
        t.players
          .filter((p) => p.type === group)
          .forEach((p) => entries.push({ player: p, teamMark: t.markChar, color: t.colorPrimary }));
      });

    const scored = entries.map((x) => {
      const st = playerStats[x.player.id];
      if (group === 'BATTER') {
        const s = toBattingStats(st?.batting ?? emptyBatting());
        const m = metric as BattingMetric;
        return { ...x, value: m.get(s), qualified: s.qualified, hasStats: s.ab > 0 };
      } else {
        const s = toPitchingStats(st?.pitching ?? emptyPitching());
        const m = metric as PitchingMetric;
        return { ...x, value: m.get(s), qualified: s.qualified, hasStats: s.ip > 0 };
      }
    });

    // 成績のある選手のみ（未出場の0成績は除外）
    let filtered = scored.filter((x) => x.hasStats);
    if (metric.requiresQualified) filtered = filtered.filter((x) => x.qualified);
    filtered.sort((a, b) => (metric.higherIsBetter ? b.value - a.value : a.value - b.value));
    return filtered.slice(0, limit);
  }, [teams, league, group, metric, limit, playerStats]);

  return (
    <div className="rank-col">
      <div className="rank-list">
        {rows.map((r, i) => (
          <button key={r.player.id} className="rank-item clickable" onClick={() => onSelect(r.player)}>
            <span className="rank-no">{i + 1}</span>
            <span className="rank-mark" style={{ color: r.color }}>
              {r.teamMark}
            </span>
            <span className="rank-name">{r.player.name}</span>
            <span className="rank-val">{metric.format(r.value)}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="rank-empty">該当者なし</div>}
      </div>
    </div>
  );
}

// ================= チーム記録 =================
function fmtPct(v: number): string {
  return v.toFixed(3).replace(/^0/, '');
}

const PAGE_SIZE = 10;

function rankText(s: TeamSeasonResult): string {
  return s.japanChampion ? '日本一' : `${s.rank}位`;
}

function TeamStats({ team, seasonHistory }: { team: Team; seasonHistory: SeasonHistory[] }) {
  const [mode, setMode] = useState<'record' | 'stats'>('record');
  const [page, setPage] = useState(0);

  // このチームの年度別成績（新しい年が上）
  const seasons = useMemo(() => {
    const rows: TeamSeasonResult[] = [];
    for (const h of seasonHistory) {
      const r = h.teams.find((t) => t.teamId === team.id);
      if (r) rows.push(r);
    }
    return rows.sort((a, b) => b.year - a.year);
  }, [seasonHistory, team.id]);

  const pageCount = Math.max(1, Math.ceil(seasons.length / PAGE_SIZE));
  const visible = seasons.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const total = seasons.reduce(
    (acc, s) => ({
      games: acc.games + s.wins + s.losses + s.draws,
      wins: acc.wins + s.wins,
      losses: acc.losses + s.losses,
      draws: acc.draws + s.draws,
    }),
    { games: 0, wins: 0, losses: 0, draws: 0 },
  );
  const totalPct = total.wins + total.losses > 0 ? total.wins / (total.wins + total.losses) : 0;

  if (seasons.length === 0) {
    return (
      <div className="home-panel">
        <p className="home-note">まだ年度別成績がありません。1シーズン終えると記録が残ります。</p>
      </div>
    );
  }

  return (
    <div>
      {/* 通算成績 */}
      <div className="career-total">
        <div className="career-label">通算成績</div>
        <div className="career-line">
          {total.games}試合 {total.wins}勝 {total.losses}敗 {total.draws}分 ・ 勝率{fmtPct(totalPct)}
        </div>
      </div>

      <div className="segmented">
        <button className={`seg${mode === 'record' ? ' active' : ''}`} onClick={() => setMode('record')}>
          順位・勝敗
        </button>
        <button className={`seg${mode === 'stats' ? ' active' : ''}`} onClick={() => setMode('stats')}>
          打撃・投手
        </button>
      </div>

      <div className="season-header">
        <span className="roster-group-title">年度別成績</span>
        <div className="pager">
          <button className="pager-btn" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>←</button>
          <span className="pager-label">{page + 1}/{pageCount}</span>
          <button className="pager-btn" onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount - 1}>→</button>
        </div>
      </div>

      <div className="season-table">
        {mode === 'record' ? (
          <>
            <div className="season-head">
              <span>年度</span><span>順位</span><span>試</span><span>勝</span><span>敗</span><span>分</span><span>勝率</span>
            </div>
            {visible.map((s) => {
              const g = s.wins + s.losses + s.draws;
              const pct = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0;
              return (
                <div key={s.year} className="season-row">
                  <span>{s.year}</span>
                  <span className={s.japanChampion ? 'champ' : ''}>{rankText(s)}</span>
                  <span>{g}</span>
                  <span>{s.wins}</span>
                  <span>{s.losses}</span>
                  <span>{s.draws}</span>
                  <span>{fmtPct(pct)}</span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div className="season-head stats">
              <span>年度</span><span>打率</span><span>OPS</span><span>本</span><span>盗</span><span>得</span><span>失</span><span>防</span><span>策</span>
            </div>
            {visible.map((s) => (
              <div key={s.year} className="season-row stats">
                <span>{s.year}</span>
                <span>{fmtPct(s.avg)}</span>
                <span>{s.ops.toFixed(3)}</span>
                <span>{s.hr}</span>
                <span>{s.sb}</span>
                <span>{s.runsScored}</span>
                <span>{s.runsAllowed}</span>
                <span>{s.era.toFixed(2)}</span>
                <span>{s.errors}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ================= 殿堂入り =================
function HallOfFame({
  hallOfFame,
  playerCareers,
}: {
  hallOfFame: HallOfFamer[];
  playerCareers?: Record<string, PlayerCareer>;
}) {
  const [selected, setSelected] = useState<HallOfFamer | null>(null);

  if (hallOfFame.length === 0) {
    return (
      <div className="home-panel">
        <p className="home-note">
          まだ殿堂入り選手はいません。基準（野手: 2000安打以上 / 投手: 200勝以上または250セーブ以上）を満たした選手が引退すると、ここに記録されます。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="hof-list">
        {hallOfFame.map((h, i) => (
          <button key={`${h.player.id}-${i}`} className="hof-item" onClick={() => setSelected(h)}>
            <span className="hof-pos">{h.player.position}</span>
            <span className="hof-name">{h.player.name}</span>
            <span className="hof-years">
              {h.joinYear}〜{h.leaveYear}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <PlayerDetailModal
          player={selected.player}
          career={{
            playerId: selected.player.id,
            seasons: selected.seasons?.length ? selected.seasons : (playerCareers?.[selected.player.id]?.seasons ?? []),
          }}
          titles={selected.titles}
          year={selected.leaveYear}
          hof={{ joinYear: selected.joinYear, leaveYear: selected.leaveYear }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
