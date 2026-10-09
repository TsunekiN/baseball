import { useMemo, useState } from 'react';
import type { Player } from '../domain/types';
import {
  toBattingStats,
  toPitchingStats,
  type BattingStats,
  type PitchingStats,
} from '../domain/stats';
import { emptyBatting, emptyPitching, type PlayerSeasonStats } from '../match/matchStats';

interface Props {
  players: Player[];
  type: Player['type'];
  onSelect?: (player: Player) => void;
  playerStats: Record<string, PlayerSeasonStats>;
}

interface Col {
  key: string;
  label: string;
  num: (row: Row) => number;
  str?: (row: Row) => string;
  format: (row: Row) => string;
  defaultDir: 'asc' | 'desc';
}

interface Row {
  player: Player;
  bat?: BattingStats;
  pit?: PitchingStats;
}

const avg3 = (v: number) => v.toFixed(3).replace(/^0/, '');

/** 今年度の成績表（ソート可能） */
export function PlayerStatsTable({ players, type, onSelect, playerStats }: Props) {
  const rows: Row[] = useMemo(
    () =>
      players.map((p) => {
        const st = playerStats[p.id];
        return type === 'BATTER'
          ? { player: p, bat: toBattingStats(st?.batting ?? emptyBatting()) }
          : { player: p, pit: toPitchingStats(st?.pitching ?? emptyPitching()) };
      }),
    [players, type, playerStats],
  );

  const cols: Col[] = useMemo(() => {
    if (type === 'BATTER') {
      return [
        { key: 'name', label: '名前', num: () => 0, str: (r) => r.player.name, format: (r) => r.player.name, defaultDir: 'asc' },
        { key: 'g', label: '試', num: (r) => r.bat!.games, format: (r) => String(r.bat!.games), defaultDir: 'desc' },
        { key: 'avg', label: '打率', num: (r) => r.bat!.avg, format: (r) => avg3(r.bat!.avg), defaultDir: 'desc' },
        { key: 'hr', label: '本', num: (r) => r.bat!.hr, format: (r) => String(r.bat!.hr), defaultDir: 'desc' },
        { key: 'rbi', label: '点', num: (r) => r.bat!.rbi, format: (r) => String(r.bat!.rbi), defaultDir: 'desc' },
        { key: 'h', label: '安', num: (r) => r.bat!.hits, format: (r) => String(r.bat!.hits), defaultDir: 'desc' },
        { key: 'sb', label: '盗', num: (r) => r.bat!.sb, format: (r) => String(r.bat!.sb), defaultDir: 'desc' },
        { key: 'ops', label: 'OPS', num: (r) => r.bat!.ops, format: (r) => r.bat!.ops.toFixed(3), defaultDir: 'desc' },
      ];
    }
    return [
      { key: 'name', label: '名前', num: () => 0, str: (r) => r.player.name, format: (r) => r.player.name, defaultDir: 'asc' },
      { key: 'era', label: '防', num: (r) => r.pit!.era, format: (r) => r.pit!.era.toFixed(2), defaultDir: 'asc' },
      { key: 'w', label: '勝', num: (r) => r.pit!.wins, format: (r) => String(r.pit!.wins), defaultDir: 'desc' },
      { key: 'l', label: '敗', num: (r) => r.pit!.losses, format: (r) => String(r.pit!.losses), defaultDir: 'desc' },
      { key: 's', label: 'S', num: (r) => r.pit!.saves, format: (r) => String(r.pit!.saves), defaultDir: 'desc' },
      { key: 'h', label: 'H', num: (r) => r.pit!.holds, format: (r) => String(r.pit!.holds), defaultDir: 'desc' },
      { key: 'so', label: '奪', num: (r) => r.pit!.so, format: (r) => String(r.pit!.so), defaultDir: 'desc' },
      { key: 'whip', label: 'WHIP', num: (r) => r.pit!.whip, format: (r) => r.pit!.whip.toFixed(2), defaultDir: 'asc' },
    ];
  }, [type]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (c: Col) => {
    if (sortKey === c.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(c.key);
      setSortDir(c.defaultDir);
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const c = cols.find((x) => x.key === sortKey);
    if (!c) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const cmp = c.str ? c.str(a).localeCompare(c.str(b), 'ja') : c.num(a) - c.num(b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, cols, sortKey, sortDir]);

  const mark = (c: Col) => (sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className={`stat2 ${type === 'PITCHER' ? 'pit' : 'bat'}`}>
      <div className="stat2-head">
        {cols.map((c) => (
          <button key={c.key} className={`stat2-th${sortKey === c.key ? ' sorted' : ''}`} onClick={() => handleSort(c)}>
            {c.label}
            {mark(c)}
          </button>
        ))}
      </div>
      {sorted.map((r) => (
        <div key={r.player.id} className="stat2-row">
          {cols.map((c) =>
            c.key === 'name' ? (
              <span key={c.key} className="stat2-name clickable" onClick={() => onSelect?.(r.player)}>
                {c.format(r)}
              </span>
            ) : (
              <span key={c.key}>{c.format(r)}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
