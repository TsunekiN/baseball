// 成長エンジンの検証: 年齢×成長タイプごとに1年後(24週)の能力変化を測る
import { applyWeeklyGrowth } from '../src/domain/growthEngine';
import type { GrowthType, Player, Team } from '../src/domain/types';

function makeBatter(age: number, gt: GrowthType, base: number, talent: number, effort: number): Player {
  return {
    id: `t_${age}_${gt}_${base}`,
    name: 'テスト',
    position: 'OF',
    type: 'BATTER',
    age,
    growth_type: gt,
    contact: base, power: base, speed: base, defense: base,
    velocity: 140, breaking: 40, control: 40, stamina: 40,
    talent, effort, health: 60, luck: 60, adaptability: 0,
    is_foreign: false, country: 'JPN', debutYear: 2020,
  };
}

/** 外国人選手を作る（適応値で成長） */
function makeForeign(age: number, base: number, talent: number, adaptability: number): Player {
  return {
    id: `f_${age}_${base}_${adaptability}`,
    name: '外国人', position: 'OF', type: 'BATTER', age, growth_type: 'NORMAL',
    contact: base, power: base, speed: base, defense: base,
    velocity: 145, breaking: 40, control: 40, stamina: 40,
    talent, effort: 0, health: 60, luck: 60, adaptability,
    is_foreign: true, country: 'USA', debutYear: 2027,
  };
}

const gts: GrowthType[] = ['EARLY', 'NORMAL', 'LATE', 'SUSTAINED'];
const ages = [19, 21, 23, 26, 29, 32, 35, 38];
const REPEAT = 400;

console.log('=== 1年後(24週)の contact 平均変化 / 能力ベース70・才能70・努力70 ===');
console.log('age  ' + gts.map((g) => g.padEnd(10)).join(''));
for (const age of ages) {
  const row: string[] = [];
  for (const gt of gts) {
    let sum = 0;
    for (let i = 0; i < REPEAT; i++) {
      const p = makeBatter(age, gt, 70, 70, 70);
      const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
      const after = applyWeeklyGrowth([team], 24);
      sum += after[0].players[0].contact - 70;
    }
    row.push((sum / REPEAT).toFixed(2).padStart(6) + '    ');
  }
  console.log(String(age).padEnd(5) + row.join(''));
}

console.log('\n=== 高能力帯(A=88)の衰え耐性: 才能40 vs 才能95 (NORMAL, 35歳) ===');
for (const talent of [40, 95]) {
  let sum = 0;
  for (let i = 0; i < REPEAT; i++) {
    const p = makeBatter(35, 'NORMAL', 88, talent, 70);
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const after = applyWeeklyGrowth([team], 24);
    sum += after[0].players[0].contact - 88;
  }
  console.log(`才能${talent}: ${(sum / REPEAT).toFixed(2)}`);
}

console.log('\n=== 若手A(88)の頭打ち: 22歳 才能60 vs 才能95 ===');
for (const talent of [60, 95]) {
  let sum = 0;
  for (let i = 0; i < REPEAT; i++) {
    const p = makeBatter(22, 'NORMAL', 88, talent, 70);
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const after = applyWeeklyGrowth([team], 24);
    sum += after[0].players[0].contact - 88;
  }
  console.log(`才能${talent}: +${(sum / REPEAT).toFixed(2)}`);
}

console.log('\n=== 才能・努力の影響 (22歳 NORMAL 能力70 contact 1年) ===');
for (const [tal, eff] of [[30, 30], [60, 60], [99, 99], [30, 99], [99, 30]] as const) {
  let sum = 0;
  for (let i = 0; i < REPEAT; i++) {
    const p = makeBatter(22, 'NORMAL', 70, tal, eff);
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const after = applyWeeklyGrowth([team], 24);
    sum += after[0].players[0].contact - 70;
  }
  console.log(`才能${tal} 努力${eff}: +${(sum / REPEAT).toFixed(2)}`);
}

