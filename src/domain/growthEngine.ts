// ============================================================
// 週次成長エンジン
// 週の進行ごとに全選手（二軍含む）の能力を漸進的に変化させる。
// 若手は成長し、ベテランは衰える。年間目標は持たず、
// 毎週「年齢由来の基本変化 + ランダムばらつき」を適用する（バラツキ重視）。
// 年度末に行き過ぎ分の補正を別途行う（offseason側）。
// 能力は内部的に小数で保持し、表示時に四捨五入する。
// ============================================================

import { calcStuff, calcVelocity, type GrowthType, type Player, type Team } from './types';
import { randInt } from './random';

/** レギュラーシーズンの週数（この週数で年間の変化を分割適用） */
const SEASON_WEEKS = 24;

/** 成長タイプごとの成長開始・ピーク終了・衰え開始年齢 */
interface GrowthProfile {
  growStartAge: number; // この年齢からピークの伸び（それ以前は緩やか成長）
  peakEndAge: number; // この年齢まで成長（以降ピーク維持）
  declineAge: number; // この年齢から衰え開始
  growSpeed: number; // 成長期の伸びやすさ倍率
  declineSpeed: number; // 衰え期の落ちやすさ倍率
}

const PROFILES: Record<GrowthType, GrowthProfile> = {
  // 早熟: 急成長22-25、25-30維持、30+衰え
  EARLY: { growStartAge: 22, peakEndAge: 25, declineAge: 30, growSpeed: 1.35, declineSpeed: 1.15 },
  // 普通: 成長22-28、28-33維持、33+衰え
  NORMAL: { growStartAge: 22, peakEndAge: 28, declineAge: 33, growSpeed: 1.0, declineSpeed: 1.0 },
  // 晩成: 成長25-31、31-36維持、36+衰え
  LATE: { growStartAge: 25, peakEndAge: 31, declineAge: 36, growSpeed: 0.9, declineSpeed: 0.85 },
  // 持続: 成長22-30、30-35維持、35+緩やか衰え
  SUSTAINED: { growStartAge: 22, peakEndAge: 30, declineAge: 35, growSpeed: 1.0, declineSpeed: 0.7 },
};

/** 決定的ハッシュ（文字列→0..1）。選手ごとの能力適性を固定するため。 */
export function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export type BatterArchetype = 'SLUGGER' | 'CONTACT' | 'SPEED_DEFENSE' | 'DEFENSIVE' | 'BALANCED';
export type PitcherArchetype = 'FLAMETHROWER' | 'CONTROL_CRAFT' | 'BREAKING_SPECIALIST' | 'WORKHORSE' | 'BALANCED';

/** 守備位置と選手IDから野手アーキタイプ（個性・役割）を決定論的に判定 */
export function getBatterArchetype(playerId: string, pos?: string): BatterArchetype {
  const h = hash01(`${playerId}#archetype`);
  if (pos === '1B' || pos === 'DH') {
    if (h < 0.60) return 'SLUGGER';
    if (h < 0.85) return 'CONTACT';
    return 'BALANCED';
  }
  if (pos === '3B') {
    if (h < 0.45) return 'SLUGGER';
    if (h < 0.75) return 'CONTACT';
    return 'BALANCED';
  }
  if (pos === 'C') {
    if (h < 0.40) return 'DEFENSIVE';
    if (h < 0.65) return 'SLUGGER';
    if (h < 0.85) return 'CONTACT';
    return 'BALANCED';
  }
  if (pos === 'SS' || pos === '2B') {
    if (h < 0.40) return 'SPEED_DEFENSE';
    if (h < 0.70) return 'CONTACT';
    if (h < 0.85) return 'DEFENSIVE';
    return 'BALANCED';
  }
  if (pos === 'OF') {
    if (h < 0.35) return 'SPEED_DEFENSE';
    if (h < 0.65) return 'SLUGGER';
    if (h < 0.85) return 'CONTACT';
    return 'BALANCED';
  }
  if (h < 0.30) return 'SLUGGER';
  if (h < 0.55) return 'CONTACT';
  if (h < 0.75) return 'SPEED_DEFENSE';
  if (h < 0.90) return 'DEFENSIVE';
  return 'BALANCED';
}

