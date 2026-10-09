import type { Player, Team, TeamOrder } from '../domain/types';
import { simulateAtBat } from './atBat';
import type {
  AtBatOutcome,
  AtBatSubType,
  BatterLine,
  GameResult,
  Half,
  InningScore,
  PitcherLine,
  PlateAppearance,
} from './matchTypes';

export interface SideInput {
  team: Team;
  order: TeamOrder;
  /** この試合の先発投手ID（ローテ管理のため progress 側で指定）。未指定なら rotationOrder 最小 */
  startPitcherId?: string;
}

interface PitcherState {
  player: Player;
  staminaLeft: number; // 残スタミナ（初期=player.stamina）
  line: PitcherLine;
}

interface BatterState {
  player: Player;
  line: BatterLine;
}

const OUTCOME_DESC: Record<AtBatOutcome, string> = {
  K: '三振',
  BB: '四球',
  OUT: '凡打',
  '1B': '単打',
  '2B': '二塁打',
  '3B': '三塁打',
  HR: '本塁打',
};

/** チーム片側の走行状態 */
class Side {
  team: Team;
  order: TeamOrder;
  batters: BatterState[]; // 打順9
  battingIndex = 0;
  // 投手
  starter: PitcherState;
  relievers: { setup?: Player; closer?: Player; middles: Player[] };
  used: Set<string> = new Set();
  currentPitcher: PitcherState;
  pitcherStates: Map<string, PitcherState> = new Map();
  loggedPitcherId: string; // 直近ログに出した投手（継投検出用）
  catcher?: Player; // 守備側の捕手（盗塁阻止判定用）
  outfielders: Player[] = []; // 守備側の外野手（走者生還判定用）
  infielders: Player[] = []; // 守備側の内野手（内野ゴロの本塁判定用）
  dpFielders: Player[] = []; // 併殺を担う内野手（二塁手・遊撃手・三塁手）

  constructor(input: SideInput) {
    this.team = input.team;
    this.order = input.order;
    const pmap = new Map(input.team.players.map((p) => [p.id, p]));

    this.batters = input.order.lineup.map((slot) => {
      const p = pmap.get(slot.playerId)!;
      return { player: p, line: emptyBatterLine(p) };
    });

    // 守備側の捕手（盗塁阻止判定用）: スタメンのC、いなければ守備位置Cの控え or 最初の捕手
    const catcherSlot = input.order.lineup.find((slot) => slot.position === 'C');
    this.catcher = catcherSlot
      ? pmap.get(catcherSlot.playerId)
      : input.team.players.find((p) => p.position === 'C');

    // 守備側の外野手（走者生還判定用）: スタメンのLF/CF/RF
    this.outfielders = input.order.lineup
      .filter((slot) => slot.position === 'LF' || slot.position === 'CF' || slot.position === 'RF')
      .map((slot) => pmap.get(slot.playerId))
      .filter((p): p is Player => !!p);
    if (this.outfielders.length === 0) {
      this.outfielders = input.team.players.filter((p) => p.position === 'OF');
    }

    // 守備側の内野手（内野ゴロの本塁突入判定用）: スタメンの1B/2B/3B/SS
    const infPos = ['1B', '2B', '3B', 'SS'];
    this.infielders = input.order.lineup
      .filter((slot) => infPos.includes(slot.position))
      .map((slot) => pmap.get(slot.playerId))
      .filter((p): p is Player => !!p);
    if (this.infielders.length === 0) {
      this.infielders = input.team.players.filter((p) => infPos.includes(p.position));
    }

    // 併殺を担う内野手（二塁手・遊撃手・三塁手）
    const dpPos = ['2B', 'SS', '3B'];
    this.dpFielders = input.order.lineup
      .filter((slot) => dpPos.includes(slot.position))
      .map((slot) => pmap.get(slot.playerId))
      .filter((p): p is Player => !!p);
    if (this.dpFielders.length === 0) {
      this.dpFielders = input.team.players.filter((p) => dpPos.includes(p.position));
    }

    // 先発: progress側で指定された投手を優先。未指定なら rotationOrder 最小の STARTER
    const starters = input.order.pitchers
      .filter((a) => a.role === 'STARTER')
      .sort((a, b) => (a.rotationOrder ?? 0) - (b.rotationOrder ?? 0));
    const specified = input.startPitcherId ? pmap.get(input.startPitcherId) : undefined;
    const starterPlayer =
      specified ?? pmap.get((starters[0] ?? input.order.pitchers[0]).playerId)!;

    this.relievers = {
      setup: pmap.get(input.order.pitchers.find((a) => a.role === 'SETUP')?.playerId ?? ''),
      closer: pmap.get(input.order.pitchers.find((a) => a.role === 'CLOSER')?.playerId ?? ''),
      middles: input.order.pitchers
        .filter((a) => a.role === 'MIDDLE')
        .map((a) => pmap.get(a.playerId)!)
        .filter(Boolean),
    };

    this.starter = this.makePitcherState(starterPlayer);
    this.currentPitcher = this.starter;
    this.used.add(starterPlayer.id);
    this.loggedPitcherId = starterPlayer.id;
  }

