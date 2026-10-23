import type { SeasonStatLine } from '../domain/gameState';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';
import {
  battingAvg, battingOps, pitchingEra, pitchingWhip,
} from '../match/matchStats';

export const avg3 = (v: number) => v.toFixed(3).replace(/^0/, '');

/**
 * 年度別成績（複数年）。seasons は新しい年が先頭になるよう呼び出し側で整列済みを想定。
 */
export function BatterYearTable({ seasons }: { seasons: SeasonStatLine[] }) {
  return (
    <div className="md-table bt">
      <div className="md-th"><span>年度</span><span>試</span><span>率</span><span>本</span><span>点</span><span>安</span><span>盗</span><span>OPS</span></div>
      {seasons.length === 0 && <div className="md-tr"><span className="off-empty" style={{ gridColumn: '1 / -1' }}>記録なし</span></div>}
      {seasons.map((sl) => {
        const b = sl.stats.batting;
        if (!b || b.games === 0) {
          return (
            <div className="md-tr" key={sl.year}>
              <span>{sl.year}</span>
              <span style={{ gridColumn: '2 / -1', color: 'var(--text-dim, #888)', textAlign: 'center' }}>一軍出場なし</span>
            </div>
          );
        }
        return (
          <div className="md-tr" key={sl.year}>
            <span>{sl.year}</span>
            <span>{b.games}</span>
            <span>{avg3(battingAvg(b))}</span>
            <span>{b.hr}</span>
            <span>{b.rbi}</span>
            <span>{b.hits}</span>
            <span>{b.sb}</span>
            <span>{battingOps(b).toFixed(3)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PitcherYearTable({ seasons }: { seasons: SeasonStatLine[] }) {
  return (
    <div className="md-table pt">
      <div className="md-th"><span>年度</span><span>防</span><span>勝</span><span>敗</span><span>S</span><span>H</span><span>奪</span><span>WHIP</span></div>
      {seasons.length === 0 && <div className="md-tr"><span className="off-empty" style={{ gridColumn: '1 / -1' }}>記録なし</span></div>}
      {seasons.map((sl) => {
        const p = sl.stats.pitching;
        if (!p || p.games === 0) {
          return (
            <div className="md-tr" key={sl.year}>
              <span>{sl.year}</span>
              <span style={{ gridColumn: '2 / -1', color: 'var(--text-dim, #888)', textAlign: 'center' }}>一軍登板なし</span>
            </div>
          );
        }
        return (
          <div className="md-tr" key={sl.year}>
            <span>{sl.year}</span>
            <span>{pitchingEra(p).toFixed(2)}</span>
            <span>{p.wins}</span>
            <span>{p.losses}</span>
            <span>{p.saves}</span>
            <span>{p.holds}</span>
            <span>{p.so}</span>
            <span>{pitchingWhip(p).toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 能力推移（4能力・前年差分付き）。
 * seasons は新しい年が先頭。各行に前年（配列上は次の要素）との差分を表示。
 */
type DisplayAbilityKey = 'contact' | 'power' | 'speed' | 'defense' | 'velocity' | 'breaking' | 'control' | 'stamina';

export function AbilityTrend({ seasons, isPitcher }: { seasons: SeasonStatLine[]; isPitcher: boolean }) {
  const cols: [string, DisplayAbilityKey][] = isPitcher
    ? [['球速', 'velocity'], ['制球', 'control'], ['変化', 'breaking'], ['スタミナ', 'stamina']]
    : [['ミート', 'contact'], ['パワー', 'power'], ['走力', 'speed'], ['守備', 'defense']];

  return (
    <div className="md-table trend">
      <div className="md-th">
        <span>年度</span>
        {cols.map(([l]) => <span key={l}>{l}</span>)}
      </div>
      {seasons.length === 0 && <div className="md-tr"><span className="off-empty" style={{ gridColumn: '1 / -1' }}>記録なし</span></div>}
      {seasons.map((sl, idx) => {
        const prev = seasons[idx + 1]; // 配列は新しい年が先頭なので次要素が前年
        const isFirst = !prev; // 最古の記録（差分なし）
        return (
          <div className="md-tr" key={sl.year}>
            <span>{sl.year}</span>
            {cols.map(([l, key]) => {
              const v = sl.abilities[key];
              const rank = key === 'velocity' ? rankFromVelocity(v) : rankFromValue(v);
              const rc = rankColor(rank);
              const d = isFirst ? 0 : Math.round(v - prev!.abilities[key]);
              const sign = d > 0 ? `+${d}` : d < 0 ? `${d}` : '±0';
              const dcls = d > 0 ? 'diff-up' : d < 0 ? 'diff-down' : '';
              return (
                <span key={l}>
                  {displayAbility(v)}
                  <span style={{ color: rc.border }}>{rank}</span>
                  {!isFirst && <span className={dcls}> ({sign})</span>}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
