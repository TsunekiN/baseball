import { useEffect, useState } from 'react';
import type { Player, Team, TeamOrder } from '../domain/types';
import type { AbilitySnapshot, PlayerCareer, InjuryEntry } from '../domain/gameState';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { TitleCounts } from '../domain/stats';
import { buildBestOrder, cleanTeamOrder } from '../domain/orderFactory';
import { PlayerTable } from './PlayerTable';
import { PlayerStatsTable } from './PlayerStatsTable';
import { PlayerDetailModal } from './PlayerDetailModal';
import { BatterFormation } from './BatterFormation';
import { PitcherFormation } from './PitcherFormation';

interface Props {
  team: Team;
  order: TeamOrder;
  onChangeOrder: (order: TeamOrder) => void;
  playerStats: Record<string, PlayerSeasonStats>;
  /** 当年ポストシーズン成績（詳細モーダルのPSタブ用。レギュラーとは独立） */
  postseasonStats: Record<string, PlayerSeasonStats>;
  playerCareers: Record<string, PlayerCareer>;
  playerTitles: Record<string, TitleCounts>;
  year: number;
  injuries: Record<string, InjuryEntry>;
  /** 今シーズン開幕時点の能力スナップショット（詳細モーダルの成長値表示用） */
  seasonStartAbilities: Record<string, AbilitySnapshot>;
  onRelease?: (playerId: string) => void;
  /**
   * オーダー/編成モードで選手がタップされたら、その選手をヘッダー表示用に親へ通知する。
   * モードを離れる・選手未選択のときは null。
   */
  onHeroPlayer?: (player: Player | null) => void;
}

type Group = 'BATTER' | 'PITCHER';
type Mode = 'LIST' | 'STATS' | 'ORDER';

/** 選手タブ本体: 野手/投手 × 一覧/編成 の2段構成 */
export function PlayersScreen({
  team,
  order,
  onChangeOrder,
  playerStats,
  postseasonStats,
  playerCareers,
  playerTitles,
  year,
  injuries,
  seasonStartAbilities,
  onRelease,
  onHeroPlayer,
}: Props) {
  const [group, setGroup] = useState<Group>('BATTER');
  const [mode, setMode] = useState<Mode>('LIST');
  // LIST/STATS モードでの選択（詳細モーダル表示用）
  const [selected, setSelected] = useState<Player | null>(null);
  // ORDER（オーダー/編成）モードでの選択（ヘッダー差し替え用。モーダルは出さない）
  const [heroPlayer, setHeroPlayer] = useState<Player | null>(null);

  const isOrderMode = mode === 'ORDER';

  // ORDER モードの選択選手を親へ通知。モードを離れたら解除。
  useEffect(() => {
    onHeroPlayer?.(isOrderMode ? heroPlayer : null);
  }, [isOrderMode, heroPlayer, onHeroPlayer]);

  // タブ/モードが変わったら選択はクリア（ヘッダー差し替え・モーダルとも）
  useEffect(() => {
    setHeroPlayer(null);
    setSelected(null);
  }, [mode, group]);

  const [autoNotice, setAutoNotice] = useState<string | null>(null);

  // 自動編成: 野手側は打順・控え・二軍の並びをまとめてベストに修復・編成
  const autoBuildLineup = () => {
    const best = buildBestOrder(team);
    const repaired = cleanTeamOrder(
      {
        ...order,
        lineup: best.lineup,
        benchBatters: best.benchBatters,
        farmBatters: best.farmBatters,
      },
      team,
    );
    onChangeOrder(repaired);
    setAutoNotice('野手をベストオーダーに自動編成・修復しました');
    setTimeout(() => setAutoNotice(null), 2000);
  };
  // 自動編成: 投手側は起用・二軍の並びをまとめてベストに修復・編成
  const autoBuildPitchers = () => {
    const best = buildBestOrder(team);
    const repaired = cleanTeamOrder(
      {
        ...order,
        pitchers: best.pitchers,
        farmPitchers: best.farmPitchers,
      },
      team,
    );
    onChangeOrder(repaired);
    setAutoNotice('投手をベスト布陣に自動編成・修復しました');
    setTimeout(() => setAutoNotice(null), 2000);
  };

  return (
    <div>
      {/* 大タブ: 野手 / 投手 */}
      <div className="roster-tabs">
        <button className={`roster-tab${group === 'BATTER' ? ' active' : ''}`} onClick={() => setGroup('BATTER')}>
          野手
        </button>
        <button className={`roster-tab${group === 'PITCHER' ? ' active' : ''}`} onClick={() => setGroup('PITCHER')}>
          投手
        </button>
      </div>

      {/* 小タブ: 一覧 / 成績 / 編成 */}
      <div className="segmented">
        <button className={`seg${mode === 'LIST' ? ' active' : ''}`} onClick={() => setMode('LIST')}>
          一覧
        </button>
        <button className={`seg${mode === 'STATS' ? ' active' : ''}`} onClick={() => setMode('STATS')}>
          成績
        </button>
        <button className={`seg${mode === 'ORDER' ? ' active' : ''}`} onClick={() => setMode('ORDER')}>
          {group === 'BATTER' ? 'オーダー' : '編成'}
        </button>
      </div>

      {/* 中身 */}
      {group === 'BATTER' && mode === 'LIST' && (
        <RosterList team={team} order={order} type="BATTER" onSelect={setSelected} />
      )}
      {group === 'BATTER' && mode === 'STATS' && (
        <StatsBlock team={team} order={order} type="BATTER" onSelect={setSelected} playerStats={playerStats} />
      )}
      {group === 'BATTER' && mode === 'ORDER' && (
        <>
          <BatterFormation team={team} order={order} onChange={onChangeOrder} injuries={injuries} onSelect={setHeroPlayer} />
          <div className="formation-actions">
            {autoNotice && <span className="formation-notice">{autoNotice}</span>}
            <button className="ghost-btn auto-btn2" onClick={autoBuildLineup}>
              自動編成
            </button>
          </div>
        </>
      )}
      {group === 'PITCHER' && mode === 'LIST' && (
        <RosterList team={team} order={order} type="PITCHER" onSelect={setSelected} />
      )}
      {group === 'PITCHER' && mode === 'STATS' && (
        <StatsBlock team={team} order={order} type="PITCHER" onSelect={setSelected} playerStats={playerStats} />
      )}
      {group === 'PITCHER' && mode === 'ORDER' && (
        <>
          <PitcherFormation team={team} order={order} onChange={onChangeOrder} injuries={injuries} onSelect={setHeroPlayer} />
          <div className="formation-actions">
            {autoNotice && <span className="formation-notice">{autoNotice}</span>}
            <button className="ghost-btn auto-btn2" onClick={autoBuildPitchers}>
              自動編成
            </button>
          </div>
        </>
      )}

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
          onRelease={onRelease}
        />
      )}
    </div>
  );
}