  makePitcherState(p: Player): PitcherState {
    const st: PitcherState = { player: p, staminaLeft: p.stamina, line: emptyPitcherLine(p) };
    this.pitcherStates.set(p.id, st);
    return st;
  }

  nextBatter(): BatterState {
    const b = this.batters[this.battingIndex % this.batters.length];
    this.battingIndex++;
    return b;
  }

  /** 継投判断（イニング開始時）。lead=投げる側から見た点差 */
  maybeChangePitcher(inning: number, lead: number) {
    const cur = this.currentPitcher;
    const staminaRatio = cur.staminaLeft / Math.max(cur.player.stamina, 1);

    // 先発の続投判断
    const isStarter = cur.player.id === this.starter.player.id;
    let needChange = false;
    if (isStarter) {
      if (staminaRatio <= 0.15) needChange = true;
      else if (inning >= 8) needChange = true; // 8回以降はリリーフへ
      else if (inning >= 7 && staminaRatio <= 0.35) needChange = true;
      // 7回・僅差リード(1〜3点)でセットアッパーか中継ぎ上位が使えるなら降板
      else if (inning >= 7 && lead >= 1 && lead <= 3) {
        const avail = (p?: Player) => p && !this.used.has(p.id);
        if (avail(this.relievers.setup) || this.relievers.middles.some((p) => !this.used.has(p.id))) {
          needChange = true;
        }
      }
    } else {
      // リリーフは1〜2イニングで交代（スタミナ切れ）
      if (staminaRatio <= 0.2) needChange = true;
    }
    if (!needChange) return;

    const next = this.pickReliever(inning, lead);
    if (next) {
      this.currentPitcher = this.makePitcherState(next);
      this.used.add(next.id);
    }
  }

  pickReliever(inning: number, lead: number): Player | null {
    const avail = (p?: Player) => p && !this.used.has(p.id);
    // セーブ展開: 9回リード(1〜3点)は抑え
    if (inning >= 9 && lead > 0 && lead <= 3 && avail(this.relievers.closer)) {
      return this.relievers.closer!;
    }
    // ホールド展開: 7〜8回リード(1〜3点)はセットアッパー
    if (inning >= 7 && lead > 0 && lead <= 3 && avail(this.relievers.setup)) {
      return this.relievers.setup!;
    }
    // 9回リード(1〜3点)で抑え不在 → セットアッパー
    if (inning >= 9 && lead > 0 && lead <= 3 && avail(this.relievers.setup)) {
      return this.relievers.setup!;
    }
    // 中継ぎ: 点差で上位/下位を選ぶ
    const mids = this.relievers.middles.filter((p) => !this.used.has(p.id));
    if (mids.length > 0) {
      if (lead >= -1) return mids[0]; // 僅差〜リード: 上位
      if (lead <= -5) return mids[mids.length - 1]; // 大差ビハインド: 下位(敗戦処理)
      return mids[Math.floor(mids.length / 2)]; // 中位
    }
    // 予備: 未使用のセットアッパー/抑え
    if (avail(this.relievers.setup)) return this.relievers.setup!;
    if (avail(this.relievers.closer)) return this.relievers.closer!;
    return null; // 交代先なし→続投
  }
}

