// タイトル表彰の検証: 1シーズンを実日程で消化し、セ・パのタイトル受賞者を表示
import { generateAllTeams } from '../src/domain/teamFactory';
import { buildBestOrder } from '../src/domain/orderFactory';
import { generateSeason } from '../src/domain/seasonSchedule';
import { simulateGame, type SideInput } from '../src/match/simulate';
import { emptyBatting, emptyPitching, accumulateBatting, accumulatePitching, type PlayerSeasonStats } from '../src/match/matchStats';
import { awardTitles } from '../src/domain/titleAward';
import { TITLE_DEFS } from '../src/domain/stats';
import type { GameState } from '../src/domain/gameState';
import type { Team, TeamOrder } from '../src/domain/types';

const teams = generateAllTeams();
const orders = new Map<string, TeamOrder>();
teams.forEach((t) => orders.set(t.id, buildBestOrder(t)));
const side = (t: Team): SideInput => ({ team: t, order: orders.get(t.id)! });
const teamMap = new Map(teams.map((t) => [t.id, t]));

const schedule = generateSeason(teams);
const playerStats: Record<string, PlayerSeasonStats> = {};
const records: Record<string, { wins: number; losses: number; draws: number }> = {};
for (const t of teams) records[t.id] = { wins: 0, losses: 0, draws: 0 };

const getStats = (id: string) => (playerStats[id] ??= {});

for (const g of schedule) {
  const away = teamMap.get(g.awayId)!;
  const home = teamMap.get(g.homeId)!;
  const res = simulateGame(side(away), side(home), Math.random);
  for (const bl of [...res.awayBatters, ...res.homeBatters]) {
    const s = getStats(bl.playerId);
    (s.batting ??= emptyBatting());
    accumulateBatting(s.batting, bl);
  }
  for (const pl of [...res.awayPitchers, ...res.homePitchers]) {
    const s = getStats(pl.playerId);
    (s.pitching ??= emptyPitching());
    accumulatePitching(s.pitching, pl);
  }
  if (res.draw) { records[g.awayId].draws++; records[g.homeId].draws++; }
  else if (res.winnerId === g.homeId) { records[g.homeId].wins++; records[g.awayId].losses++; }
  else { records[g.awayId].wins++; records[g.homeId].losses++; }
}

const state = {
  teams, records, playerStats, playerCareers: {}, seasonHistory: [], year: 2027,
} as unknown as GameState;

const award = awardTitles(state);
const labelOf = new Map(TITLE_DEFS.map((d) => [d.key, d.label]));

console.log('=== タイトル受賞者 ===');
// タイトルキー順に表示
for (const def of TITLE_DEFS) {
  const winners = Object.entries(award.gains)
    .filter(([, keys]) => keys.includes(def.key))
    .map(([pid]) => award.info[pid]);
  if (winners.length > 0) {
    console.log(`${def.label}: ${winners.map((w) => `${w.playerName}(${w.teamName})`).join(' / ')}`);
  }
}

// 参考: 首位打者・本塁打王の実数値
const teamOf = new Map<string, string>();
for (const t of teams) for (const p of t.players) teamOf.set(p.id, t.nickName);
console.log('\n=== 参考: 主要成績トップ ===');
const bats = Object.entries(playerStats).filter(([, s]) => s.batting && s.batting.ab >= 300);
const topAvg = bats.map(([id, s]) => ({ id, avg: s.batting!.hits / s.batting!.ab, ab: s.batting!.ab, hr: s.batting!.hr, rbi: s.batting!.rbi, sb: s.batting!.sb }))
  .sort((a, b) => b.avg - a.avg).slice(0, 3);
for (const t of topAvg) {
  const nm = teams.flatMap((tm) => tm.players).find((p) => p.id === t.id)!.name;
  console.log(`${nm}(${teamOf.get(t.id)}): 打率${t.avg.toFixed(3)} ${t.hr}本 ${t.rbi}点 ${t.sb}盗 (${t.ab}打数)`);
}
void labelOf;
