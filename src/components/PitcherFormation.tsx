import { useMemo, useRef, useState } from 'react';
import type { PitcherAssignment, Player, Team, TeamOrder } from '../domain/types';
import type { InjuryEntry } from '../domain/gameState';
import { rankColor, rankFromValue, rankFromVelocity } from '../domain/rank';
import { cleanTeamOrder } from '../domain/orderFactory';

interface Props {
  team: Team;
  order: TeamOrder;
  onChange: (order: TeamOrder) => void;
  injuries: Record<string, InjuryEntry>;
  onSelect?: (player: Player) => void;
}

interface SlotDef {
  role: 'STARTER' | 'CLOSER' | 'SETUP' | 'MIDDLE';
  label: string;
  rotationOrder?: number;
}

// 一軍規定の14スロット（先発6, セット1, 抑え1, 中継ぎ6）
const FIRST_TEAM_SLOTS: SlotDef[] = [
  { role: 'STARTER', label: '先発1', rotationOrder: 1 },
  { role: 'STARTER', label: '先発2', rotationOrder: 2 },
  { role: 'STARTER', label: '先発3', rotationOrder: 3 },
  { role: 'STARTER', label: '先発4', rotationOrder: 4 },
  { role: 'STARTER', label: '先発5', rotationOrder: 5 },
  { role: 'STARTER', label: '先発6', rotationOrder: 6 },
  { role: 'SETUP', label: 'セット' },
  { role: 'CLOSER', label: '抑え' },
  { role: 'MIDDLE', label: '中1' },
  { role: 'MIDDLE', label: '中2' },
  { role: 'MIDDLE', label: '中3' },
  { role: 'MIDDLE', label: '中4' },
  { role: 'MIDDLE', label: '中5' },
  { role: 'MIDDLE', label: '中6' },
];

type SlotKind = 'STAFF' | 'FARM';
interface SlotRef {
  kind: SlotKind;
  index: number;
}

const keyOf = (ref: SlotRef) => `${ref.kind}:${ref.index}`;
const parseKey = (key: string): SlotRef => {
  const [kind, index] = key.split(':');
  return { kind: kind as SlotKind, index: Number(index) };
};