const ROLE_SORT: Record<string, number> = { STARTER: 0, SETUP: 1, CLOSER: 2, MIDDLE: 3 };

/**
 * 一軍/二軍の選手を「オーダー（野手）/編成（投手）の並び順」で返す。
 * 一軍 = 野手:打順→控え / 投手:役割順。二軍 = farm の並び順。
 * オーダーに無い該当選手は末尾に補完する。
 */
function orderedByOrder(team: Team, order: TeamOrder, type: Player['type']): { first: Player[]; farm: Player[] } {
  const pmap = new Map(team.players.map((p) => [p.id, p]));
  const level = (id: string) => team.rosterLevel[id];

  // 一軍の並び順（playerId）
  let firstIds: string[];
  let farmIds: string[];
  if (type === 'BATTER') {
    firstIds = [...order.lineup.map((s) => s.playerId), ...order.benchBatters];
    farmIds = [...order.farmBatters];
  } else {
    firstIds = [...order.pitchers]
      .sort((a, b) => (ROLE_SORT[a.role] ?? 9) - (ROLE_SORT[b.role] ?? 9) || (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0))
      .map((a) => a.playerId);
    farmIds = [...order.farmPitchers];
  }

  const pick = (ids: string[], wantLevel: 'FIRST' | 'FARM'): Player[] => {
    const seen = new Set<string>();
    const list: Player[] = [];
    for (const id of ids) {
      const p = pmap.get(id);
      if (p && p.type === type && level(id) === wantLevel && !seen.has(id)) {
        seen.add(id);
        list.push(p);
      }
    }
    // オーダーに無い該当選手を末尾へ
    for (const p of team.players) {
      if (p.type === type && level(p.id) === wantLevel && !seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    return list;
  };

  return { first: pick(firstIds, 'FIRST'), farm: pick(farmIds, 'FARM') };
}

/** 一軍・二軍に分けた選手一覧（表形式。オーダー/編成の並び順） */
function RosterList({
  team,
  order,
  type,
  onSelect,
}: {
  team: Team;
  order: TeamOrder;
  type: Player['type'];
  onSelect: (p: Player) => void;
}) {
  const { first, farm } = orderedByOrder(team, order, type);

  return (
    <>
      {first.length > 0 && (
        <>
          <div className="roster-group-title">一軍 ({first.length})</div>
          <PlayerTable players={first} type={type} onSelect={onSelect} />
        </>
      )}
      {farm.length > 0 && (
        <>
          <div className="roster-group-title">二軍 ({farm.length})</div>
          <PlayerTable players={farm} type={type} onSelect={onSelect} />
        </>
      )}
    </>
  );
}

/** 今年度の成績（該当種別の全選手をソート可能な表で。デフォルトはオーダー/編成順） */
function StatsBlock({
  team,
  order,
  type,
  onSelect,
  playerStats,
}: {
  team: Team;
  order: TeamOrder;
  type: Player['type'];
  onSelect: (p: Player) => void;
  playerStats: Record<string, PlayerSeasonStats>;
}) {
  const { first, farm } = orderedByOrder(team, order, type);
  const players = [...first, ...farm];
  return (
    <>
      <PlayerStatsTable players={players} type={type} onSelect={onSelect} playerStats={playerStats} />
    </>
  );
}
