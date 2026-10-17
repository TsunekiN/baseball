import type {
  FieldPosition,
  LineupSlot,
  PitcherAssignment,
  Player,
  RosterLevel,
  Team,
  TeamOrder,
} from './types';

// ============================================================
// 守備適性の判定
// ============================================================

/**
 * 選手が指定の守備位置を守れるか。
 * - 選手のposition(C/1B/2B/3B/SS/OF)を、守備位置(C/1B/2B/3B/SS/LF/CF/RF)へマッピング。
 * - OFはLF/CF/RFすべて可。DHは全野手可（この関数の対象外）。
 */
export function canPlay(player: Player, pos: FieldPosition): boolean {
  if (player.type !== 'BATTER') return false;
  if (pos === 'DH') return true;
  const outfield: FieldPosition[] = ['LF', 'CF', 'RF'];
  if (outfield.includes(pos)) return player.position === 'OF';
  return player.position === pos; // C/1B/2B/3B/SS
}

/** 打者の打撃力（ミート+パワー） */
function battingScore(p: Player): number {
  return p.contact + p.power;
}

/** 打者の総合力（主要4能力の合計） */
export function batterOverall(p: Player): number {
  return p.contact + p.power + p.speed + p.defense;
}

/** 投手の総合力（主要4能力の合計） */
export function pitcherOverall(p: Player): number {
  return p.velocity + p.breaking + p.control + p.stamina;
}

/** リリーフ投手の能力評価（スタミナ以外の3能力合計）。勝ちパ・中継ぎの序列決定に使用 */
function reliefScore(p: Player): number {
  return p.velocity + p.breaking + p.control;
}

// ============================================================
// ロースター正規化
// ============================================================

/** 一軍の規定人数（野手15・投手14 = 計29） */
export const FIRST_BATTERS = 15;
export const FIRST_PITCHERS = 14;

/**
 * 一軍(FIRST)の人数を規定（野手15・投手14）に正規化する。
 * - keepIL=false（オフシーズン用）: 故障者(IL)は二軍(FARM)へ戻す。
 * - keepIL=true（シーズン中用）: IL は維持し、FARM からのみ昇格して一軍を補充する。
 * - 捕手がチームに存在する場合は最低1名を一軍に確保する。
 * - FIRST が不足していれば FARM から昇格、過剰なら降格。
 * 元のチームはミューテートせず、新しい Team を返す。
 */
export function normalizeRoster(team: Team, keepIL = false): Team {
  const rosterLevel: Record<string, RosterLevel> = { ...team.rosterLevel };
  if (!keepIL) {
    for (const id of Object.keys(rosterLevel)) {
      if (rosterLevel[id] === 'IL') rosterLevel[id] = 'FARM';
    }
  }

  // クリーンアップ: チームに実在しない選手IDを削除
  const playerIds = new Set(team.players.map((p) => p.id));
  for (const id of Object.keys(rosterLevel)) {
    if (!playerIds.has(id)) {
      delete rosterLevel[id];
    }
  }
  // 未設定または不正な値はデフォルトで FARM に
  for (const p of team.players) {
    if (!rosterLevel[p.id] || (rosterLevel[p.id] !== 'FIRST' && rosterLevel[p.id] !== 'IL')) {
      rosterLevel[p.id] = 'FARM';
    }
  }

  const score = (p: Player) => (p.type === 'BATTER' ? batterOverall(p) : pitcherOverall(p));

  // --- 野手枠（15名）の調整 ---
  const allBatters = team.players.filter((p) => p.type === 'BATTER');
  const targetBatters = Math.min(FIRST_BATTERS, allBatters.length);

  // 捕手枠の確保: チーム全体に捕手がいれば、一軍に最低1名は確保する
  const firstBatters = allBatters.filter((p) => rosterLevel[p.id] === 'FIRST');
  const farmBatters = allBatters.filter((p) => rosterLevel[p.id] === 'FARM');
  if (!firstBatters.some((p) => p.position === 'C')) {
    const farmCatchers = farmBatters.filter((p) => p.position === 'C');
    if (farmCatchers.length > 0) {
      farmCatchers.sort((a, b) => score(b) - score(a));
      rosterLevel[farmCatchers[0].id] = 'FIRST';
    }
  }

  // 人数バランス調整（不足なら昇格、過剰なら降格）
  const curFirstB = allBatters.filter((p) => rosterLevel[p.id] === 'FIRST');
  const curFarmB = allBatters.filter((p) => rosterLevel[p.id] === 'FARM');
  if (curFirstB.length < targetBatters) {
    const promote = [...curFarmB]
      .sort((a, b) => score(b) - score(a))
      .slice(0, targetBatters - curFirstB.length);
    for (const p of promote) rosterLevel[p.id] = 'FIRST';
  } else if (curFirstB.length > targetBatters) {
    // 降格時: 捕手が1名しかいない場合はその捕手を保護
    const hasSingleC = curFirstB.filter((p) => p.position === 'C').length === 1;
    const demoteCandidates = [...curFirstB].sort((a, b) => {
      if (hasSingleC) {
        if (a.position === 'C') return 1;
        if (b.position === 'C') return -1;
      }
      return score(a) - score(b);
    });
    const demote = demoteCandidates.slice(0, curFirstB.length - targetBatters);
    for (const p of demote) rosterLevel[p.id] = 'FARM';
  }

  // --- 投手枠（14名）の調整 ---
  const allPitchers = team.players.filter((p) => p.type === 'PITCHER');
  const targetPitchers = Math.min(FIRST_PITCHERS, allPitchers.length);
  const curFirstP = allPitchers.filter((p) => rosterLevel[p.id] === 'FIRST');
  const curFarmP = allPitchers.filter((p) => rosterLevel[p.id] === 'FARM');

  if (curFirstP.length < targetPitchers) {
    const promote = [...curFarmP]
      .sort((a, b) => score(b) - score(a))
      .slice(0, targetPitchers - curFirstP.length);
    for (const p of promote) rosterLevel[p.id] = 'FIRST';
  } else if (curFirstP.length > targetPitchers) {
    const demote = [...curFirstP]
      .sort((a, b) => score(a) - score(b))
      .slice(0, curFirstP.length - targetPitchers);
    for (const p of demote) rosterLevel[p.id] = 'FARM';
  }

  return { ...team, rosterLevel };
}

