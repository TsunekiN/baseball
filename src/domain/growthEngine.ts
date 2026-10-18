// ============================================================
// 週次成長エンジン
// 週の進行ごとに全選手（二軍含む）の能力を漸進的に変化させる。
// 若手は成長し、ベテランは衰える。年間目標は持たず、
// 毎週「年齢由来の基本変化 + ランダムばらつき」を適用する（バラツキ重視）。
// 年度末に行き過ぎ分の補正を別途行う（offseason側）。
// 能力は内部的に小数で保持し、表示時に四捨五入する。
// ============================================================

import type { GrowthType, Player, Team } from './types';

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
  const isPitcherKey = ['velocity', 'breaking', 'control', 'stamina'].includes(key);

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
        if (key === 'velocity') base = 1.50;
        else if (key === 'breaking') base = 1.05;
        else if (key === 'stamina') base = 0.85;
        else if (key === 'control') base = 0.60;
        break;
      case 'CONTROL_CRAFT':
        if (key === 'control') base = 1.50;
        else if (key === 'breaking') base = 1.15;
        else if (key === 'stamina') base = 0.80;
        else if (key === 'velocity') base = 0.55;
        break;
      case 'BREAKING_SPECIALIST':
        if (key === 'breaking') base = 1.50;
        else if (key === 'control') base = 1.05;
        else if (key === 'velocity') base = 0.85;
        else if (key === 'stamina') base = 0.60;
        break;
      case 'WORKHORSE':
        if (key === 'stamina') base = 1.50;
        else if (key === 'control') base = 1.10;
        else if (key === 'velocity') base = 0.80;
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
function annualForeignDelta(player: Player, cur: number, affinity: number, isVelocity = false): number {
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
      const effectiveCap = isVelocity ? Math.round(123 + cap * 0.4) : cap;
      const room = effectiveCap - cur;
      if (room > 0) {
        const brake = Math.min(1.0, Math.pow(room / (isVelocity ? 6 : 14), 1.3));
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

/** 球速(km/h)を能力値換算する（123km/hを0として0.4km/h=1pt）。 */
function veloToAbility(velocity: number): number {
  return (velocity - 123) / 0.4;
}

/**
 * 成長タイプ・年齢による年間成長カーブ（0〜1 程度）。
 * declineAge 以降は 0（衰えは別途計算）。
 */
function growthCurve(player: Player): number {
  const prof = PROFILES[player.growth_type];
  const age = player.age;
  if (age >= prof.declineAge) return 0;
  if (age < prof.growStartAge) return 0.55 * prof.growSpeed;
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
  const keys = isPitcher
    ? ['velocity', 'breaking', 'control', 'stamina']
    : ['contact', 'power', 'speed', 'defense'];

  // 現在の平均能力（球速は通常能力値換算）
  const abilityValue = (key: string) =>
    key === 'velocity' ? veloToAbility(p.velocity) : (p[key as keyof Player] as number);
  const avg = keys.reduce((s, k) => s + abilityValue(k), 0) / keys.length;

  if (p.age < prof.declineAge) {
    // === 成長期 ===
    const effortMul = 0.35 + (p.effort / 99) * 0.65;
    const curve = growthCurve(p);

    // 全体平均の才能超過ブレーキ
    const targetAvg = p.talent + ((p.effort - 50) / 49) * 3.5;
    const avgRoom = targetAvg - avg;
    const overallBrake = avgRoom <= 0 ? 0 : Math.min(1.0, Math.pow(avgRoom / 12, 1.2));

    // 年間ベース成長量（3.6pt/年を上限ベースに設定し、過剰成長を防止）
    const baseAnnual = 3.6;

    for (const key of keys) {
      const affinity = abilityAffinity(p.id, key);
      const cap = abilityCap(p.talent, affinity, p.effort);

      let currentVal: number;
      let room: number;
      let maxRoom: number;

      if (key === 'velocity') {
        currentVal = p.velocity;
        const veloCapKmh = Math.round(123 + cap * 0.4);
        room = veloCapKmh - currentVal;
        maxRoom = 6;
      } else {
        currentVal = p[key as keyof Player] as number;
        room = cap - currentVal;
        maxRoom = 14;
      }

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

      if (key === 'velocity') {
        let v = p.velocity;
        for (let w = 0; w < weeks; w++) v += perWeek * 0.25 + jitter(jit * 0.05);
        p.velocity = clampAbility(v, 125, 170);
      } else {
        let v = p[key as keyof Player] as number;
        for (let w = 0; w < weeks; w++) {
          const delta = perWeek + jitter(jit);
          if (delta > 0) {
            v += applyGrowthCap(v, delta);
          }
        }
        (p as unknown as Record<string, number>)[key] = clampAbility(v, 20, 120);
      }
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
    const perWeek = decline / SEASON_WEEKS;
    const jit = 0.25 * affinity;
    if (key === 'velocity') {
      let v = p.velocity;
      for (let w = 0; w < weeks; w++) v += perWeek * 0.5 + jitter(jit * 0.5);
      p.velocity = clampAbility(v, 125, 170);
    } else {
      let v = p[key as keyof Player] as number;
      for (let w = 0; w < weeks; w++) v += perWeek + jitter(jit);
      (p as unknown as Record<string, number>)[key] = clampAbility(v, 20, 120);
    }
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
    const veloAff = abilityAffinity(p.id, 'velocity');
    const veloDelta = annualForeignDelta(p, p.velocity, veloAff, true) / SEASON_WEEKS;
    for (let w = 0; w < weeks; w++) p.velocity += veloDelta * 0.25 + jitter(0.04 * veloAff);
    p.velocity = clampAbility(p.velocity, 125, 170);
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