function emptyPitcherLine(p: Player): PitcherLine {
  return {
    playerId: p.id, name: p.name, outs: 0, batters: 0, hits: 0, hr: 0, bb: 0, hbp: 0, so: 0, runs: 0, unearnedRuns: 0,
    win: false, loss: false, save: false, hold: false,
  };
}
function emptyBatterLine(p: Player): BatterLine {
  return { playerId: p.id, name: p.name, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, so: 0, sac: 0, sf: 0, sb: 0 };
}

/** 塁上の走者（打者情報を保持。空塁はnull） */
type Runner = BatterState | null;

/** 走者を生還させる（得点＋その走者の得点数を記録） */
function scoreRunner(r: Runner): number {
  if (r) r.line.runs++;
  return 1;
}

/**
 * 走者が余分に1つ多く進む（生還する）確率。
 * = base + 走者の走力 - ランダムに選んだ守備者の守備力（%）。0〜100でクランプ。
 * base: 進塁の基本成功率（通常の余分進塁=40、犠飛のタッチアップ=60）。
 */
function extraAdvanceRate(runner: BatterState, fielders: Player[], rng: () => number, base = 40): number {
  const f = fielders.length > 0 ? fielders[Math.floor(rng() * fielders.length)] : undefined;
  const def = f?.defense ?? 50;
  return Math.min(1, Math.max(0, (base + runner.player.speed - def) / 100));
}

/** 本塁突入に失敗した走者が本塁でアウトになる確率 */
const THROWN_OUT_AT_HOME = 0.2;

/** アウト打球の種別と守備位置表記 */
interface BattedBall {
  ground: boolean; // 内野ゴロか（併殺・ゴロの間の対象）
  outfield: boolean; // 外野への飛球か（犠飛の対象）
  desc: string; // 「二ゴロ」「レフトフライ」など
}

/** アウトになった打球の種別（ゴロ/フライ×守備位置）を生成 */
function rollBattedBall(rng: () => number): BattedBall {
  const r = rng();
  if (r < 0.4) {
    // 内野ゴロ（守備位置: 遊・二が多め）
    const g = rng();
    const pos = g < 0.28 ? '遊' : g < 0.54 ? '二' : g < 0.74 ? '三' : g < 0.92 ? '一' : '投';
    return { ground: true, outfield: false, desc: `${pos}ゴロ` };
  } else if (r < 0.52) {
    // 内野フライ
    const g = rng();
    const pos = g < 0.3 ? '遊' : g < 0.55 ? '二' : g < 0.75 ? '三' : g < 0.9 ? '一' : '投';
    return { ground: false, outfield: false, desc: `${pos}飛` };
  } else {
    // 外野フライ
    const g = rng();
    const pos = g < 0.36 ? 'レフト' : g < 0.7 ? 'センター' : 'ライト';
    return { ground: false, outfield: true, desc: `${pos}フライ` };
  }
}

/** 併殺の基準成立確率（守備力70の内野手基準） */
const DOUBLE_PLAY_BASE = 0.42;

/**
 * 併殺が成立する確率。二塁手・遊撃手・三塁手からランダムに1人を選び、
 * その守備力と打者走者の走力の差で補正（俊足打者はゲッツーを免れやすい）。
 * = 0.42 + (選んだ内野手の守備力 - 打者の走力) × 0.006。0〜1でクランプ。
 */
function doublePlayRate(defense: Side, batter: BatterState, rng: () => number): number {
  const fs = defense.dpFielders;
  const f = fs.length > 0 ? fs[Math.floor(rng() * fs.length)] : undefined;
  const def = f?.defense ?? 70;
  return Math.min(1, Math.max(0, DOUBLE_PLAY_BASE + (def - batter.player.speed) * 0.006));
}
/** 1塁走者が単打で三塁を狙う確率（打球を選んで走る） */
const TRY_FIRST_TO_THIRD = 0.5;
/** 一→三塁の進塁に失敗した走者が三塁でアウトになる確率 */
const THROWN_OUT_AT_THIRD = 0.1;