// ============================================================
// ベストオーダー自動編成
// ============================================================

/** スタメン守備位置の割当順（希少ポジションから埋める） */
const ASSIGN_ORDER: FieldPosition[] = ['C', 'SS', '2B', '3B', 'CF', '1B', 'LF', 'RF'];

/**
 * チームのベストオーダーを自動編成する。
 * 自動でロースター正規化（野手15・投手14）を行い、
 * 一軍野手からスタメン9名（守備位置＋DH）と控え6名を必ず割り当てる。
 * 投手は先発6→抑え1→セットアッパー1→中継ぎ6（計14名）を割り当てる。
 */
export function buildBestOrder(team: Team): TeamOrder {
  // まずロースターを正規化（不足枠を二軍から補充）
  const normTeam = normalizeRoster(team, true);
  const firstPlayers = normTeam.players.filter((p) => normTeam.rosterLevel[p.id] === 'FIRST');
  const batters = firstPlayers.filter((p) => p.type === 'BATTER');
  const pitchers = firstPlayers.filter((p) => p.type === 'PITCHER');

  // --- 守備位置の割り当て ---
  const used = new Set<string>();
  const assignment: { player: Player; position: FieldPosition }[] = [];

  // 1巡目: 適性のある選手を割り当て
  const unassignedPositions: FieldPosition[] = [];
  for (const pos of ASSIGN_ORDER) {
    const candidate = batters
      .filter((p) => !used.has(p.id) && canPlay(p, pos))
      .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
    if (candidate) {
      used.add(candidate.id);
      assignment.push({ player: candidate, position: pos });
    } else {
      unassignedPositions.push(pos);
    }
  }

  // 2巡目: 適性者がいなかったポジションに残りの打者を総合力順にフォールバック割当
  for (const pos of unassignedPositions) {
    const fallback = batters
      .filter((p) => !used.has(p.id))
      .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
    if (fallback) {
      used.add(fallback.id);
      assignment.push({ player: fallback, position: pos });
    }
  }

  // DH: 残りの打者から打撃力最高
  const dh = batters
    .filter((p) => !used.has(p.id))
    .sort((a, b) => battingScore(b) - battingScore(a))[0];
  if (dh) {
    used.add(dh.id);
    assignment.push({ player: dh, position: 'DH' });
  }

  // --- 打順の決定 ---
  const lineup = buildBattingOrder(assignment);

  // --- 投手起用 ---
  const pitcherAssign = buildPitcherStaff(pitchers);

  // --- 一軍控え野手（スタメン未選出の一軍野手）を能力順に ---
  const benchBatters = batters
    .filter((p) => !used.has(p.id))
    .sort((a, b) => batterOverall(b) - batterOverall(a))
    .map((p) => p.id);

  const usedBatterIds = new Set<string>([
    ...lineup.map((s) => s.playerId),
    ...benchBatters,
  ]);

  // --- 二軍野手を能力順に（一軍と絶対に重複しない） ---
  const farmBatters = normTeam.players
    .filter((p) => p.type === 'BATTER' && !usedBatterIds.has(p.id) && normTeam.rosterLevel[p.id] !== 'IL')
    .sort((a, b) => batterOverall(b) - batterOverall(a))
    .map((p) => p.id);

  const usedPitcherIds = new Set<string>(pitcherAssign.map((p) => p.playerId));

  // --- 二軍投手を能力順に（一軍と絶対に重複しない） ---
  const farmPitchers = normTeam.players
    .filter((p) => p.type === 'PITCHER' && !usedPitcherIds.has(p.id) && normTeam.rosterLevel[p.id] !== 'IL')
    .sort((a, b) => pitcherOverall(b) - pitcherOverall(a))
    .map((p) => p.id);

  return { lineup, pitchers: pitcherAssign, benchBatters, farmBatters, farmPitchers };
}