/** 投手編成: 14枠の役割スロット制で、二軍との入れ替え・空き枠補充を安全に実現 */
export function PitcherFormation({ team, order, onChange, injuries, onSelect }: Props) {
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const dragSrcKeyRef = useRef<string | null>(null);

  const playerMap = useMemo(() => new Map(team.players.map((p) => [p.id, p])), [team]);
  const injuredPitchers = useMemo(
    () => team.players.filter((p) => p.type === 'PITCHER' && team.rosterLevel[p.id] === 'IL'),
    [team],
  );

  // 14枠の一軍スロットへ、order.pitchers を過不足なくマッピング
  const staffSlots = useMemo(() => {
    const slots: (string | undefined)[] = new Array(FIRST_TEAM_SLOTS.length).fill(undefined);
    const assignedPitchers = [...order.pitchers].filter((p) => playerMap.has(p.playerId));

    // 1) 先発 (STARTER) の割り当て
    const starters = assignedPitchers
      .filter((p) => p.role === 'STARTER')
      .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0));
    starters.slice(0, 6).forEach((p, idx) => {
      slots[idx] = p.playerId;
    });

    // 2) セットアッパー (SETUP)
    const setup = assignedPitchers.find((p) => p.role === 'SETUP');
    if (setup) slots[6] = setup.playerId;

    // 3) 抑え (CLOSER)
    const closer = assignedPitchers.find((p) => p.role === 'CLOSER');
    if (closer) slots[7] = closer.playerId;

    // 4) 中継ぎ (MIDDLE)
    const middles = assignedPitchers.filter((p) => p.role === 'MIDDLE');
    middles.slice(0, 6).forEach((p, idx) => {
      slots[8 + idx] = p.playerId;
    });

    // 5) もし枠外の選手がいれば空きスロットへ埋める
    const alreadyAssigned = new Set(slots.filter(Boolean) as string[]);
    const unassigned = assignedPitchers.filter((p) => !alreadyAssigned.has(p.playerId));
    for (const p of unassigned) {
      const emptyIdx = slots.indexOf(undefined);
      if (emptyIdx >= 0) {
        slots[emptyIdx] = p.playerId;
      }
    }

    return slots;
  }, [order.pitchers, playerMap]);

  // 一軍に使われている投手IDのセット
  const usedInStaff = useMemo(() => new Set(staffSlots.filter(Boolean) as string[]), [staffSlots]);

  // 二軍投手リスト: 一軍に使われている選手を重複なく除外し、在籍投手で漏れを補完
  const farmPitcherIds = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const id of order.farmPitchers || []) {
      if (id && playerMap.has(id) && !usedInStaff.has(id) && !seen.has(id)) {
        seen.add(id);
        list.push(id);
      }
    }
    // 未登録の在籍投手（IL以外）を末尾に追加
    for (const p of team.players) {
      if (p.type === 'PITCHER' && team.rosterLevel[p.id] !== 'IL' && !usedInStaff.has(p.id) && !seen.has(p.id)) {
        seen.add(p.id);
        list.push(p.id);
      }
    }
    return list;
  }, [order.farmPitchers, playerMap, usedInStaff, team]);

  const getId = (ref: SlotRef): string | undefined => {
    return ref.kind === 'STAFF' ? staffSlots[ref.index] : farmPitcherIds[ref.index];
  };

  /** スロット同士、または一軍と二軍の入れ替え・補充を実行 */
  const trySwap = (a: SlotRef, b: SlotRef) => {
    if (a.kind === b.kind && a.index === b.index) return;
    const idA = getId(a);
    const idB = getId(b);
    // 両方空枠なら何もしない
    if (!idA && !idB) return;

    const nextStaffSlots = [...staffSlots];
    const nextFarm = [...farmPitcherIds];

    if (a.kind === 'STAFF' && b.kind === 'STAFF') {
      // 一軍スロット同士の交換（空き枠への移動も含む）
      nextStaffSlots[a.index] = idB;
      nextStaffSlots[b.index] = idA;
    } else if (a.kind === 'FARM' && b.kind === 'FARM') {
      // 二軍同士の並び順交換
      if (idA && idB) {
        nextFarm[a.index] = idB;
        nextFarm[b.index] = idA;
      }
    } else {
      // 一軍と二軍の入れ替え（昇格・降格・空き枠補充）
      const staffRef = a.kind === 'STAFF' ? a : b;
      const farmRef = a.kind === 'FARM' ? a : b;
      const staffId = staffSlots[staffRef.index];
      const farmId = farmPitcherIds[farmRef.index];

      if (staffId && farmId) {
        // 通常の1対1交換
        nextStaffSlots[staffRef.index] = farmId;
        nextFarm[farmRef.index] = staffId;
      } else if (!staffId && farmId) {
        // 空き枠への二軍からの昇格
        nextStaffSlots[staffRef.index] = farmId;
        nextFarm.splice(farmRef.index, 1);
      } else if (staffId && !farmId) {
        // 一軍から二軍への降格（空き枠化）
        nextStaffSlots[staffRef.index] = undefined;
        nextFarm.push(staffId);
      }
    }

    // 14スロットから TeamOrder['pitchers'] 配列を構築
    const nextPitchers: PitcherAssignment[] = [];
    nextStaffSlots.forEach((pid, idx) => {
      if (!pid) return;
      const slotDef = FIRST_TEAM_SLOTS[idx];
      const entry: PitcherAssignment = { playerId: pid, role: slotDef.role };
      if (slotDef.rotationOrder) {
        entry.rotationOrder = slotDef.rotationOrder;
      }
      nextPitchers.push(entry);
    });

    onChange(cleanTeamOrder({ ...order, pitchers: nextPitchers, farmPitchers: nextFarm }, team));
    setSelected(null);
  };

  const handleSlotClick = (ref: SlotRef, p?: Player) => {
    if (p) onSelect?.(p);

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

  const renderStaffRow = (index: number) => {
    const slotDef = FIRST_TEAM_SLOTS[index];
    const id = staffSlots[index];
    const p = id ? playerMap.get(id) : undefined;
    const ref: SlotRef = { kind: 'STAFF', index };
    const k = keyOf(ref);
    const isSelected = selected ? keyOf(selected) === k : false;

    if (!p) {
      // 空き枠スロット
      return (
        <div
          key={k}
          className={`bf-row empty${isSelected ? ' selected' : ''}`}
          onClick={() => handleSlotClick(ref)}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => {
            e.preventDefault();
            const srcKey = dragSrcKeyRef.current || e.dataTransfer.getData('text/plain');
            dragSrcKeyRef.current = null;
            document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
            if (srcKey && srcKey !== k) trySwap(parseKey(srcKey), ref);
          }}
        >
          <span className="bf-pos">{slotDef.label}</span>
          <span className="bf-name empty-slot">（空き枠・タップで補充）</span>
          <span className="bf-ranks"></span>
        </div>
      );
    }

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
          } catch {}
          e.currentTarget.classList.add('dragging');
        }}
        onDragEnd={(e) => {
          dragSrcKeyRef.current = null;
          e.currentTarget.classList.remove('dragging');
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (dragSrcKeyRef.current && dragSrcKeyRef.current !== k) e.currentTarget.classList.add('over');
        }}
        onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('over');
          const srcKey = dragSrcKeyRef.current || e.dataTransfer.getData('text/plain');
          dragSrcKeyRef.current = null;
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
          if (srcKey && srcKey !== k) trySwap(parseKey(srcKey), ref);
        }}
      >
        <span className="bf-pos">{slotDef.label}</span>
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

  const renderFarmRow = (index: number) => {
    const id = farmPitcherIds[index];
    const p = id ? playerMap.get(id) : undefined;
    if (!p) return null;

    const ref: SlotRef = { kind: 'FARM', index };
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
          } catch {}
          e.currentTarget.classList.add('dragging');
        }}
        onDragEnd={(e) => {
          dragSrcKeyRef.current = null;
          e.currentTarget.classList.remove('dragging');
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (dragSrcKeyRef.current && dragSrcKeyRef.current !== k) e.currentTarget.classList.add('over');
        }}
        onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('over');
          const srcKey = dragSrcKeyRef.current || e.dataTransfer.getData('text/plain');
          dragSrcKeyRef.current = null;
          document.querySelectorAll('.bf-row').forEach((el) => el.classList.remove('over', 'dragging'));
          if (srcKey && srcKey !== k) trySwap(parseKey(srcKey), ref);
        }}
      >
        <span className="bf-pos">P</span>
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

  return (
    <div className="bf-wrap">
      {/* 左: 一軍 (14枠) */}
      <div className="bf-col">
        <div className="bf-col-title">一軍</div>

        <div className="bf-sub">先発 (6枠)</div>
        {[0, 1, 2, 3, 4, 5].map((idx) => renderStaffRow(idx))}

        <div className="bf-sub">勝ちパ (2枠)</div>
        {[6, 7].map((idx) => renderStaffRow(idx))}

        <div className="bf-sub">
          中継ぎ (6枠)<span className="bf-note">上=僅差 / 下=敗戦処理</span>
        </div>
        {[8, 9, 10, 11, 12, 13].map((idx) => renderStaffRow(idx))}
      </div>

      {/* 右: 二軍 */}
      <div className="bf-col">
        <div className="bf-col-title">二軍 ({farmPitcherIds.length})</div>
        {farmPitcherIds.map((_, i) => renderFarmRow(i))}

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