/**
 * 走者処理。塁状況を更新し、得点数を返す。
 * bases: [1塁, 2塁, 3塁] の走者（BatterState or null）。
 * batter: 打者本人（塁に出る／生還する場合に得点を記録）。
 */
function advance(
  bases: Runner[],
  outcome: AtBatOutcome,
  batter: BatterState,
  defense: Side,
  rng: () => number,
): { runs: number; outs: number } {
  let runs = 0;
  let outs = 0;
  switch (outcome) {
    case '1B': {
      const third = bases[2];
      const second = bases[1];
      const first = bases[0];
      if (third) runs += scoreRunner(third); // 3塁走者生還
      // 2塁走者: 単打で生還する確率（40 + 走力 - 外野守備）。失敗時30%は本塁憤死
      let newThird: Runner = null;
      if (second) {
        if (rng() < extraAdvanceRate(second, defense.outfielders, rng)) runs += scoreRunner(second);
        else if (rng() < THROWN_OUT_AT_HOME) outs++; // 本塁でアウト（走者消滅）
        else newThird = second;
      }
      // 1塁走者: 三塁が空いていれば50%の確率で一気に三塁を狙う（40 + 走力 - 外野守備）
      let newSecond: Runner = first; // 既定は2塁止まり
      if (first && newThird === null && rng() < TRY_FIRST_TO_THIRD) {
        if (rng() < extraAdvanceRate(first, defense.outfielders, rng)) {
          newThird = first; // 一→三塁成功
          newSecond = null;
        } else if (rng() < THROWN_OUT_AT_THIRD) {
          outs++; // 三塁でアウト（走者消滅）
          newSecond = null;
        }
        // 残りは2塁止まり（newSecond = first のまま）
      }
      bases[2] = newThird;
      bases[1] = newSecond;
      bases[0] = batter; // 打者→1塁
      break;
    }
    case 'BB': {
      // 四球: 押し出し式に1つずつ詰める
      forceWalk(bases, batter);
      runs += forceWalkRuns;
      break;
    }
    case '2B': {
      if (bases[2]) runs += scoreRunner(bases[2]);
      if (bases[1]) runs += scoreRunner(bases[1]);
      const first = bases[0];
      // 1塁走者: 二塁打で生還する確率（40 + 走力 - 外野守備）。失敗時30%は本塁憤死、否なら3塁止まり
      let newThird: Runner = null;
      if (first) {
        if (rng() < extraAdvanceRate(first, defense.outfielders, rng)) runs += scoreRunner(first);
        else if (rng() < THROWN_OUT_AT_HOME) outs++; // 本塁でアウト（走者消滅）
        else newThird = first;
      }
      bases[2] = newThird; // 1塁走者→3塁 or 生還
      bases[1] = batter; // 打者2塁
      bases[0] = null;
      break;
    }
    case '3B': {
      if (bases[0]) runs += scoreRunner(bases[0]);
      if (bases[1]) runs += scoreRunner(bases[1]);
      if (bases[2]) runs += scoreRunner(bases[2]);
      bases[0] = null;
      bases[1] = null;
      bases[2] = batter; // 打者3塁
      break;
    }
    case 'HR': {
      if (bases[0]) runs += scoreRunner(bases[0]);
      if (bases[1]) runs += scoreRunner(bases[1]);
      if (bases[2]) runs += scoreRunner(bases[2]);
      runs += scoreRunner(batter); // 打者本人も生還
      bases[0] = null;
      bases[1] = null;
      bases[2] = null;
      break;
    }
    case 'K':
    case 'OUT':
      break;
  }
  return { runs, outs };
}

/** forceWalkの押し出し得点（直近呼び出し分） */
let forceWalkRuns = 0;