/**
 * チームオーダーの重複を完全排除し、欠落選手を適切に補完する。
 * - 野手: lineup(9) -> benchBatters -> farmBatters の優先順位で各選手を必ず1箇所のみに配置。
 * - 投手: pitchers(14) -> farmPitchers の優先順位で各選手を必ず1箇所のみに配置。
 * - チーム在籍の全選手が重複ゼロ・漏れゼロで完全に整理される。
 */
export function cleanTeamOrder(order: TeamOrder, team: Team): TeamOrder {
  const playerMap = new Map(team.players.map((p) => [p.id, p]));
  const allBatters = team.players.filter((p) => p.type === 'BATTER');
  const allPitchers = team.players.filter((p) => p.type === 'PITCHER');

  // --- 野手クリーンアップ ---
  const usedBatters = new Set<string>();
  const cleanLineup: LineupSlot[] = [];

  for (const slot of order.lineup || []) {
    if (slot && slot.playerId && playerMap.has(slot.playerId) && !usedBatters.has(slot.playerId)) {
      usedBatters.add(slot.playerId);
      cleanLineup.push({ ...slot });
    }
  }

  const cleanBench: string[] = [];
  for (const id of order.benchBatters || []) {
    if (id && playerMap.has(id) && !usedBatters.has(id)) {
      usedBatters.add(id);
      cleanBench.push(id);
    }
  }

  const cleanFarmB: string[] = [];
  for (const id of order.farmBatters || []) {
    if (id && playerMap.has(id) && !usedBatters.has(id)) {
      usedBatters.add(id);
      cleanFarmB.push(id);
    }
  }

  // 漏れている在籍野手（IL以外）を二軍へ追加
  for (const p of allBatters) {
    if (!usedBatters.has(p.id) && team.rosterLevel[p.id] !== 'IL') {
      usedBatters.add(p.id);
      cleanFarmB.push(p.id);
    }
  }

  // スタメンが9人未満ならベストオーダーで再編成
  const targetLineup = Math.min(9, allBatters.length);
  if (cleanLineup.length < targetLineup) {
    const best = buildBestOrder(team);
    return {
      lineup: best.lineup,
      benchBatters: best.benchBatters,
      farmBatters: best.farmBatters,
      pitchers: order.pitchers,
      farmPitchers: order.farmPitchers,
    };
  }

  // --- 投手クリーンアップ ---
  const usedPitchers = new Set<string>();
  const cleanPitchers: PitcherAssignment[] = [];
  for (const p of order.pitchers || []) {
    if (p && p.playerId && playerMap.has(p.playerId) && !usedPitchers.has(p.playerId)) {
      usedPitchers.add(p.playerId);
      cleanPitchers.push({ ...p });
    }
  }

  const cleanFarmP: string[] = [];
  for (const id of order.farmPitchers || []) {
    if (id && playerMap.has(id) && !usedPitchers.has(id)) {
      usedPitchers.add(id);
      cleanFarmP.push(id);
    }
  }

  // 漏れている在籍投手（IL以外）を二軍へ追加
  for (const p of allPitchers) {
    if (!usedPitchers.has(p.id) && team.rosterLevel[p.id] !== 'IL') {
      usedPitchers.add(p.id);
      cleanFarmP.push(p.id);
    }
  }

  const targetPitchers = Math.min(FIRST_PITCHERS, allPitchers.length);
  if (cleanPitchers.length < targetPitchers) {
    const best = buildBestOrder(team);
    return {
      lineup: cleanLineup,
      benchBatters: cleanBench,
      farmBatters: cleanFarmB,
      pitchers: best.pitchers,
      farmPitchers: best.farmPitchers,
    };
  }

  return {
    lineup: cleanLineup,
    benchBatters: cleanBench,
    farmBatters: cleanFarmB,
    pitchers: cleanPitchers,
    farmPitchers: cleanFarmP,
  };
}

