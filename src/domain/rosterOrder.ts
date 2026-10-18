import type { Player, Team, TeamOrder } from './types';

export const ROLE_SORT: Record<string, number> = { STARTER: 0, SETUP: 1, CLOSER: 2, MIDDLE: 3 };

/**
 * 一軍/二軍の選手を「オーダー（野手）/編成（投手）の並び順」で返す。
 * 一軍 = 野手:打順→控え / 投手:役割順。二軍 = farm の並び順。
 * オーダーに無い該当選手は末尾に補完する。
 */
export function orderedByOrder(
  team: Team,
  order: TeamOrder,
  type: Player['type'],
): { first: Player[]; farm: Player[] } {
  const pmap = new Map(team.players.map((p) => [p.id, p]));
  const level = (id: string) => team.rosterLevel[id];

  // 一軍の並び順（playerId）
  let firstIds: string[];
  let farmIds: string[];
  if (type === 'BATTER') {
    firstIds = [...order.lineup.map((s) => s.playerId), ...order.benchBatters];
    farmIds = [...order.farmBatters];
  } else {
    firstIds = [...order.pitchers]
      .sort(
        (a, b) =>
          (ROLE_SORT[a.role] ?? 9) - (ROLE_SORT[b.role] ?? 9) ||
          (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0),
      )
      .map((a) => a.playerId);
    farmIds = [...order.farmPitchers];
  }

  const pick = (ids: string[], wantLevel: 'FIRST' | 'FARM'): Player[] => {
    const seen = new Set<string>();
    const list: Player[] = [];
    for (const id of ids) {
      const p = pmap.get(id);
      if (p && p.type === type && level(id) === wantLevel && !seen.has(id)) {
        seen.add(id);
        list.push(p);
      }
    }
    // オーダーに無い該当選手を末尾へ
    for (const p of team.players) {
      if (p.type === type && level(p.id) === wantLevel && !seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    return list;
  };

  return { first: pick(firstIds, 'FIRST'), farm: pick(farmIds, 'FARM') };
}