/** 四球の押し出し処理。塁を1つずつ詰め、押し出し得点をforceWalkRunsに記録 */
function forceWalk(bases: Runner[], batter: BatterState): void {
  forceWalkRuns = 0;
  const [b1, b2, b3] = bases;
  if (b1) {
    if (b2) {
      if (b3) {
        forceWalkRuns += scoreRunner(b3); // 満塁→押し出し
      }
      bases[2] = b2; // 2塁走者→3塁
    }
    bases[1] = b1; // 1塁走者→2塁
  }
  bases[0] = batter; // 打者→1塁
}

interface HalfResult {
  runs: number;
  hits: number;
  walkOff: boolean;
  fieldErrors: Record<string, number>; // 守備失策（playerId -> 数）
}

/** 失策の基本発生率係数（守備力依存）。守備60で約6%、守備40で約14%、守備80で0% */
function errorRate(fielderDef: number): number {
  return Math.max(0, Math.min(0.2, (80 - fielderDef) / 100 * 0.4));
}

/** 攻撃側(offense)が守備側(defense)を相手に1イニング攻撃する */
function playHalf(
  offense: Side,
  defense: Side,
  inning: number,
  half: Half,
  log: PlateAppearance[],
  rng: () => number,
  offBase: number,
  defBase: number,
  opts: { walkOffThreshold?: number } = {},
): HalfResult {
  let outs = 0;
  let runs = 0;
  let hits = 0;
  const fieldErrors: Record<string, number> = {};
  const bases: Runner[] = [null, null, null];

  while (outs < 3) {
    const outsBefore = outs;
    const orderPos = offense.battingIndex % offense.batters.length; // これから打つ打順(0-8)
    const batter = offense.nextBatter();
    const ps = defense.currentPitcher;

    // --- 盗塁企図（打席前）: 一塁走者がいて二塁が空いているとき ---
    // 企図率 = max(0,(走力-55))×0.63%、成功率 = 走力 - 相手C守備/2 + 20（0〜100%）
    if (bases[0] && !bases[1] && outs < 3) {
      const runner = bases[0];
      // 企図率: 走力に応じて控えめに（俊足のみ積極盗塁。盗塁王が40前後になるよう調整）
      const attemptRate = Math.max(0, (runner.player.speed - 55) / 100 * 0.63);
      if (rng() < attemptRate) {
        const catcherDef = defense.catcher?.defense ?? 50;
        const successRate = Math.min(1, Math.max(0, (runner.player.speed - catcherDef / 2 + 20) / 100));
        if (rng() < successRate) {
          // 盗塁成功: 一塁→二塁
          bases[1] = runner;
          bases[0] = null;
          runner.line.sb++;
        } else {
          // 盗塁死（CSは内部処理のみ・成績非表示）。走塁死も投球回にカウント
          bases[0] = null;
          outs++;
          ps.line.outs++;
          if (outs >= 3) break;
        }
      }
    }
    const staminaRatio = ps.staminaLeft / Math.max(ps.player.stamina, 1);
    const bl = batter.line;
    // 打席前の状況
    const runnersOn = bases.filter(Boolean).length;
    const pitcherChanged = ps.player.id !== defense.loggedPitcherId;
    if (pitcherChanged) defense.loggedPitcherId = ps.player.id;
    const runsBefore = runs;
    const offBefore = offBase + runsBefore;
    const scoreDiff = offBefore - defBase;

    let outcome: AtBatOutcome = 'OUT';
    let subType: AtBatSubType | undefined;
    let runsScored = 0;
    let outDesc: string | undefined;

    if (shouldBunt(inning, outsBefore, bases, batter.player, scoreDiff, orderPos, rng)) {
      // 送りバント: 走者を1つ進めてアウト
      ps.line.batters++;
      ps.staminaLeft = Math.max(0, ps.staminaLeft - 1.5);
      outs++;
      ps.line.outs++;
      bl.sac++;
      if (bases[1]) bases[2] = bases[1]; // 二塁走者→三塁
      bases[1] = bases[0]; // 一塁走者→二塁
      bases[0] = null;
      subType = 'sacBunt';
      outDesc = '犠打';
    } else {
      outcome = simulateAtBat(batter.player, ps.player, staminaRatio, rng, half === 'B');

      let cost = 2.0;
      if (outcome === '1B' || outcome === '2B' || outcome === '3B') cost += 1.0;
      if (outcome === 'HR') cost += 1.6;
      if (outcome === 'BB') cost += 1.2;
      ps.staminaLeft = Math.max(0, ps.staminaLeft - cost);
      ps.line.batters++;

      if (outcome === 'K') {
        outs++;
        ps.line.so++;
        ps.line.outs++;
        bl.ab++;
        bl.so++;
        outDesc = '三振';
      } else if (outcome === 'OUT' && rng() < batter.player.speed / 2000) {
        // 内野ゴロでの内野安打（走力/20%）: 単打として出塁。走者はフォースのみ進む
        outcome = '1B';
        subType = 'infieldHit';
        outDesc = '内野安打';
        hits++;
        ps.line.hits++;
        bl.ab++;
        bl.hits++;
        forceWalk(bases, batter);
        runsScored = forceWalkRuns; // 満塁なら押し出し得点
      } else if (outcome === 'OUT') {
        const bb = rollBattedBall(rng);

        // --- 失策（内野ゴロのみ・守備力依存） ---
        let errorMade = false;
        if (bb.ground && defense.infielders.length > 0) {
          const fielder = defense.infielders[Math.floor(rng() * defense.infielders.length)];
          if (rng() < errorRate(fielder.defense)) {
            errorMade = true;
            bl.ab++; // 打数には含む（安打ではない）
            forceWalk(bases, batter); // 打者出塁・走者はフォース進塁
            const er = forceWalkRuns;
            if (er > 0) {
              runs += er;
              ps.line.runs += er;
              ps.line.unearnedRuns += er; // 失策絡みは非自責
            }
            fieldErrors[fielder.id] = (fieldErrors[fielder.id] ?? 0) + 1;
            outDesc = `${bb.desc.replace('ゴロ', '')}失策`;
          }
        }

        if (errorMade) {
          // 失策で出塁。アウトは成立しない（outs据え置き）
        } else {
        outs++;
        ps.line.outs++;
        outDesc = bb.desc;
        let countAsAb = true; // 犠飛のみ打数に含めない

        // 併殺（内野ゴロ・一塁走者あり・2アウト未満）
        let doublePlay = false;
        if (bb.ground && bases[0] && outsBefore < 2 && rng() < doublePlayRate(defense, batter, rng)) {
          bases[0] = null; // 一塁走者を二塁封殺
          outs++;
          ps.line.outs++;
          outDesc = '併殺打';
          doublePlay = true;
        }

        // 三塁走者あり・2アウト未満: 犠飛(外野フライ) or ゴロの間(内野ゴロ)で得点
        if (!doublePlay && outsBefore < 2 && bases[2]) {
          const runner3 = bases[2];
          if (bb.outfield) {
            // 犠飛狙い: タッチアップ生還判定（60 + 走力 - 外野守備）
            if (rng() < extraAdvanceRate(runner3, defense.outfielders, rng, 60)) {
              runsScored = 1;
              runner3.line.runs++;
              bases[2] = null;
              subType = 'sacFly';
              countAsAb = false; // 犠飛は打数に含めない
              bl.sf++;
              outDesc = `${bb.desc}（犠飛）`;
            } else if (rng() < THROWN_OUT_AT_HOME) {
              // 本塁憤死: 走者アウト（打者フライと併殺）。走塁死は投球回カウント
              bases[2] = null;
              outs++;
              ps.line.outs++;
            }
          } else if (bb.ground) {
            // ゴロの間の得点判定（内野守備）
            if (rng() < extraAdvanceRate(runner3, defense.infielders, rng)) {
              runsScored = 1;
              runner3.line.runs++;
              bases[2] = null;
              subType = 'groundRBI';
            } else if (rng() < THROWN_OUT_AT_HOME) {
              // 本塁憤死: 三塁走者アウト、打者は一塁セーフ（走塁死は投球回カウント済）
              bases[2] = null;
              bases[0] = batter;
            }
          }
          // 内野フライは走者進めず（単純アウト）
        }

        if (countAsAb) bl.ab++;
        }
      } else if (outcome === 'BB') {
        // 四死球のうち約9%を死球とする（進塁は四球と同じ）
        if (rng() < 0.09) {
          bl.hbp++;
          ps.line.hbp++;
          outDesc = '死球';
        } else {
          bl.bb++;
          ps.line.bb++;
          outDesc = '四球';
        }
        {
          const adv = advance(bases, outcome, batter, defense, rng);
          runsScored = adv.runs;
          outs += adv.outs; // 本塁憤死（走塁死も投球回にカウント）
          ps.line.outs += adv.outs;
        }
      } else {
        hits++;
        ps.line.hits++;
        bl.ab++;
        bl.hits++;
        if (outcome === '2B') bl.doubles++;
        if (outcome === '3B') bl.triples++;
        if (outcome === 'HR') {
          bl.hr++;
          ps.line.hr++;
        }
        {
          const adv = advance(bases, outcome, batter, defense, rng);
          runsScored = adv.runs;
          outs += adv.outs; // 本塁憤死（走塁死も投球回にカウント）
          ps.line.outs += adv.outs;
        }
      }
    }

    if (runsScored > 0) {
      runs += runsScored;
      ps.line.runs += runsScored;
      bl.rbi += runsScored;
    }

    log.push({
      inning,
      half,
      batterId: batter.player.id,
      batterName: batter.player.name,
      pitcherId: ps.player.id,
      pitcherName: ps.player.name,
      outcome,
      desc: OUTCOME_DESC[outcome],
      runsScored,
      outs,
      awayScoreBefore: half === 'T' ? offBefore : defBase,
      homeScoreBefore: half === 'T' ? defBase : offBefore,
      runnersOn,
      pitcherChanged,
      subType,
      outDesc,
    });

    // サヨナラ判定（ホーム裏で勝ち越したら即終了）。3アウト到達時は不成立
    if (outs < 3 && opts.walkOffThreshold !== undefined && runs >= opts.walkOffThreshold) {
      return { runs, hits, walkOff: true, fieldErrors };
    }
  }
  return { runs, hits, walkOff: false, fieldErrors };
}

