import { useMemo, useState } from 'react';
import type { Player } from '../domain/types';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';

interface Props {
  players: Player[];
  type: Player['type'];
  onSelect?: (player: Player) => void;
}

/** 守備位置の表示・ソート順 */
const POS_ORDER: Record<string, number> = {
  C: 0, '1B': 1, '2B': 2, '3B': 3, SS: 4, OF: 5, P: 9,
};

/** ソート対象の列定義 */
interface ColumnDef {
  key: string;
  label: string;
  /** 数値を取り出す（数値列のみ）。文字列列は string で比較 */
  numValue?: (p: Player) => number;
  strValue?: (p: Player) => string;
  isVelocity?: boolean;
  /** 能力セル（数値+ランク表示）か */
  isStat?: boolean;
  /** この列を初めて選んだときの並び方向 */
  defaultDir?: SortDir;
}

type SortDir = 'asc' | 'desc';

/** 能力セル: 「90A」。ランク文字だけ色付け */
function StatCell({ value, isVelocity }: { value: number; isVelocity?: boolean }) {
  const rank = isVelocity ? rankFromVelocity(value) : rankFromValue(value);
  const c = rankColor(rank);
  return (
    <span className="stat-cell">
      {displayAbility(value)}
      <span className="stat-rank" style={{ color: c.border }}>
        {rank}
      </span>
    </span>
  );
}

/** 選手一覧（表形式・各列ソート可能） */
export function PlayerTable({ players, type, onSelect }: Props) {
  const isPitcher = type === 'PITCHER';

  const columns: ColumnDef[] = isPitcher
    ? [
        { key: 'name', label: '名前', strValue: (p) => p.name },
        { key: 'age', label: '年齢', numValue: (p) => p.age },
        { key: 'pos', label: 'POS', numValue: (p) => POS_ORDER[p.position] ?? 99, defaultDir: 'asc' },
        { key: 'velocity', label: '球速', numValue: (p) => p.velocity, isVelocity: true, isStat: true },
        { key: 'control', label: '制球', numValue: (p) => p.control, isStat: true },
        { key: 'breaking', label: '変化', numValue: (p) => p.breaking, isStat: true },
        { key: 'stamina', label: 'スタミナ', numValue: (p) => p.stamina, isStat: true },
      ]
    : [
        { key: 'name', label: '名前', strValue: (p) => p.name },
        { key: 'age', label: '年齢', numValue: (p) => p.age },
        { key: 'pos', label: 'POS', numValue: (p) => POS_ORDER[p.position] ?? 99, defaultDir: 'asc' },
        { key: 'contact', label: 'ミート', numValue: (p) => p.contact, isStat: true },
        { key: 'power', label: 'パワー', numValue: (p) => p.power, isStat: true },
        { key: 'speed', label: '走力', numValue: (p) => p.speed, isStat: true },
        { key: 'defense', label: '守備', numValue: (p) => p.defense, isStat: true },
      ];

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: ColumnDef) => {
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      // 明示があればそれを、無ければ数値列は降順(高い順)/文字列列は昇順
      setSortDir(col.defaultDir ?? (col.numValue ? 'desc' : 'asc'));
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return players;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return players;
    const arr = [...players];
    arr.sort((a, b) => {
      let cmp = 0;
      if (col.numValue) {
        cmp = col.numValue(a) - col.numValue(b);
      } else if (col.strValue) {
        cmp = col.strValue(a).localeCompare(col.strValue(b), 'ja');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
    // columnsは毎回生成されるが内容は安定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, sortKey, sortDir]);

  const sortMark = (col: ColumnDef) => {
    if (sortKey !== col.key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className={`ptable${isPitcher ? ' pitcher' : ''}`}>
      <div className="ptable-head">
        {columns.map((col) => (
          <button
            key={col.key}
            className={`pt-${col.key === 'name' ? 'name' : col.key === 'age' ? 'age' : col.key === 'pos' ? 'pos' : 'stat'} pt-th${sortKey === col.key ? ' sorted' : ''}`}
            onClick={() => handleSort(col)}
          >
            {col.label}
            {sortMark(col)}
          </button>
        ))}
      </div>

      {sorted.map((p) => (
        <div className="ptable-row" key={p.id}>
          <span className="pt-name clickable" onClick={() => onSelect?.(p)}>
            {p.name}
          </span>
          <span className="pt-age">{p.age}</span>
          <span className="pt-pos">{p.position}</span>
          {columns
            .filter((c) => c.isStat)
            .map((c) => (
              <span className="pt-stat" key={c.key}>
                <StatCell value={c.numValue!(p)} isVelocity={c.isVelocity} />
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}