/** 投手アーキタイプ（個性・投球スタイル）を決定論的に判定 */
export function getPitcherArchetype(playerId: string): PitcherArchetype {
  const h = hash01(`${playerId}#pitcher_archetype`);
  if (h < 0.25) return 'FLAMETHROWER';
  if (h < 0.50) return 'CONTROL_CRAFT';
  if (h < 0.75) return 'BREAKING_SPECIALIST';
  if (h < 0.90) return 'WORKHORSE';
  return 'BALANCED';
}

/**
 * 選手ごと・能力ごとの「適性係数」（0.45〜1.55）。
 * アーキタイプ（個性）に応じて得意能力に高い適性（上限が高く成長しやすい）、
 * 不得意能力に低い適性（上限が低く成長しにくい）を付与。
 * これにより全4能力が平均化することを完全に防止し、生涯にわたって強い個性を維持する。
 */
export function abilityAffinity(playerId: string, key: string): number {
  const isPitcherKey = ['stuff', 'velocity', 'breaking', 'control', 'stamina'].includes(key);

  let base = 1.0;
  if (!isPitcherKey) {
    const arch = getBatterArchetype(playerId);
    switch (arch) {
      case 'SLUGGER':
        if (key === 'power') base = 1.48;
        else if (key === 'contact') base = 1.02;
        else if (key === 'defense') base = 0.85;
        else if (key === 'speed') base = 0.65;
        break;
      case 'CONTACT':
        if (key === 'contact') base = 1.48;
        else if (key === 'speed') base = 1.08;
        else if (key === 'defense') base = 0.84;
        else if (key === 'power') base = 0.60;
        break;
      case 'SPEED_DEFENSE':
        if (key === 'speed') base = 1.50;
        else if (key === 'defense') base = 1.20;
        else if (key === 'contact') base = 0.80;
        else if (key === 'power') base = 0.50;
        break;
      case 'DEFENSIVE':
        if (key === 'defense') base = 1.50;
        else if (key === 'speed') base = 0.95;
        else if (key === 'contact') base = 0.85;
        else if (key === 'power') base = 0.70;
        break;
      case 'BALANCED':
      default: {
        const h = hash01(`${playerId}#bal#${key}`);
        base = 0.85 + h * 0.30;
        break;
      }
    }
  } else {
    const arch = getPitcherArchetype(playerId);
    switch (arch) {
      case 'FLAMETHROWER':
        if (key === 'stuff' || key === 'velocity') base = 1.50;
        else if (key === 'breaking') base = 1.05;
        else if (key === 'stamina') base = 0.85;
        else if (key === 'control') base = 0.60;
        break;
      case 'CONTROL_CRAFT':
        if (key === 'control') base = 1.50;
        else if (key === 'breaking') base = 1.15;
        else if (key === 'stamina') base = 0.80;
        else if (key === 'stuff' || key === 'velocity') base = 0.55;
        break;
      case 'BREAKING_SPECIALIST':
        if (key === 'breaking') base = 1.50;
        else if (key === 'control') base = 1.05;
        else if (key === 'stuff' || key === 'velocity') base = 0.85;
        else if (key === 'stamina') base = 0.60;
        break;
      case 'WORKHORSE':
        if (key === 'stamina') base = 1.50;
        else if (key === 'control') base = 1.10;
        else if (key === 'stuff' || key === 'velocity') base = 0.80;
        else if (key === 'breaking') base = 0.60;
        break;
      case 'BALANCED':
      default: {
        const h = hash01(`${playerId}#pbal#${key}`);
        base = 0.85 + h * 0.30;
        break;
      }
    }
  }

  const jit = (hash01(`${playerId}#jit#${key}`) - 0.5) * 0.08;
  return Math.max(0.45, Math.min(1.6, base + jit));
}

/**
 * その能力の「到達可能な上限値（ハードキャップ・基準値）」。
 * 才能(talent)がベースを決め、適性(affinity)で±18〜22ポイントの大差がつく。
 * 才能に基づくブレーキにより、才能を超えて全能力がインフレすることを強力に防止する。
 */
