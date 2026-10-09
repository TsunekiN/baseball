import { useMemo, useState } from 'react';
import type { Team } from '../domain/types';
import { calcTeamStrength } from '../domain/teamStrength';
import { rankFromValue } from '../domain/rank';
import { RankBadge } from './RankBadge';

interface Props {
  teams: Team[];
  onDecide: (teamId: string) => void;
  onRegenerate: () => void;
}

/** スタート画面: 操作する球団を1つ選んで確定する */
export function StartScreen({ teams, onDecide, onRegenerate }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);

  const central = teams.filter((t) => t.league === 'CENTRAL');
  const pacific = teams.filter((t) => t.league === 'PACIFIC');
  const picked = teams.find((t) => t.id === pickedId) ?? null;

  return (
    <div className="start-screen">
      <div className="start-columns">
        <LeagueColumn title="セ・リーグ" teams={central} pickedId={pickedId} onPick={setPickedId} />
        <LeagueColumn title="パ・リーグ" teams={pacific} pickedId={pickedId} onPick={setPickedId} />
      </div>

      <div className="start-actions-spacer" />

      <div className="start-footer">
        <button className="ghost-btn" onClick={onRegenerate}>
          🔄 再生成
        </button>
        <button
          className="primary-btn"
          disabled={!picked}
          onClick={() => picked && onDecide(picked.id)}
        >
          {picked ? `${picked.name} で開始` : '球団を選択'}
        </button>
      </div>
    </div>
  );
}

function LeagueColumn({
  title,
  teams,
  pickedId,
  onPick,
}: {
  title: string;
  teams: Team[];
  pickedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <section className="league-column">
      <h3 className="league-heading">{title}</h3>
      <div className="league-column-list">
        {teams.map((team) => (
          <SelectableCard
            key={team.id}
            team={team}
            selected={team.id === pickedId}
            onPick={() => onPick(team.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SelectableCard({
  team,
  selected,
  onPick,
}: {
  team: Team;
  selected: boolean;
  onPick: () => void;
}) {
  const s = useMemo(() => calcTeamStrength(team), [team]);
  return (
    <button className={`pick-card${selected ? ' picked' : ''}`} onClick={onPick}>
      <div className="pick-top">
        <span className="team-badge" style={{ background: team.colorPrimary }}>
          {team.markChar}
        </span>
        <span className="pick-name">{team.name}</span>
        <RankBadge rank={rankFromValue(s.total)} title={`総合 ${s.total.toFixed(1)}`} />
      </div>
      <div className="strength-row">
        <Cell label="打" value={s.batting} />
        <Cell label="走" value={s.running} />
        <Cell label="守" value={s.fielding} />
        <Cell label="投" value={s.pitching} />
        <Cell label="層" value={s.depth} />
      </div>
    </button>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="strength-cell">
      <span className="label">{label}</span>
      <RankBadge rank={rankFromValue(value)} title={value.toFixed(1)} />
    </div>
  );
}