console.log('\n=== 同一選手の4能力の伸びの差 (22歳 NORMAL 能力70 才能70 努力70・複数選手ID) ===');
for (const idn of [1, 2, 3, 4, 5]) {
  const id = `sample_${idn}`;
  const acc = { contact: 0, power: 0, speed: 0, defense: 0 };
  for (let i = 0; i < REPEAT; i++) {
    const p: Player = {
      id, name: '', position: 'OF', type: 'BATTER', age: 22, growth_type: 'NORMAL',
      contact: 70, power: 70, speed: 70, defense: 70,
      velocity: 140, breaking: 40, control: 40, stamina: 40,
      talent: 70, effort: 70, health: 60, luck: 60, adaptability: 0, is_foreign: false, country: 'JPN', debutYear: 2027,
    };
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    acc.contact += a.contact - 70; acc.power += a.power - 70; acc.speed += a.speed - 70; acc.defense += a.defense - 70;
  }
  const f = (n: number) => (n / REPEAT >= 0 ? '+' : '') + (n / REPEAT).toFixed(1);
  console.log(`${id}: ミ${f(acc.contact)} パ${f(acc.power)} 走${f(acc.speed)} 守${f(acc.defense)}`);
}

console.log('\n=== 才能→能力上限(abilityCap) affinity 1.0基準 ===');
{ // 動的import回避のためrequire的に
  const { abilityCap } = await import('../src/domain/growthEngine');
  for (const tal of [30, 50, 70, 85, 99]) {
    console.log(`才能${tal}: 上限≈${abilityCap(tal, 1.0).toFixed(0)} (得意1.5:${abilityCap(tal, 1.5).toFixed(0)} / 不得意0.5:${abilityCap(tal, 0.5).toFixed(0)})`);
  }
}

console.log('\n=== 初期能力50・19歳スタートで各年の contact 推移 (NORMAL 才能75 努力70) ===');
{
  let p = makeBatter(19, 'NORMAL', 50, 75, 70);
  for (let yr = 0; yr < 14; yr++) {
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [structuredClone(p)], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    a.age = p.age + 1;
    p = a as Player;
    if (yr % 2 === 0 || yr >= 10) console.log(`${p.age}歳: ミ${p.contact.toFixed(1)}`);
  }
}

console.log('\n=== 努力の違いで到達スピード比較 (NORMAL 才能80・初期50・19歳→) 努力40 vs 90 ===');
for (const eff of [40, 65, 90]) {
  let p = makeBatter(19, 'NORMAL', 50, 80, eff);
  const marks: string[] = [];
  for (let yr = 0; yr < 15; yr++) {
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [structuredClone(p)], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    a.age = p.age + 1; p = a as Player;
    if ([25, 28, 31, 33].includes(p.age)) marks.push(`${p.age}歳:${p.contact.toFixed(0)}`);
  }
  console.log(`努力${eff}: ${marks.join('  ')}  (才能80のcontact上限は選手ID依存)`);
}

console.log('\n=== 外国人の適応値による1年(24週)変化 (28歳・能力50・才能70) ===');
for (const adapt of [20, 40, 50, 60, 80, 95]) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const p = makeForeign(28, 50, 70, adapt);
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    sum += a.contact - 50;
  }
  console.log(`適応${adapt}: ${(sum / 300 >= 0 ? '+' : '') + (sum / 300).toFixed(2)}`);
}

console.log('\n=== 外国人: 高適応(90)で上限超え確認 (28歳・能力50・才能50=上限約71) 5年推移 ===');
{
  let p = makeForeign(28, 50, 50, 90);
  for (let yr = 0; yr < 6; yr++) {
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [structuredClone(p)], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    a.age = p.age + 1;
    p = a as Player;
    console.log(`${p.age}歳: ミ${p.contact.toFixed(1)}`);
  }
}

console.log('\n=== 外国人の高齢衰え: 適応90・才能70・能力60 の年齢別1年変化 ===');
for (const age of [28, 32, 35, 38, 41]) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const p = makeForeign(age, 60, 70, 90);
    const team: Team = { id: 'x', name: '', shortName: '', nickName: '', markChar: '', league: 'CENTRAL', colorPrimary: '', players: [p], rosterLevel: {} };
    const a = applyWeeklyGrowth([team], 24)[0].players[0];
    sum += a.contact - 60;
  }
  console.log(`${age}歳: ${(sum / 300 >= 0 ? '+' : '') + (sum / 300).toFixed(2)}`);
}