export function abilityCap(talent: number, affinity: number, effort = 50): number {
  const effortBonus = ((effort - 50) / 49) * 3.5;
  const cap = talent + (affinity - 1.0) * 22 + effortBonus;
  return Math.max(25, Math.min(105, cap));
}

/**
 * 外国人選手の「年間の基本能力変化量」（適応値ベース）。
 * 才能・適性に応じた個別天井ブレーキを適用し、過剰成長を抑制。
 */
function annualForeignDelta(player: Player, cur: number, affinity: number): number {
  const adapt = player.adaptability || 50;
  const factor = (adapt - 50) / 50; // -1.0〜+0.98
  const base = 4.5; // 年あたりの最大変化幅

  // 高齢による衰え
  let ageDecline = 0;
  if (player.age >= 34) {
    const years = player.age - 33;
    ageDecline = -1.6 * years * (2 - affinity);
    ageDecline = Math.max(ageDecline, -10);
  }

  let adaptComponent = 0;
  if (factor <= 0) {
    adaptComponent = factor * base;
  } else {
    if (player.age < 34) {
      const cap = abilityCap(player.talent, affinity, 50);
      const room = cap - cur;
      if (room > 0) {
        const brake = Math.min(1.0, Math.pow(room / 14, 1.3));
        adaptComponent = factor * base * brake;
      }
    }
  }

  return adaptComponent + ageDecline;
}

/** 小さなランダム揺らぎ（平均0） */
function jitter(scale: number): number {
  return (Math.random() - 0.5) * 2 * scale;
}

