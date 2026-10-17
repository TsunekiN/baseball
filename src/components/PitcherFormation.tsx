import { useMemo, useRef, useState } from 'react';
import type { PitcherAssignment, Player, Team, TeamOrder } from '../domain/types';
import type { InjuryEntry } from '../domain/gameState';
import { pitcherRoleLabel } from '../domain/orderLabels';
import { rankColor, rankFromValue, rankFromVelocity } from '../domain/rank';
import { cleanTeamOrder } from '../domain/orderFactory';

interface Props {
  team: Team;
  order: TeamOrder;
  onChange: (order: TeamOrder) => void;
  injuries: Record<string, InjuryEntry>;
  onSelect?: (player: Player) => void;
}

type SlotKind = 'STAFF' | 'FARM';
interface SlotRef {
  kind: SlotKind;
  index: number;
}

const ROLE_SORT: Record<string, number> = { STARTER: 0, SETUP: 1, CLOSER: 2, MIDDLE: 3 };

const keyOf = (ref: SlotRef) => `${ref.kind}:${ref.index}`;
const parseKey = (key: string): SlotRef => {
  const [kind, index] = key.split(':');
  return { kind: kind as SlotKind, index: Number(index) };
};

/** 投手編成: ドラッグ＆ドロップおよびタップ選択で任意の選手同士を自由に入れ替え可能 */
export function PitcherFormation({ team, order, onChange, injuries, onSelect }: Props) {
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const dragSrcKeyRef = useRef<string | null>(null);

  const playerMap = useMemo(() => new Map(team.players.map((p) => [p.id, p])), [team]);
  const injuredPitchers = useMemo(
    () => team.players.filter((p) => p.type === 'PITCHER' && team.rosterLevel[p.id] === 'IL'),
    [team],
  );

  // 一軍投手を役割順（先発→セットアッパー→抑え→中継ぎ）に並べた表示スロット
  const staff = useMemo(() => {
    return [...order.pitchers].sort((a, b) => {
      const r = (ROLE_SORT[a.role] ?? 9) - (ROLE_SORT[b.role] ?? 9);
      if (r !== 0) return r;
      return (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0);
    });
  }, [order.pitchers]);

  const getId = (ref: SlotRef): string | undefined =>
    ref.kind === 'STAFF' ? staff[ref.index]?.playerId : order.farmPitchers[ref.index];

  const trySwap = (a: SlotRef, b: SlotRef) => {
    if (a.kind === b.kind && a.index === b.index) return;
    const idA = getId(a);
    const idB = getId(b);
    if (!idA || !idB) return;

    // 役割はスロットに固定し、選手（playerId）だけを交換する（任意の投手同士で制限なし）
    const newStaff: PitcherAssignment[] = staff.map((s) => ({ ...s }));
    const farm = [...order.farmPitchers];

    const setId = (ref: SlotRef, id: string) => {
      if (ref.kind === 'STAFF') {
        newStaff[ref.index] = { ...newStaff[ref.index], playerId: id };
      } else {
        farm[ref.index] = id;
      }
    };

    setId(a, idB);
    setId(b, idA);

    onChange(cleanTeamOrder({ ...order, pitchers: newStaff, farmPitchers: farm }, team));
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

  // 同一投手が画面上に2箇所表示されるのを防ぐガードSet
  const seenPitcherIds = new Set<string>();

  const renderRow = (ref: SlotRef, roleLabel: string) => {
    const id = getId(ref);
    const p = id ? playerMap.get(id) : undefined;
    if (!p) return null;
    if (seenPitcherIds.has(p.id)) return null;
    seenPitcherIds.add(p.id);

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
        <span className="bf-pos">{roleLabel}</span>
        <span className="bf-name">{p.name}</span>
        <span className="bf-ranks">
          <Rk v={p.velocity} isVelocity />
          <Rk v={p.control} />
          <Rk v={p.breaking} />
          <Rk v={p.stamina} />
        </span>
      </div>
    );
  };

  // staff配列上のindexを保持しつつ役割グループに分ける
  const withIdx = staff.map((a, i) => ({ a, i }));
  const starters = withIdx.filter((x) => x.a.role === 'STARTER');
  const winning = withIdx.filter((x) => x.a.role === 'SETUP' || x.a.role === 'CLOSER'); // 勝ちパ
  const middle = withIdx.filter((x) => x.a.role === 'MIDDLE');

  return (
    <div className="bf-wrap">
      <div className="bf-col">
        <div className="bf-col-title">一軍</div>

        <div className="bf-sub">先発</div>
        {starters.map((x, n) => renderRow({ kind: 'STAFF', index: x.i }, `先発${n + 1}`))}

        <div className="bf-sub">勝ちパ</div>
        {winning.map((x) => renderRow({ kind: 'STAFF', index: x.i }, pitcherRoleLabel(x.a.role)))}

        <div className="bf-sub">
          中継ぎ<span className="bf-note">上=僅差 / 下=敗戦処理</span>
        </div>
        {middle.map((x, n) => renderRow({ kind: 'STAFF', index: x.i }, `中${n + 1}`))}
      </div>

      <div className="bf-col">
        <div className="bf-col-title">二軍</div>
        {order.farmPitchers.map((_, i) => renderRow({ kind: 'FARM', index: i }, 'P'))}

        {/* 故障者リスト（移動不可） */}
        {injuredPitchers.length > 0 && (
          <>
            <div className="bf-sub il">故障者リスト</div>
            {injuredPitchers.map((p) => {
              const inj = injuries[p.id];
              return (
                <div key={p.id} className="bf-row il" onClick={() => onSelect?.(p)}>
                  <span className="bf-pos">P</span>
                  <span className="bf-name">{p.name}</span>
                  <span className="bf-il-note">{inj ? `全治${inj.gamesLeft}試合` : '離脱中'}</span>
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
function Rk({ v, isVelocity }: { v: number; isVelocity?: boolean }) {
  const rank = isVelocity ? rankFromVelocity(v) : rankFromValue(v);
  const c = rankColor(rank);
  return (
    <span className="bf-rk" style={{ color: c.border }} title={String(v)}>
      {rank}
    </span>
  );
}
