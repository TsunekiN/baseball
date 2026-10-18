// ============================================================
// 新外国人スカウト（ドラフト会議の後）
// ============================================================

import type { GameState, ForeignScoutState } from './gameState';
import type { Player, Position } from './types';
import { generateForeignProspects } from './foreignScout';

/** 外国人保有上限 */
const FOREIGN_LIMIT = 5;
/** 保有選手の上限（50人枠） */
const ROSTER_LIMIT = 50;

/** マイチームの現在の枠使用状況（ドラフト・スカウトで追加予定分も含む） */
function rosterUsage(state: GameState): { total: number; foreigners: number } {
  const myTeamId = state.myTeamId;
  const myTeam = state.teams.find((t) => t.id === myTeamId);
  if (!myTeam) return { total: 0, foreigners: 0 };
  const draftCount = state.draft?.myPicks.length ?? 0;
  const signed = state.foreignScout?.signed ?? [];
  const total = myTeam.players.length + draftCount + signed.length;
  const foreigners = myTeam.players.filter((p) => p.is_foreign).length + signed.length;
  return { total, foreigners };
}

/** 外国人をあと1名獲得できるか */
export function canSignForeign(state: GameState): boolean {
  const { total, foreigners } = rosterUsage(state);
  return total < ROSTER_LIMIT && foreigners < FOREIGN_LIMIT;
}

/** 外国人スカウトを開始する（ドラフト完了後）。SCOUT段階へ遷移。 */
export function startForeignScout(state: GameState): GameState {
  const positions: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'OF'];
  const pool: Partial<Record<Position, Player[]>> = {};
  for (const pos of positions) {
    pool[pos] = generateForeignProspects(pos, state.year + 1, 5);
  }
  const foreignScout: ForeignScoutState = {
    position: null,
    pool,
    offered: [],
    signed: [],
    done: false,
  };
  return { ...state, offseasonStage: 'SCOUT', foreignScout };
}

/** 指定ポジションの外国人候補5名を提示する。ボタン再押下での再抽選は行わずプールから取得する。 */
export function offerForeignProspects(state: GameState, position: Position): GameState {
  const fs = state.foreignScout;
  if (!fs || fs.done) return state;
  const pool = { ...(fs.pool ?? {}) };
  if (!pool[position]) {
    pool[position] = generateForeignProspects(position, state.year + 1, 5);
  }
  const offered = pool[position] ?? [];
  return { ...state, foreignScout: { ...fs, pool, position, offered } };
}

/** 提示中の候補から1名を獲得する（枠に空きがある場合のみ）。獲得した選手は候補プールから除外される。 */
export function signForeign(state: GameState, prospectId: string): GameState {
  const fs = state.foreignScout;
  if (!fs || fs.done) return state;
  if (!canSignForeign(state)) return state;
  const target = fs.offered.find((p) => p.id === prospectId);
  if (!target) return state;

  const pos = fs.position;
  const pool = { ...(fs.pool ?? {}) };
  if (pos && pool[pos]) {
    pool[pos] = pool[pos]!.filter((p) => p.id !== prospectId);
  }

  return {
    ...state,
    foreignScout: {
      ...fs,
      pool,
      signed: [...fs.signed, target],
      offered: [], // 獲得後は提示をクリア（再度ポジション選択）
      position: null,
    },
  };
}

/** 外国人スカウトを終了する。 */
export function finishForeignScout(state: GameState): GameState {
  const fs = state.foreignScout;
  if (!fs) return state;
  return { ...state, foreignScout: { ...fs, done: true, offered: [], position: null } };
}
