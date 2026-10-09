import { useMemo } from 'react';
import type { PitcherAssignment, Player, Team, TeamOrder } from '../domain/types';
import type { InjuryEntry } from '../domain/gameState';
import { pitcherRoleLabel } from '../domain/orderLabels';
import { rankColor, rankFromValue, rankFromVelocity } from '../domain/rank';
import { useSlotDnD } from '../hooks/useSlotDnD';

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

/** 投手編成: 2列（左=一軍投手陣 / 右=二軍）ドラッグ&ドロップ（マウス/タッチ両対応）。制約なし1対1スワップ */
export function PitcherFormation({ team, order, onChange, injuries, onSelect }: Props) {
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

    // 役割はスロットに固定し、選手（playerId）だけを交換する
    const newStaff: PitcherAssignment[] = staff.map((s) => ({ ...s }));
    const farm = [...order.farmPitchers];
    const setId = (ref: SlotRef, id: string) => {
      if (ref.kind === 'STAFF') newStaff[ref.index] = { ...newStaff[ref.index], playerId: id };
      else farm[ref.index] = id;
    };
    setId(a, idB);
    setId(b, idA);
    onChange({ ...order, pitchers: newStaff, farmPitchers: farm });
  };

  const { draggingKey, overKey, bind } = useSlotDnD((src, dst) =>
    trySwap(parseKey(src), parseKey(dst)),
  );

  const renderRow = (ref: SlotRef, roleLabel: string) => {
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
        <span className="bf-pos">{roleLabel}</span>
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
                <div key={p.id} className="bf-row il">
                  <span className="bf-pos">P</span>
                  <span
          className="bf-name clickable"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(p);
          }}
        >
          {p.name}
        </span>
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
