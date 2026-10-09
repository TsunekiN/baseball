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
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * 選手ごと・能力ごとの「適性係数」（0.35〜1.65）。
 * 得意な能力は伸びやすく衰えにくい、不得意な能力は伸びにくく衰えやすい。
 * player.id と能力名から決定的に決まる（隠しパラメータ／同じ選手は常に同じ）。
 */
export function abilityAffinity(playerId: string, key: string): number {
  return 0.35 + hash01(`${playerId}#${key}`) * 1.3; // 0.35〜1.65
}

/**
 * その能力の「到達可能な上限値」。才能(talent)が主に決め、能力ごとの適性(affinity)で
 * 大きくばらつく（得意能力は上限が高く、不得意能力は低い）。
 * 主要4能力の成長は95以上で極端に遅くなるが、ハード上限は120。
 *  才能30 → 概ね55、才能60 → 79、才能99 → 110 を基準に、適性で ±約15。
 */
export function abilityCap(talent: number, affinity: number): number {
  const base = 55 + ((talent - 30) / 69) * 55; // 才能30→55, 99→110
  const cap = base + (affinity - 1.0) * 22; // 適性で±約14（バラつき大きめ）
  return Math.max(40, Math.min(118, cap));
}

/**
 * 外国人選手の「年間の基本能力変化量」（適応値ベース・年齢によらない）。
 *  ・適応50 … ほぼ変化なし
 *  ・適応<50 … 衰え（50から離れるほど減衰大）
 *  ・適応>50 … 成長（50から離れるほど成長大）
 * 才能上限(abilityCap)は影響するが、適応が非常に高いと上限を超えて伸びる場合もある。
 */
