import { useMemo } from 'react';
import type { Player, Team, TeamOrder } from '../domain/types';
import type { InjuryEntry } from '../domain/gameState';
import { canPlay } from '../domain/orderFactory';
import { fieldPositionLabel } from '../domain/orderLabels';
import { rankColor, rankFromValue } from '../domain/rank';
import { useSlotDnD } from '../hooks/useSlotDnD';

interface Props {
  team: Team;
  order: TeamOrder;
  onChange: (order: TeamOrder) => void;
  injuries: Record<string, InjuryEntry>;
  onSelect?: (player: Player) => void;
}

type SlotKind = 'STARTER' | 'BENCH' | 'FARM';
interface SlotRef {
  kind: SlotKind;
  index: number;
}

const keyOf = (ref: SlotRef) => `${ref.kind}:${ref.index}`;
const parseKey = (key: string): SlotRef => {
  const [kind, index] = key.split(':');
  return { kind: kind as SlotKind, index: Number(index) };
};

/** 野手編成: 2列（左=一軍[先発9+控え6] / 右=二軍）ドラッグ&ドロップ（マウス/タッチ両対応） */
export function BatterFormation({ team, order, onChange, injuries, onSelect }: Props) {
  const playerMap = useMemo(() => new Map(team.players.map((p) => [p.id, p])), [team]);
  const injuredBatters = useMemo(
    () => team.players.filter((p) => p.type === 'BATTER' && team.rosterLevel[p.id] === 'IL'),
    [team],
  );

  const getId = (ref: SlotRef): string | undefined => {
    if (ref.kind === 'STARTER') return order.lineup[ref.index]?.playerId;
    if (ref.kind === 'BENCH') return order.benchBatters[ref.index];
    return order.farmBatters[ref.index];
  };

  /** a と b を1対1スワップ */
  const trySwap = (a: SlotRef, b: SlotRef) => {
    if (a.kind === b.kind && a.index === b.index) return;
    const idA = getId(a);
    const idB = getId(b);
    if (!idA || !idB) return;

    // スタメン同士: 打順を入れ替える（守備位置ごとスロットを丸ごと交換。制約なし）
    if (a.kind === 'STARTER' && b.kind === 'STARTER') {
      const lineup = [...order.lineup];
      [lineup[a.index], lineup[b.index]] = [lineup[b.index], lineup[a.index]];
      onChange({ ...order, lineup });
      return;
    }

    // それ以外（控え/二軍が絡む）: 選手だけ交換。スタメン枠は守備適性を検証（DH枠は誰でも可）
    const pA = playerMap.get(idA);
    const pB = playerMap.get(idB);
    if (!pA || !pB) return;
    if (a.kind === 'STARTER' && !canPlay(pB, order.lineup[a.index].position)) return;
    if (b.kind === 'STARTER' && !canPlay(pA, order.lineup[b.index].position)) return;

    const lineup = [...order.lineup];
    const bench = [...order.benchBatters];
    const farm = [...order.farmBatters];
    const setId = (ref: SlotRef, id: string) => {
      if (ref.kind === 'STARTER') lineup[ref.index] = { ...lineup[ref.index], playerId: id };
      else if (ref.kind === 'BENCH') bench[ref.index] = id;
      else farm[ref.index] = id;
    };
    setId(a, idB);
    setId(b, idA);
    onChange({ ...order, lineup, benchBatters: bench, farmBatters: farm });
  };

  const { draggingKey, overKey, bind } = useSlotDnD((src, dst) =>
    trySwap(parseKey(src), parseKey(dst)),
  );

  const renderRow = (ref: SlotRef, posLabel: string) => {
    const id = getId(ref);
    const p = id ? playerMap.get(id) : undefined;
    if (!p) return null;
    const k = keyOf(ref);
    return (
      <div
        key={k}
        className={`bf-row${overKey === k ? ' over' : ''}${draggingKey === k ? ' dragging' : ''}`}
        {...bind(k)}
      >
        <span className="bf-pos">{posLabel}</span>
        <span
          className="bf-name clickable"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(p);
          }}
        >
          {p.name}
        </span>
        <span className="bf-ranks">
          <Rk v={p.contact} />
          <Rk v={p.power} />
          <Rk v={p.speed} />
          <Rk v={p.defense} />
        </span>
      </div>
    );
  };

  return (
    <div className="bf-wrap">
      {/* 左: 一軍 */}
      <div className="bf-col">
        <div className="bf-col-title">一軍</div>
        <div className="bf-sub">スタメン</div>
        {order.lineup.map((slot, i) =>
          renderRow({ kind: 'STARTER', index: i }, `${i + 1} ${fieldPositionLabel(slot.position)}`),
        )}
        <div className="bf-sub">控え</div>
        {order.benchBatters.map((_, i) => {
          const id = order.benchBatters[i];
          const p = playerMap.get(id);
          return renderRow({ kind: 'BENCH', index: i }, p?.position ?? '');
        })}
      </div>

      {/* 右: 二軍 */}
      <div className="bf-col">
        <div className="bf-col-title">二軍</div>
        {order.farmBatters.map((_, i) => {
          const id = order.farmBatters[i];
          const p = playerMap.get(id);
          return renderRow({ kind: 'FARM', index: i }, p?.position ?? '');
        })}

        {/* 故障者リスト（移動不可） */}
        {injuredBatters.length > 0 && (
          <>
            <div className="bf-sub il">故障者リスト</div>
            {injuredBatters.map((p) => {
              const inj = injuries[p.id];
              return (
                <div key={p.id} className="bf-row il">
                  <span className="bf-pos">{p.position}</span>
                  <span
          className="bf-name clickable"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(p);
          }}
        >
          {p.name}
        </span>
                  <span className="bf-il-note">
                    {inj ? `全治${inj.gamesLeft}試合` : '離脱中'}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/** 能力ランク文字（色付き、数値なし） */
function Rk({ v }: { v: number }) {
  const rank = rankFromValue(v);
  const c = rankColor(rank);
  return (
    <span className="bf-rk" style={{ color: c.border }} title={String(v)}>
      {rank}
    </span>
  );
}
