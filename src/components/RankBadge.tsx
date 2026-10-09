import type { Rank } from '../domain/types';
import { rankColor } from '../domain/rank';

interface Props {
  rank: Rank;
  size?: 'sm' | 'lg';
  title?: string;
}

/** 能力ランクを色付きバッジで表示する */
export function RankBadge({ rank, size = 'sm', title }: Props) {
  const c = rankColor(rank);
  return (
    <span
      className={`rank-badge${size === 'lg' ? ' lg' : ''}`}
      style={{ color: c.fg, background: c.bg, borderColor: c.border }}
      title={title}
    >
      {rank}
    </span>
  );
}