function annualForeignDelta(player: Player, cur: number, affinity: number): number {
  const adapt = player.adaptability || 50;
  const factor = (adapt - 50) / 50; // -1.0〜+0.98
  // 1能力あたりの年あたり最大変化幅。4能力合計で適応99→約+60 / 適応0→約-60 を狙い base=15。
  const base = 15; // 年あたりの最大変化幅

  // 高齢による衰え（35歳以降は年齢で下降。適応が高くても高齢には勝てない）
  const ageDecline = player.age >= 35 ? -(player.age - 34) * 1.3 : 0;

  // 適応成分
  let adaptComponent: number;
  if (factor <= 0) {
    adaptComponent = factor * base; // 適応50以下は衰え方向（年齢によらず）
  } else {
    // 成長。才能上限で頭打ちだが、超高適応(>80)は上限を超えて伸ばせる
    const cap = abilityCap(player.talent, affinity);
    const overcap = adapt > 80 ? (adapt - 80) * 0.9 : 0; // 上限超過の許容幅
    const effectiveCap = cap + overcap;
    const room = effectiveCap - cur;
    const grow = factor * base;
    adaptComponent = room <= 0 ? 0 : Math.min(grow, room); // 上限に近いと鈍化
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
 * - cur < 95: 抑制なし (係数1.0)
 * - cur >= 95 かつ delta > 0（成長方向のみ）: 係数0.25
 * - delta <= 0（衰え方向）: 抑制なし
 */
function applyGrowthCap(cur: number, delta: number): number {
  if (delta <= 0) return delta; // 衰えは通常通り
  if (cur >= 95) return delta * 0.25;
  return delta;
}

/** 球速(km/h)を能力値換算する（velocity-80）。平均能力の計算・成長配分に使う。 */
function veloToAbility(velocity: number): number {
  return velocity - 80;
}

/**
 * 成長タイプ・年齢による年間成長カーブ（0〜1 程度）。
 * declineAge 以降は 0（衰えは別途計算）。成長期はピークで最大、ピーク前後は小さめ。
 */
function growthCurve(player: Player): number {
  const prof = PROFILES[player.growth_type];
  const age = player.age;
  if (age >= prof.declineAge) return 0;
  if (age < prof.growStartAge) return 0.6 * prof.growSpeed;
  if (age <= prof.peakEndAge) {
    const span = prof.peakEndAge - prof.growStartAge + 1;
    return (0.7 + 0.3 * ((prof.peakEndAge - age + 1) / span)) * prof.growSpeed;
  }
  return 0.3 * prof.growSpeed;
}

/**
 * 平均能力が「到達目標」に近づくにつれて成長を鈍化させる係数（0〜1）。
 * 到達目標 = 才能値 + 努力ボーナス（努力99で才能+15、努力に比例）。
 * 目標まで SPAN(=20) ポイント以上の余地があれば抑制なし(1)、近づくほど線形に低下し、
 * 平均が目標に達すると 0（ほぼ成長停止）。
 * これにより主要4能力の平均は、努力が高い選手で才能+10〜15、低い選手で才能付近に収束する。
 */
function talentSuppress(avgAbility: number, talent: number, effort: number): number {
  // 努力50を基準に、努力99→才能+15、努力50→才能ちょうど、努力50未満→才能に届かない（マイナス）。
  const effortBonus = ((effort - 50) / 49) * 15;
  const target = talent + effortBonus;
  const SPAN = 20;
  const room = target - avgAbility; // 正＝まだ伸びる余地
  return Math.max(0, Math.min(1, room / SPAN));
}

/**
 * その年に各能力へ配分する重み（毎年ランダム）。選手ID＋年齢＋能力名から決定的に算出。
 * 年齢が毎年変わるため「どの能力が大きく伸びるか」が年ごとに変化する。平均が1.0になるよう正規化。
 */
function yearlyWeights(playerId: string, age: number, keys: string[]): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    const w = 0.4 + hash01(`${playerId}#${age}#${k}`) * 1.2; // 0.4〜1.6
    raw[k] = w;
    sum += w;
  }
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (raw[k] / sum) * keys.length;
  return out;
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

  // 現在の平均能力（球速は velocity-80 換算）
  const abilityValue = (key: string) =>
    key === 'velocity' ? veloToAbility(p.velocity) : (p[key as keyof Player] as number);
  const avg = keys.reduce((s, k) => s + abilityValue(k), 0) / keys.length;

  if (p.age < prof.declineAge) {
    // === 成長期 ===
    // 努力に比例（0.3〜1.0）× 才能超過による抑制 × 成長タイプの年齢カーブ
    const effortMul = 0.3 + (p.effort / 99) * 0.7;
    const suppress = talentSuppress(avg, p.talent, p.effort);
    const curve = growthCurve(p);
    // 好条件（努力99=effortMul1.0 / 才能十分=suppress1.0 / 成長期ピーク=curve≈1.0）で
    // 4能力合計の年間増分が約40になるよう係数10.0に設定（1能力平均≈10×4）。
    const perAbilityAnnual = 10.0 * effortMul * suppress * curve; // 1能力あたり年間平均成長量
    const weights = yearlyWeights(p.id, p.age, keys);

    for (const key of keys) {
      const annual = perAbilityAnnual * weights[key];
      const perWeek = annual / SEASON_WEEKS;
      const jit = 0.25;
      if (key === 'velocity') {
        // 球速は終始1/4ペースでしか成長しない
        let v = p.velocity;
        for (let w = 0; w < weeks; w++) v += perWeek * 0.25 + jitter(jit * 0.1);
        p.velocity = clampAbility(v, 125, 170);
      } else {
        let v = p[key as keyof Player] as number;
        for (let w = 0; w < weeks; w++) {
          const base = perWeek + jitter(jit);
          v += applyGrowthCap(v, base);
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
    decline *= 2 - affinity; // 得意能力ほど衰えにくい
    decline = Math.max(decline, -11);
    const perWeek = decline / SEASON_WEEKS;
    const jit = 0.25 * affinity;
    if (key === 'velocity') {
      let v = p.velocity;
      for (let w = 0; w < weeks; w++) v += perWeek * 0.5 + jitter(jit * 0.5); // 衰えは通常通り
      p.velocity = clampAbility(v, 125, 170);
    } else {
      let v = p[key as keyof Player] as number;
      for (let w = 0; w < weeks; w++) v += perWeek + jitter(jit); // 衰えは通常通り
      (p as unknown as Record<string, number>)[key] = clampAbility(v, 20, 120);
    }
  }
}

/** 外国人選手の成長（適応値ベース）。主要4能力はMAX100・95以上で成長1/4抑制。 */
function growForeign(p: Player, weeks: number): void {
  // 95以上は成長1/4・衰えは通常通り
  const applyOneCapped = (cur: number, min: number, max: number, key: string): number => {
    const affinity = abilityAffinity(p.id, key);
    const delta = annualForeignDelta(p, cur, affinity);
    const perWeek = delta / SEASON_WEEKS;
    let v = cur;
    const jit = 0.3 * affinity;
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
    // 球速は終始1/4ペース
    const veloAff = abilityAffinity(p.id, 'velocity');
    const veloDelta = annualForeignDelta(p, (p.velocity - 125) * 2.5, veloAff) / SEASON_WEEKS;
    for (let w = 0; w < weeks; w++) p.velocity += veloDelta * 0.25 + jitter(0.08 * veloAff);
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