/**
 * オーダーの整合性を検証・自動修復する。
 * 重複選手や欠落選手を完全に解消し、常に健全なオーダーを返す。
 */
export function sanitizeOrder(order: TeamOrder | undefined, team: Team): TeamOrder {
  if (!order) return buildBestOrder(team);
  return cleanTeamOrder(order, team);
}

/**
 * 打順を定石に沿って決める。
 * 1番: 出塁(ミート)+走力 / 2番: ミート+走力 / 3番: 総合最強打者
 * 4番: パワー最強 / 5番: パワー次点 / 6-9番: 残りを打撃力順
 */
function buildBattingOrder(
  assignment: { player: Player; position: FieldPosition }[],
): LineupSlot[] {
  const pool = [...assignment];
  const result: { player: Player; position: FieldPosition }[] = [];

  const take = (scorer: (p: Player) => number) => {
    let bestIdx = -1;
    let best = -Infinity;
    pool.forEach((a, i) => {
      const s = scorer(a.player);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      const [picked] = pool.splice(bestIdx, 1);
      result.push(picked);
    }
  };

  // 3番（総合最強）→ 4番（パワー）→ 1番（出塁+走）→ 2番（ミート+走）→ 5番（パワー）
  const order: ((p: Player) => number)[] = [];
  // 埋める打順の順序を工夫: まず主軸を確保
  // ここでは打順1〜9を順番に、それぞれ適した指標で選ぶ
  const slotScorers: Record<number, (p: Player) => number> = {
    1: (p) => p.contact + p.speed, // 1番: 出塁+俊足
    2: (p) => p.contact + p.speed * 0.6, // 2番: つなぎ
    3: (p) => p.contact + p.power, // 3番: 総合強打
    4: (p) => p.power + p.contact * 0.4, // 4番: パワー
    5: (p) => p.power + p.contact * 0.3, // 5番: パワー
    6: (p) => p.contact + p.power * 0.7,
    7: (p) => p.contact + p.power * 0.5,
    8: (p) => p.contact + p.power * 0.4,
    9: (p) => p.speed + p.contact * 0.3, // 9番: 走力ある繋ぎ
  };
  for (let slot = 1; slot <= 9; slot++) order.push(slotScorers[slot]);
  order.forEach((scorer) => take(scorer));

  return result.map((a) => ({ playerId: a.player.id, position: a.position }));
}

/**
 * 投手陣の役割を割り当てる。
 * - 先発: スタミナを重視したスコア（stamina * 2 + velocity + breaking + control）上位6名をローテ順に割当。
 * - 残り（リリーフ候補）はスタミナ以外の3能力合計（velocity + breaking + control）の降順で並べ、
 *   抑え(CLOSER) → 8回(SETUP) → 中継ぎ1(MIDDLE) → 中継ぎ2(MIDDLE) → … と割り当てる。
 */
function buildPitcherStaff(pitchers: Player[]): PitcherAssignment[] {
  // 先発候補: スタミナ重視スコアで上位6名
  const byStarterScore = [...pitchers].sort(
    (a, b) => (b.stamina * 2 + b.velocity + b.breaking + b.control)
            - (a.stamina * 2 + a.velocity + a.breaking + a.control),
  );
  const starters = byStarterScore.slice(0, 6);
  const starterIds = new Set(starters.map((p) => p.id));

  // 残り（リリーフ候補）をリリーフスコア（スタミナ以外3能力合計）の降順に
  const relievers = pitchers
    .filter((p) => !starterIds.has(p.id))
    .sort((a, b) => reliefScore(b) - reliefScore(a));

  const result: PitcherAssignment[] = [];

  // ローテ順もスタミナ重視スコアで決定（上位＝1番手）
  starters.forEach((p, i) => {
    result.push({ playerId: p.id, role: 'STARTER', rotationOrder: i + 1 });
  });

  // 抑え→8回→中継ぎ（リリーフスコア順）
  if (relievers[0]) result.push({ playerId: relievers[0].id, role: 'CLOSER' });
  if (relievers[1]) result.push({ playerId: relievers[1].id, role: 'SETUP' });
  relievers.slice(2).forEach((p) => {
    result.push({ playerId: p.id, role: 'MIDDLE' });
  });

  return result;
}