/** 送りバントを仕掛けるか判断する */
function shouldBunt(
  inning: number,
  outsBefore: number,
  bases: Runner[],
  batter: Player,
  scoreDiff: number,
  orderPos: number,
  rng: () => number,
): boolean {
  if (outsBefore >= 2) return false;
  const firstOnly = !!bases[0] && !bases[1] && !bases[2];
  const firstSecond = !!bases[0] && !!bases[1] && !bases[2];
  if (!firstOnly && !firstSecond) return false;
  // 非強打者（パワー低め or 下位打線）
  const weak = batter.power < 65 || orderPos >= 6;
  if (!weak) return false;
  // 接戦のみ
  if (Math.abs(scoreDiff) > 1) return false;
  // 終盤ほど仕掛けやすい
  const prob = inning >= 7 ? 0.6 : 0.3;
  return rng() < prob;
}

/** 1試合をシミュレートする */
export function simulateGame(away: SideInput, home: SideInput, rng: () => number = Math.random): GameResult {
  const awaySide = new Side(away);
  const homeSide = new Side(home);
  const log: PlateAppearance[] = [];
  const innings: InningScore[] = [];

  let awayScore = 0;
  let homeScore = 0;
  let awayHits = 0;
  let homeHits = 0;
  let inning = 1;
  const MAX_INNING = 12;
  let extra = false;
  const fieldErrors: Record<string, number> = {};
  const mergeErrors = (src: Record<string, number>) => {
    for (const [id, n] of Object.entries(src)) fieldErrors[id] = (fieldErrors[id] ?? 0) + n;
  };

  while (true) {
    // 表（ビジター攻撃、ホームが守備）
    homeSide.maybeChangePitcher(inning, homeScore - awayScore);
    const top = playHalf(awaySide, homeSide, inning, 'T', log, rng, awayScore, homeScore);
    awayScore += top.runs;
    awayHits += top.hits;
    mergeErrors(top.fieldErrors);

    // 裏（ホーム攻撃、ビジターが守備）。9回以降でホームが既にリードしていればスキップ
    let bottom: HalfResult | null = null;
    const homeLeadsAfterTop = homeScore > awayScore;
    if (inning >= 9 && homeLeadsAfterTop) {
      // 9回裏以降でホームリード→裏なしで終了
      innings.push({ top: top.runs, bottom: null });
      break;
    }

    awaySide.maybeChangePitcher(inning, awayScore - homeScore);
    // サヨナラ閾値: 9回以降、勝ち越しに必要な点
    const walkOffThreshold = inning >= 9 ? awayScore - homeScore + 1 : undefined;
    bottom = playHalf(homeSide, awaySide, inning, 'B', log, rng, homeScore, awayScore, {
      walkOffThreshold,
    });
    homeScore += bottom.runs;
    homeHits += bottom.hits;
    mergeErrors(bottom.fieldErrors);

    innings.push({ top: top.runs, bottom: bottom.runs });

    // 終了判定
    if (inning >= 9) {
      if (homeScore !== awayScore) break; // 決着
      if (inning >= MAX_INNING) break; // 延長上限（引き分け）
    }
    if (inning >= 9) extra = true;
    inning++;
    if (inning > MAX_INNING) break;
  }

  const draw = awayScore === homeScore;
  const winnerId = draw ? null : awayScore > homeScore ? awaySide.team.id : homeSide.team.id;
  const loserId = draw ? null : awayScore > homeScore ? homeSide.team.id : awaySide.team.id;

  // 勝敗投手の簡易付与（勝ちチームの先発 or 最終投手 / 負けチームの先発）
  assignDecisions(awaySide, homeSide, awayScore, homeScore, draw);

  return {
    awayTeamId: awaySide.team.id,
    homeTeamId: homeSide.team.id,
    awayScore,
    homeScore,
    awayHits,
    homeHits,
    innings,
    winnerId,
    loserId,
    draw,
    extra,
    log,
    awayPitchers: [...awaySide.pitcherStates.values()].map((s) => s.line),
    homePitchers: [...homeSide.pitcherStates.values()].map((s) => s.line),
    awayBatters: awaySide.batters.map((b) => b.line),
    homeBatters: homeSide.batters.map((b) => b.line),
    fieldErrors,
  };
}