/** 能力値を下限・上限でクランプ */
function clampAbility(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 成長量に対して「95以上で1/4抑制」を適用して返す。
 */
function applyGrowthCap(cur: number, delta: number): number {
  if (delta <= 0) return delta;
  if (cur >= 95) return delta * 0.25;
  return delta;
}


/**
 * 成長タイプ・年齢による年間成長カーブ（0〜1 程度）。
 * declineAge 以降は 0（衰えは別途計算）。
 */
function growthCurve(player: Player): number {
  const prof = PROFILES[player.growth_type];
  const age = player.age;
  if (age >= prof.declineAge) return 0;
  if (age < prof.growStartAge) return 1.0 * prof.growSpeed;
  if (age <= prof.peakEndAge) {
    const span = prof.peakEndAge - prof.growStartAge + 1;
    return (0.7 + 0.3 * ((prof.peakEndAge - age + 1) / span)) * prof.growSpeed;
  }
  return 0.3 * prof.growSpeed;
}

/** 1人の選手に「weeks週分」の成長/衰えを適用（能力をミューテート） */
function growPlayer(p: Player, weeks: number): void {
  if (p.is_foreign) {
    growForeign(p, weeks);
    return;
  }

  const prof = PROFILES[p.growth_type];
  const isPitcher = p.type === 'PITCHER';
  if (isPitcher && (p.stuff == null || isNaN(p.stuff))) {
    p.stuff = calcStuff(p.velocity);
  }

  const keys = isPitcher
    ? ['stuff', 'breaking', 'control', 'stamina']
    : ['contact', 'power', 'speed', 'defense'];

  // 現在の平均能力（投手は球威を含む4能力値の平均）
  const avg = keys.reduce((s, k) => s + (p[k as keyof Player] as number), 0) / keys.length;

  if (p.age < prof.declineAge) {
    // === 成長期 ===
    const effortMul = 0.35 + (p.effort / 99) * 0.65;
    const curve = growthCurve(p);

    // 全体平均の才能超過ブレーキ
    const targetAvg = p.talent + ((p.effort - 50) / 49) * 3.5;
    const avgRoom = targetAvg - avg;
    const overallBrake = avgRoom <= 0 ? 0 : Math.min(1.0, Math.pow(avgRoom / 12, 1.2));

    // 年間ベース成長量（29歳までは5.0、30歳以降は3.0）
    const baseAnnual = p.age <= 29 ? 5.0 : 3.0;

    for (const key of keys) {
      const affinity = abilityAffinity(p.id, key);
      const cap = abilityCap(p.talent, affinity, p.effort);

      const currentVal = p[key as keyof Player] as number;
      const room = cap - currentVal;
      const maxRoom = 14;

      // 個別能力の上限ブレーキ: 上限到達で完全停止、近づくほど急激に減速
      if (room <= 0) {
        continue;
      }
      const individualBrake = Math.min(1.0, Math.pow(room / maxRoom, 1.4));

      // 総合ブレーキ（個別天井ブレーキ × 全体平均ブレーキ）
      const totalBrake = individualBrake * (0.2 + 0.8 * overallBrake);

      // 適性による成長重み（得意能力ほど成長リソースが集中し、弱点は伸びにくい）
      const weight = Math.pow(affinity, 2.0);

      const annual = baseAnnual * effortMul * curve * totalBrake * weight;
      const perWeek = annual / SEASON_WEEKS;
      const jit = 0.12 * affinity;

      // 球威は上がりにくい能力値なので、週次加速係数を0.5に設定
      const weeklyFactor = key === 'stuff' ? 0.5 : 1.0;

      let v = currentVal;
      for (let w = 0; w < weeks; w++) {
        const delta = perWeek * weeklyFactor + jitter(jit);
        if (delta > 0) {
          v += applyGrowthCap(v, delta);
        }
      }
      (p as unknown as Record<string, number>)[key] = clampAbility(v, 20, 120);
    }

    if (isPitcher) {
      p.velocity = calcVelocity(p.stuff);
    }
    return;
  }

  // === 衰え期 ===
  const years = p.age - prof.declineAge + 1;
  for (const key of keys) {
    const affinity = abilityAffinity(p.id, key);
    let decline = -1.6 * years * prof.declineSpeed;
    decline *= 2 - affinity; // 得意能力ほど衰えにくい（個性の維持）
    decline = Math.max(decline, -11);

    const weeklyFactor = key === 'stuff' ? 0.5 : 1.0;
    const perWeek = (decline * weeklyFactor) / SEASON_WEEKS;
    const jit = 0.25 * affinity;

    let v = p[key as keyof Player] as number;
    for (let w = 0; w < weeks; w++) v += perWeek + jitter(jit);
    (p as unknown as Record<string, number>)[key] = clampAbility(v, 20, 120);
  }

  if (isPitcher) {
    p.velocity = calcVelocity(p.stuff);
  }
}

/** 外国人選手の成長（適応値ベース）。 */
function growForeign(p: Player, weeks: number): void {
  const applyOneCapped = (cur: number, min: number, max: number, key: string): number => {
    const affinity = abilityAffinity(p.id, key);
    const delta = annualForeignDelta(p, cur, affinity);
    const perWeek = delta / SEASON_WEEKS;
    let v = cur;
    const jit = 0.2 * affinity;
    for (let w = 0; w < weeks; w++) {
      const base = perWeek + jitter(jit);
      v += applyGrowthCap(v, base);
    }
    return clampAbility(v, min, max);
  };
  if (p.type === 'BATTER') {
    p.contact = applyOneCapped(p.contact, 20, 120, 'contact');
    p.power = applyOneCapped(p.power, 20, 120, 'power');
    p.speed = applyOneCapped(p.speed, 20, 120, 'speed');
    p.defense = applyOneCapped(p.defense, 20, 120, 'defense');
  } else {
    if (p.stuff == null || isNaN(p.stuff)) {
      p.stuff = calcStuff(p.velocity);
    }
    const stuffAff = abilityAffinity(p.id, 'stuff');
    const stuffDelta = annualForeignDelta(p, p.stuff, stuffAff) / SEASON_WEEKS;
    for (let w = 0; w < weeks; w++) p.stuff += stuffDelta * 0.5 + jitter(0.04 * stuffAff);
    p.stuff = clampAbility(p.stuff, 20, 120);
    p.velocity = calcVelocity(p.stuff);

    p.breaking = applyOneCapped(p.breaking, 20, 120, 'breaking');
    p.control = applyOneCapped(p.control, 20, 120, 'control');
    p.stamina = applyOneCapped(p.stamina, 20, 120, 'stamina');
  }
}

/**
 * 全チームの全選手に weeks 週分の成長/衰えを適用した新しいチーム配列を返す。
 * 元の配列・選手はミューテートしない（structuredCloneで複製）。
 */
export function applyWeeklyGrowth(teams: Team[], weeks: number): Team[] {
  if (weeks <= 0) return teams;
  const next: Team[] = structuredClone(teams);
  for (const team of next) {
    for (const p of team.players) {
      growPlayer(p, weeks);
    }
  }
  return next;
}

/** 上限(cap)を超えた分を圧縮する（行き過ぎ補正）。cur<=capはそのまま。 */
/**
 * 年度末の加齢処理。全選手の年齢を+1する。
 * 成長抑制は週次成長エンジン側（平均能力 vs 才能値）で行うため、ここでは上限補正は行わない。
 * 元の配列・選手はミューテートしない。
 */
export function applyAgingAdjustment(teams: Team[]): Team[] {
  const next: Team[] = structuredClone(teams);
  for (const team of next) {
    for (const p of team.players) {
      p.age += 1;
    }
  }
  return next;
}

export interface AwakeningStatDelta {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
}

export interface AwakeningPlayerDetail {
  playerId: string;
  playerName: string;
  teamId: string;
  teamNick: string;
  age: number;
  position: string;
  type: 'BATTER' | 'PITCHER';
  growthSummary: string;
  statDeltas: AwakeningStatDelta[];
}

export interface SpringCampReport {
  year: number;
  awakenings: AwakeningPlayerDetail[];
}

/**
 * 春季キャンプ覚醒イベント（開幕直前適用）。
 * 自チーム（myTeamId）の25歳以下の若手選手から、野手1名・投手1名をランダムに選出し、
 * アーキタイプ得意能力を中心に大幅な急成長（ブレイクスルー）を付与する。
 */
export function applySpringCamp(
  teams: Team[],
  year: number,
  myTeamId?: string | null
): { teams: Team[]; report: SpringCampReport } {
  const nextTeams: Team[] = structuredClone(teams);
  const awakenings: AwakeningPlayerDetail[] = [];

  const targetTeams = myTeamId ? nextTeams.filter((t) => t.id === myTeamId) : nextTeams;

  for (const team of targetTeams) {
    // 25歳以下の野手・投手候補を抽出
    const youngBatters = team.players.filter((p) => p.age <= 25 && p.type === 'BATTER');
    const youngPitchers = team.players.filter((p) => p.age <= 25 && p.type === 'PITCHER');

    // 野手覚醒（1名）
    if (youngBatters.length > 0) {
      const targetBatter = youngBatters[randInt(0, youngBatters.length - 1)];
      const statDeltas: AwakeningStatDelta[] = [];
      const keys = ['contact', 'power', 'speed', 'defense'] as const;
      const labels: Record<string, string> = {
        contact: 'ミート',
        power: 'パワー',
        speed: '走力',
        defense: '守備力',
      };

      // 得意能力（affinity順）にソート
      const sortedKeys = [...keys].sort(
        (a, b) => abilityAffinity(targetBatter.id, b) - abilityAffinity(targetBatter.id, a)
      );

      // 第1得意能力に +7〜+9、第2に +5〜+7、他2つに +3〜+5
      const boostMap: Record<string, number> = {
        [sortedKeys[0]]: randInt(7, 9),
        [sortedKeys[1]]: randInt(5, 7),
        [sortedKeys[2]]: randInt(3, 5),
        [sortedKeys[3]]: randInt(3, 5),
      };

      for (const k of keys) {
        const before = targetBatter[k];
        const gain = boostMap[k];
        const after = clampAbility(before + gain, 20, 120);
        targetBatter[k] = after;
        statDeltas.push({
          key: k,
          label: labels[k],
          before: Math.round(before),
          after: Math.round(after),
          delta: Math.round(after) - Math.round(before),
        });
      }

      // 才能値・努力値の底上げ（今後の上限キャップによる停滞を防ぐ）
      const newAvg = (targetBatter.contact + targetBatter.power + targetBatter.speed + targetBatter.defense) / 4;
      targetBatter.talent = Math.min(99, Math.max(targetBatter.talent, Math.round(newAvg + 6)) + randInt(2, 4));
      targetBatter.effort = Math.min(99, targetBatter.effort + randInt(3, 6));

      const summaryParts = statDeltas
        .filter((d) => d.delta > 0)
        .map((d) => `${d.label}+${d.delta}`);

      awakenings.push({
        playerId: targetBatter.id,
        playerName: targetBatter.name,
        teamId: team.id,
        teamNick: team.nickName,
        age: targetBatter.age,
        position: targetBatter.position,
        type: 'BATTER',
        growthSummary: summaryParts.join(', '),
        statDeltas,
      });
    }

    // 投手覚醒（1名）
    if (youngPitchers.length > 0) {
      const targetPitcher = youngPitchers[randInt(0, youngPitchers.length - 1)];
      const statDeltas: AwakeningStatDelta[] = [];

      // 投手覚醒（1名）
      if (targetPitcher.stuff == null || isNaN(targetPitcher.stuff)) {
        targetPitcher.stuff = calcStuff(targetPitcher.velocity);
      }
      const veloBefore = targetPitcher.velocity;
      const veloGain = randInt(2, 4);
      // 球速+2〜4km/h に対応する球威加算（球威 ＝ (球速 - 124) * 2.5 なので deltaは veloGain * 2.5）
      const stuffGain = veloGain * 2.5;
      const stuffAfter = clampAbility(targetPitcher.stuff + stuffGain, 20, 120);
      targetPitcher.stuff = stuffAfter;
      const veloAfter = calcVelocity(stuffAfter);
      targetPitcher.velocity = veloAfter;

      statDeltas.push({
        key: 'velocity',
        label: '球速',
        before: Math.round(veloBefore),
        after: Math.round(veloAfter),
        delta: Math.round(veloAfter) - Math.round(veloBefore),
      });

      // 変化球・制球・スタミナ
      const pitchKeys = ['breaking', 'control', 'stamina'] as const;
      const pitchLabels: Record<string, string> = {
        breaking: '変化球',
        control: '制球',
        stamina: 'スタミナ',
      };

      const sortedPitchKeys = [...pitchKeys].sort(
        (a, b) => abilityAffinity(targetPitcher.id, b) - abilityAffinity(targetPitcher.id, a)
      );

      const boostPitchMap: Record<string, number> = {
        [sortedPitchKeys[0]]: randInt(7, 9),
        [sortedPitchKeys[1]]: randInt(5, 7),
        [sortedPitchKeys[2]]: randInt(3, 5),
      };

      for (const k of pitchKeys) {
        const before = targetPitcher[k];
        const gain = boostPitchMap[k];
        const after = clampAbility(before + gain, 20, 120);
        targetPitcher[k] = after;
        statDeltas.push({
          key: k,
          label: pitchLabels[k],
          before: Math.round(before),
          after: Math.round(after),
          delta: Math.round(after) - Math.round(before),
        });
      }

      // 才能値・努力値の底上げ（球威を含む主要4能力の平均ベース）
      const newPitchAvg =
        (targetPitcher.stuff + targetPitcher.breaking + targetPitcher.control + targetPitcher.stamina) / 4;
      targetPitcher.talent = Math.min(99, Math.max(targetPitcher.talent, Math.round(newPitchAvg + 6)) + randInt(2, 4));
      targetPitcher.effort = Math.min(99, targetPitcher.effort + randInt(3, 6));

      const summaryParts = statDeltas
        .filter((d) => d.delta > 0)
        .map((d) => (d.key === 'velocity' ? `球速+${d.delta}km/h` : `${d.label}+${d.delta}`));

      awakenings.push({
        playerId: targetPitcher.id,
        playerName: targetPitcher.name,
        teamId: team.id,
        teamNick: team.nickName,
        age: targetPitcher.age,
        position: targetPitcher.position,
        type: 'PITCHER',
        growthSummary: summaryParts.join(', '),
        statDeltas,
      });
    }
  }

  return {
    teams: nextTeams,
    report: {
      year,
      awakenings,
    },
  };
}
