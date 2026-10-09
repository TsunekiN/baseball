import { generateAllTeams } from '../src/domain/teamFactory';
import { generateSeason } from '../src/domain/seasonSchedule';

const teams = generateAllTeams();
const games = generateSeason(teams);

// 各チームの試合数
const count = new Map<string, number>();
const vs = new Map<string, Map<string, number>>();
teams.forEach((t) => {
  count.set(t.id, 0);
  vs.set(t.id, new Map());
});
for (const g of games) {
  count.set(g.awayId, count.get(g.awayId)! + 1);
  count.set(g.homeId, count.get(g.homeId)! + 1);
  const inc = (a: string, b: string) => {
    const m = vs.get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  inc(g.awayId, g.homeId);
  inc(g.homeId, g.awayId);
}

const name = (id: string) => teams.find((t) => t.id === id)!.nickName;

console.log('=== 各チーム試合数 ===');
let allOk = true;
teams.forEach((t) => {
  const c = count.get(t.id)!;
  if (c !== 143) allOk = false;
  console.log(`${name(t.id).padEnd(6)} ${c}`);
});
console.log('全チーム143試合:', allOk ? 'OK' : 'NG');

// 各日のカード数
const byDay = new Map<number, number>();
const dayTeams = new Map<number, Set<string>>();
for (const g of games) {
  byDay.set(g.day, (byDay.get(g.day) ?? 0) + 1);
  if (!dayTeams.has(g.day)) dayTeams.set(g.day, new Set());
  dayTeams.get(g.day)!.add(g.awayId);
  dayTeams.get(g.day)!.add(g.homeId);
}
const totalDays = byDay.size;
let dayOk = true;
for (const [, c] of byDay) if (c !== 6) dayOk = false;
let dayTeamOk = true;
for (const [, s] of dayTeams) if (s.size !== 12) dayTeamOk = false;
console.log('\n総日数:', totalDays, '（想定 20週*6 + 3週*6 + 5 = 120+18+5=143日）');
console.log('各日6カード:', dayOk ? 'OK' : 'NG');
console.log('各日全12球団が1試合:', dayTeamOk ? 'OK' : 'NG');

// 3連戦チェック: マイチーム視点で、通常週は同じ相手が3日連続か
const sample = teams[0];
const myGames = games
  .filter((g) => g.awayId === sample.id || g.homeId === sample.id)
  .sort((a, b) => a.day - b.day);
console.log(`\n=== ${name(sample.id)} の日程（最初の18試合） ===`);
myGames.slice(0, 18).forEach((g) => {
  const opp = g.awayId === sample.id ? g.homeId : g.awayId;
  const ha = g.homeId === sample.id ? '(ホ)' : '(ビ)';
  console.log(`日${String(g.day).padStart(3)} 週${g.week} ${ha} vs ${name(opp)}${g.interleague ? ' [交]' : ''}`);
});

// 対戦相手分布
console.log(`\n=== ${name(sample.id)} の対戦相手別試合数 ===`);
const m = vs.get(sample.id)!;
[...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, c]) => {
  console.log(`${name(id).padEnd(6)} ${c}`);
});