/** 勝敗・セーブ・ホールドの簡易付与 */
function assignDecisions(away: Side, home: Side, awayScore: number, homeScore: number, draw: boolean) {
  if (draw) return;
  const winnerSide = awayScore > homeScore ? away : home;
  const loserSide = awayScore > homeScore ? home : away;
  const lead = Math.abs(awayScore - homeScore);

  const winStates = [...winnerSide.pitcherStates.values()];
  const loseStates = [...loserSide.pitcherStates.values()];

  // 勝利投手: 先発が5回(15アウト)以上投げていれば先発、なければ最多アウトのリリーフ
  const winStarter = winStates[0];
  if (winStarter && winStarter.line.outs >= 15) {
    winStarter.line.win = true;
  } else {
    const best = [...winStates].sort((a, b) => b.line.outs - a.line.outs)[0];
    if (best) best.line.win = true;
  }

  // セーブ: 勝ちチームの最終投手が勝利投手でなく、3点差以内で締めた場合
  const lastWin = winStates[winStates.length - 1];
  if (lastWin && !lastWin.line.win && lead <= 3) {
    lastWin.line.save = true;
  }

  // ホールド: 勝ちチームの中継ぎ（先発・最終投手を除く中間登板）で、
  // 勝利投手でもセーブでもない投手。接戦（僅差）で投げた場合に付与（簡易）。
  if (lead <= 4) {
    const middle = winStates.slice(1, Math.max(1, winStates.length - 1));
    for (const ps of middle) {
      if (!ps.line.win && !ps.line.save && ps.line.outs > 0) {
        ps.line.hold = true;
      }
    }
  }

  // 負け投手: 先発（簡易）
  const loseStarter = loseStates[0];
  if (loseStarter) loseStarter.line.loss = true;
}
