// ============================================================
// 負傷離脱管理（故障者リスト IL）
// 負傷選手を故障者リストへ入れ、スタメン/投手なら自動補充する。
// 離脱試合数をカウントダウンし、満了で二軍へ復帰させる。
// マイチームのみ対象。
// ============================================================

import type { Player, Team, TeamOrder } from './types';
import type { InjuryEntry } from './gameState';
import { canPlay, batterOverall, pitcherOverall } from './orderFactory';

/**
 * 新しい負傷を適用する。負傷選手を IL にし、必要なら自動補充する。
 * 返り値は更新後の team / order（非破壊）。
 */
export function applyInjury(team: Team, order: TeamOrder, playerId: string): { team: Team; order: TeamOrder } {
  const p = team.players.find((x) => x.id === playerId);
  if (!p) return { team, order };

  const rosterLevel = { ...team.rosterLevel };
  rosterLevel[playerId] = 'IL';
  const pmap = new Map(team.players.map((x) => [x.id, x]));

  let lineup = [...order.lineup];
  let bench = [...order.benchBatters];
  let pitchers = [...order.pitchers];
  let farmBatters = [...order.farmBatters];
  let farmPitchers = [...order.farmPitchers];

  if (p.type === 'BATTER') {
    const idx = lineup.findIndex((s) => s.playerId === playerId);
    if (idx >= 0) {
      const pos = lineup[idx].position;
      // 1) 控え(bench)から同ポジション適性の最良を繰り上げ
      const benchCand = bench
        .map((id) => pmap.get(id))
        .filter((x): x is Player => !!x && canPlay(x, pos))
        .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
      if (benchCand) {
        lineup[idx] = { ...lineup[idx], playerId: benchCand.id };
        bench = bench.filter((id) => id !== benchCand.id);
        // 控えの欠員を二軍最良で補充（一軍へ昇格）
        const farmUp = farmBatters
          .map((id) => pmap.get(id))
          .filter((x): x is Player => !!x)
          .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
        if (farmUp) {
          rosterLevel[farmUp.id] = 'FIRST';
          farmBatters = farmBatters.filter((id) => id !== farmUp.id);
          bench = [...bench, farmUp.id];
        }
      } else {
        // 2) 控えに適性者がいなければ二軍から適性最良を直接昇格
        let farmUp = farmBatters
          .map((id) => pmap.get(id))
          .filter((x): x is Player => !!x && canPlay(x, pos))
          .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
        // 適性者もいなければ二軍最良（守備適性なしでも起用）
        if (!farmUp) {
          farmUp = farmBatters
            .map((id) => pmap.get(id))
            .filter((x): x is Player => !!x)
            .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
        }
        if (farmUp) {
          rosterLevel[farmUp.id] = 'FIRST';
          farmBatters = farmBatters.filter((id) => id !== farmUp.id);
          lineup[idx] = { ...lineup[idx], playerId: farmUp.id };
        }
      }
    } else {
      // スタメン外（控え/二軍）の負傷はリストから外すだけ
      bench = bench.filter((id) => id !== playerId);
      farmBatters = farmBatters.filter((id) => id !== playerId);
    }
  } else {
    // 投手
    const idx = pitchers.findIndex((a) => a.playerId === playerId);
    if (idx >= 0) {
      // 二軍投手から適性（総合力）最良を昇格し、同じ役割スロットへ
      const farmUp = farmPitchers
        .map((id) => pmap.get(id))
        .filter((x): x is Player => !!x)
        .sort((a, b) => pitcherOverall(b) - pitcherOverall(a))[0];
      if (farmUp) {
        rosterLevel[farmUp.id] = 'FIRST';
        farmPitchers = farmPitchers.filter((id) => id !== farmUp.id);
        pitchers[idx] = { ...pitchers[idx], playerId: farmUp.id };
      } else {
        // 補充不可なら役割枠から外す
        pitchers = pitchers.filter((_, i) => i !== idx);
      }
    } else {
      farmPitchers = farmPitchers.filter((id) => id !== playerId);
    }
  }

  return {
    team: { ...team, rosterLevel },
    order: { ...order, lineup, benchBatters: bench, pitchers, farmBatters, farmPitchers },
  };
}

/**
 * 故障者リストの離脱試合数を1試合分減らす。
 * 満了(0)になった選手を復帰として返す。
 * @returns { injuries: 更新後, returned: 復帰した選手 }
 */
export function tickInjuries(injuries: Record<string, InjuryEntry>): {
  injuries: Record<string, InjuryEntry>;
  returned: InjuryEntry[];
} {
  const next: Record<string, InjuryEntry> = {};
  const returned: InjuryEntry[] = [];
  for (const [id, e] of Object.entries(injuries)) {
    const gamesLeft = e.gamesLeft - 1;
    if (gamesLeft <= 0) {
      returned.push({ ...e, gamesLeft: 0 });
    } else {
      next[id] = { ...e, gamesLeft };
    }
  }
  return { injuries: next, returned };
}

/**
 * 故障者リストから復帰した選手を二軍(FARM)へ戻す。
 * rosterLevel を FARM に戻すだけでなく、二軍オーダー配列(farmBatters/farmPitchers)へ
 * 選手IDを再登録する（負傷時に order から外されているため、戻さないと編成画面から消える）。
 */
export function returnToFarm(team: Team, order: TeamOrder, playerId: string): { team: Team; order: TeamOrder } {
  if (team.rosterLevel[playerId] !== 'IL') return { team, order };
  const p = team.players.find((x) => x.id === playerId);
  const rosterLevel = { ...team.rosterLevel, [playerId]: 'FARM' as const };
  const nextTeam = { ...team, rosterLevel };

  // 既にどこかのオーダー枠に入っていれば二重登録しない
  const inOrder =
    order.lineup.some((s) => s.playerId === playerId) ||
    order.benchBatters.includes(playerId) ||
    order.pitchers.some((a) => a.playerId === playerId) ||
    order.farmBatters.includes(playerId) ||
    order.farmPitchers.includes(playerId);
  if (!p || inOrder) return { team: nextTeam, order };

  const nextOrder =
    p.type === 'BATTER'
      ? { ...order, farmBatters: [...order.farmBatters, playerId] }
      : { ...order, farmPitchers: [...order.farmPitchers, playerId] };
  return { team: nextTeam, order: nextOrder };
}
