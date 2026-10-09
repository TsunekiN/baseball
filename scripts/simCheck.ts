import { generateAllTeams } from '../src/domain/teamFactory';
import { buildBestOrder } from '../src/domain/orderFactory';
import { simulateGame, type SideInput } from '../src/match/simulate';
import type { Team, TeamOrder } from '../src/domain/types';

// 決定的乱数（検証の再現性）
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const teams = generateAllTeams();
const orders = new Map<string, TeamOrder>();
teams.forEach((t) => orders.set(t.id, buildBestOrder(t)));
const side = (t: Team): SideInput => ({ team: t, order: orders.get(t.id)! });

// 集計
let totalGames = 0;
let totalRuns = 0;
let sumAb = 0;
let sumHits = 0;
let sumHr = 0;
let sumOuts = 0;
let sumPitRuns = 0;
let sumSo = 0;
let sumBb = 0;
let sumSb = 0;
let sumHbp = 0;
let sumSf = 0;

// 打者個別の盗塁集計（走力との相関確認用）
interface BAgg { name: string; speed: number; sb: number; }
const bat = new Map<string, BAgg>();

// 投手個別集計（防御率レンジ確認用）
interface PAgg { name: string; dom: number; outs: number; runs: number; so: number; }
const pit = new Map<string, PAgg>();

function veloScore(kmh: number) { return Math.max(0, Math.min(120, (kmh - 125) * 2.5)); }
function dom(p: { velocity: number; breaking: number; control: number }) {
  return veloScore(p.velocity) * 0.35 + p.breaking * 0.35 + p.control * 0.3;
}

// 総当たり × 繰り返し（repごとに別シードでサンプルを分散し、測定を安定化）
const REPEAT = 30;
for (let rep = 0; rep < REPEAT; rep++) {
  const rng = mulberry32(12345 + rep * 7919);
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      const res = simulateGame(side(teams[j]), side(teams[i]), rng); // away=j, home=i
      totalGames++;
      totalRuns += res.awayScore + res.homeScore;

      const allTeamPlayers = teams.flatMap((t) => t.players);
      for (const bl of [...res.awayBatters, ...res.homeBatters]) {
        sumAb += bl.ab; sumHits += bl.hits; sumHr += bl.hr; sumSb += bl.sb; sumHbp += bl.hbp; sumSf += bl.sf;
        const bp = allTeamPlayers.find((p) => p.id === bl.playerId)!;
        const bagg = bat.get(bl.playerId) ?? { name: bl.name, speed: bp.speed, sb: 0 };
        bagg.sb += bl.sb;
        bat.set(bl.playerId, bagg);
      }
      for (const pl of [...res.awayPitchers, ...res.homePitchers]) {
        sumOuts += pl.outs; sumPitRuns += pl.runs; sumSo += pl.so; sumBb += pl.bb;
        const teamPlayers = teams.flatMap((t) => t.players);
        const pp = teamPlayers.find((p) => p.id === pl.playerId)!;
        const agg = pit.get(pl.playerId) ?? { name: pl.name, dom: dom(pp), outs: 0, runs: 0, so: 0 };
        agg.outs += pl.outs; agg.runs += pl.runs; agg.so += pl.so;
        pit.set(pl.playerId, agg);
      }
    }
  }
}

const ip = sumOuts / 3;
console.log('=== リーグ全体 ===');
console.log('試合数:', totalGames);
console.log('平均得点/試合(両チーム計):', (totalRuns / totalGames).toFixed(2));
console.log('平均得点/チーム/試合:', (totalRuns / totalGames / 2).toFixed(2));
console.log('リーグ打率:', (sumHits / sumAb).toFixed(3));
console.log('本塁打率(HR/AB):', (sumHr / sumAb).toFixed(3), ' HR合計:', sumHr);
console.log('リーグ防御率:', ((sumPitRuns * 9) / ip).toFixed(2));
console.log('9回あたり奪三振(K/9):', ((sumSo * 9) / ip).toFixed(2));
console.log('9回あたり四球(BB/9):', ((sumBb * 9) / ip).toFixed(2));
console.log('盗塁合計:', sumSb, ' 盗塁/試合(1チーム):', (sumSb / (totalGames * 2)).toFixed(2));
console.log('死球/試合(1チーム):', (sumHbp / (totalGames * 2)).toFixed(2), ' 犠飛/試合(1チーム):', (sumSf / (totalGames * 2)).toFixed(2));

// 走力上位の盗塁（143試合換算）。totalGamesは片側視点の総ゲーム。1選手の出場は概ね全試合。
const gamesPerTeam = (totalGames * 2) / teams.length; // 1チームの総試合数
const seasonScale = 143 / gamesPerTeam;
console.log('\n=== 走力上位10の盗塁（143試合換算） ===');
[...bat.values()]
  .sort((a, b) => b.speed - a.speed)
  .slice(0, 10)
  .forEach((a) => {
    console.log(`走力=${a.speed}  盗塁(換算)=${(a.sb * seasonScale).toFixed(0)}  実sb=${a.sb}  ${a.name}`);
  });

// 投手を能力(dom)順に、十分なIPのみ
const qualified = [...pit.values()].filter((a) => a.outs >= 60).sort((a, b) => b.dom - a.dom);
console.log('\n=== 投手 能力上位10（防御率） ===');
qualified.slice(0, 10).forEach((a) => {
  const era = (a.runs * 9) / (a.outs / 3);
  console.log(`dom=${a.dom.toFixed(0)}  防御率=${era.toFixed(2)}  IP=${(a.outs / 3).toFixed(0)}  ${a.name}`);
});
console.log('\n=== 投手 能力下位5（防御率） ===');
qualified.slice(-5).forEach((a) => {
  const era = (a.runs * 9) / (a.outs / 3);
  console.log(`dom=${a.dom.toFixed(0)}  防御率=${era.toFixed(2)}  IP=${(a.outs / 3).toFixed(0)}  ${a.name}`);
});
