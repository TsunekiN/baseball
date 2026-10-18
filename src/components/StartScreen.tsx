import { useMemo, useState } from 'react';
import type { Team } from '../domain/types';
import { calcTeamStrength } from '../domain/teamStrength';
import { rankFromValue } from '../domain/rank';
import { RankBadge } from './RankBadge';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  teams: Team[];
  onDecide: (teamId: string) => void;
  onRegenerate: () => void;
  onCloudLoad?: () => Promise<{ success: boolean; message: string }>;
}

/** スタート画面: 操作する球団を1つ選んで確定する */
export function StartScreen({ teams, onDecide, onRegenerate, onCloudLoad }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [showCloudLoadConfirm, setShowCloudLoadConfirm] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudLoadNotice, setCloudLoadNotice] = useState<{ message: string; success: boolean } | null>(null);

  const central = teams.filter((t) => t.league === 'CENTRAL');
  const pacific = teams.filter((t) => t.league === 'PACIFIC');
  const picked = teams.find((t) => t.id === pickedId) ?? null;

  const handleCloudLoad = async () => {
    if (cloudLoading || !onCloudLoad) return;
    setCloudLoading(true);
    try {
      const res = await onCloudLoad();
      setCloudLoadNotice(res);
      setTimeout(() => setCloudLoadNotice(null), 3000);
    } finally {
      setCloudLoading(false);
    }
  };

  return (
    <div className="start-screen">
      <div className="start-columns">
        <LeagueColumn title="セ・リーグ" teams={central} pickedId={pickedId} onPick={setPickedId} />
        <LeagueColumn title="パ・リーグ" teams={pacific} pickedId={pickedId} onPick={setPickedId} />
      </div>

      <div className="start-actions-spacer" />

      <div className="start-footer">
        <button className="ghost-btn" onClick={onRegenerate} disabled={cloudLoading}>
          🔄 再生成
        </button>
        {onCloudLoad && (
          <button
            className="ghost-btn"
            onClick={() => setShowCloudLoadConfirm(true)}
            disabled={cloudLoading}
            style={
              cloudLoadNotice
                ? {
                    color: cloudLoadNotice.success ? '#2ed573' : '#ff4757',
                    borderColor: cloudLoadNotice.success ? '#2ed573' : '#ff4757',
                    fontWeight: 600,
                  }
                : undefined
            }
            title="クラウドに保存されているセーブデータを読み込みます"
          >
            {cloudLoading
              ? '🔄 読込中...'
              : cloudLoadNotice
                ? (cloudLoadNotice.success ? `✅ ${cloudLoadNotice.message}` : `⚠️ ${cloudLoadNotice.message}`)
                : '☁️ クラウド読込'}
          </button>
        )}
        <button
          className="primary-btn"
          disabled={!picked || cloudLoading}
          onClick={() => picked && onDecide(picked.id)}
        >
          {picked ? `${picked.name} で開始` : '球団を選択'}
        </button>
      </div>

      {showCloudLoadConfirm && (
        <ConfirmModal
          title="クラウドデータの読み込み"
          message={[
            'クラウドに保存されたデータを読み込みますか？',
            '※現在の選択・球団生成データはクラウドのデータで上書きされます。',
          ]}
          confirmLabel="読み込む"
          onConfirm={() => {
            setShowCloudLoadConfirm(false);
            handleCloudLoad();
          }}
          onCancel={() => setShowCloudLoadConfirm(false)}
        />
      )}
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
