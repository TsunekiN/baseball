import { useMemo, useRef, useState } from 'react';
import type { Player, Team, TeamOrder } from '../domain/types';
import type { InjuryEntry } from '../domain/gameState';
import { canPlay, cleanTeamOrder } from '../domain/orderFactory';
import { fieldPositionLabel } from '../domain/orderLabels';
import { rankColor, rankFromValue } from '../domain/rank';

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

/** 野手編成: ドラッグ＆ドロップおよびタップ選択で打順・ロースターを自由に入れ替え可能 */
export function BatterFormation({ team, order, onChange, injuries, onSelect }: Props) {
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const dragSrcKeyRef = useRef<string | null>(null);

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

    // スタメン同士: 打順（スロット）ごと丸ごと交換（何番同士でも制限なく自由に変更可能）
    if (a.kind === 'STARTER' && b.kind === 'STARTER') {
      const lineup = [...order.lineup];
      [lineup[a.index], lineup[b.index]] = [lineup[b.index], lineup[a.index]];
      onChange(cleanTeamOrder({ ...order, lineup }, team));
      setSelected(null);
      return;
    }

    const pA = playerMap.get(idA);
    const pB = playerMap.get(idB);
    if (!pA || !pB) return;

    // スタメンと控え/二軍の入れ替え: 同じ守備位置同士のみ許可（DH枠はポジション問わず可）
    if (a.kind === 'STARTER' && b.kind !== 'STARTER') {
      if (!canPlay(pB, order.lineup[a.index].position)) return;
    }
    if (b.kind === 'STARTER' && a.kind !== 'STARTER') {
      if (!canPlay(pA, order.lineup[b.index].position)) return;
    }

    // 選手をスワップ
    const lineup = [...order.lineup];
    const bench = [...order.benchBatters];
    const farm = [...order.farmBatters];

    const setId = (ref: SlotRef, id: string) => {
      if (ref.kind === 'STARTER') {
        lineup[ref.index] = { ...lineup[ref.index], playerId: id };
      } else if (ref.kind === 'BENCH') {
        bench[ref.index] = id;
      } else {
        farm[ref.index] = id;
      }
    };

    setId(a, idB);
    setId(b, idA);

    onChange(cleanTeamOrder({ ...order, lineup, benchBatters: bench, farmBatters: farm }, team));
    setSelected(null);
  };

  const handleSlotClick = (ref: SlotRef, p: Player) => {
    onSelect?.(p);

    if (!selected) {
      setSelected(ref);
      return;
    }

    if (selected.kind === ref.kind && selected.index === ref.index) {
      setSelected(null);
      return;
    }

    trySwap(selected, ref);
    setSelected(null);
  };

  // 同一選手が画面上に2箇所表示されるのを防ぐガードSet
  const seenPlayerIds = new Set<string>();

  const renderRow = (ref: SlotRef, posLabel: string) => {
    const id = getId(ref);
    const p = id ? playerMap.get(id) : undefined;
    if (!p) return null;
    if (seenPlayerIds.has(p.id)) return null;
    seenPlayerIds.add(p.id);

    const k = keyOf(ref);
    const isSelected = selected ? keyOf(selected) === k : false;

    return (
      <div
        key={k}
        className={`bf-row${isSelected ? ' selected' : ''}`}
        onClick={() => handleSlotClick(ref, p)}
        draggable
        onDragStart={(e) => {
          dragSrcKeyRef.current = k;
          try {
            e.dataTransfer.setData('text/plain', k);
            e.dataTransfer.effectAllowed = 'move';
          } catch {
            // fallback
          }
          e.currentTarget.classList.add('dragging');
        }}
        onDragEnd={(e) => {
          dragSrcKeyRef.current = null;
          e.currentTarget.classList.remove('dragging');
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragSrcKeyRef.current && dragSrcKeyRef.current !== k) {
            e.currentTarget.classList.add('over');
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.remove('over');
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.remove('over');
          const srcKey = dragSrcKeyRef.current || e.dataTransfer.getData('text/plain');
          dragSrcKeyRef.current = null;
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
          if (srcKey && srcKey !== k) {
            trySwap(parseKey(srcKey), ref);
          }
        }}
      >
        <span className="bf-pos">{posLabel}</span>
        <span className="bf-name">{p.name}</span>
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
                <div key={p.id} className="bf-row il" onClick={() => onSelect?.(p)}>
                  <span className="bf-pos">{p.position}</span>
                  <span className="bf-name">{p.name}</span>
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
