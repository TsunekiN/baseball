import type {
  FieldPosition,
  LineupSlot,
  PitcherAssignment,
  Player,
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
// ベストオーダー自動編成
// ============================================================

/** スタメン守備位置の割当順（希少ポジションから埋める） */
const ASSIGN_ORDER: FieldPosition[] = ['C', 'SS', '2B', '3B', 'CF', '1B', 'LF', 'RF'];

/**
 * チームのベストオーダーを自動編成する。
 * 一軍選手のみを対象に、守備位置ごとに最良の選手を割り当て、
 * 残りの最良打者をDHに。打順は定石（1番=出塁/俊足、3-4-5番=強打）で並べる。
 * 投手は能力順に先発6→抑え→セットアッパー→中継ぎ6を割り当てる。
 */
export function buildBestOrder(team: Team): TeamOrder {
  const firstPlayers = team.players.filter((p) => team.rosterLevel[p.id] === 'FIRST');
  const batters = firstPlayers.filter((p) => p.type === 'BATTER');
  const pitchers = firstPlayers.filter((p) => p.type === 'PITCHER');

  // --- 守備位置の割り当て ---
  const used = new Set<string>();
  const assignment: { player: Player; position: FieldPosition }[] = [];

  for (const pos of ASSIGN_ORDER) {
    // その位置を守れる未使用選手のうち、総合力最高を選ぶ
    const candidate = batters
      .filter((p) => !used.has(p.id) && canPlay(p, pos))
      .sort((a, b) => batterOverall(b) - batterOverall(a))[0];
    if (candidate) {
      used.add(candidate.id);
      assignment.push({ player: candidate, position: pos });
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

  // --- 二軍野手を能力順に ---
  const farmBatters = team.players
    .filter((p) => p.type === 'BATTER' && team.rosterLevel[p.id] === 'FARM')
    .sort((a, b) => batterOverall(b) - batterOverall(a))
    .map((p) => p.id);

  // --- 二軍投手を能力順に ---
  const farmPitchers = team.players
    .filter((p) => p.type === 'PITCHER' && team.rosterLevel[p.id] === 'FARM')
    .sort((a, b) => pitcherOverall(b) - pitcherOverall(a))
    .map((p) => p.id);

  return { lineup, pitchers: pitcherAssign, benchBatters, farmBatters, farmPitchers };
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
