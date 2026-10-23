import { getPitcherStuff, type Player, type Team, type TeamStrength } from './types';

/** 平均値を求める（空なら0） */
function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 投手の総合的な能力値。
 * 球威 : 変化球 : 制球 = 0.35 : 0.35 : 0.30 の加重。
 */
function pitcherRating(p: Player): number {
  const stuff = getPitcherStuff(p);
  return stuff * 0.35 + p.breaking * 0.35 + p.control * 0.3;
}

/**
 * チーム戦力を算出する（仕様書7章）。
 * - 打力: スタメン打者のミート・パワー平均
 * - 走力: スタメン打者の走力平均
 * - 守備力: スタメン打者の守備力平均
 * - 投手力: 一軍投手の球速・変化球・制球の加重平均
 * - 選手層: 控え野手・一軍控え投手・二軍主要選手の平均
 * - 総合力: 打力×0.25 + 投手力×0.35 + 守備力×0.15 + 走力×0.10 + 選手層×0.15
 *
 * スタメン打者は「一軍野手の打力(contact+power)上位9名」を近似的に採用する。
 */
export function calcTeamStrength(team: Team): TeamStrength {
  const firstPlayers = team.players.filter((p) => team.rosterLevel[p.id] === 'FIRST');
  const farmPlayers = team.players.filter((p) => team.rosterLevel[p.id] === 'FARM');

  const firstBatters = firstPlayers.filter((p) => p.type === 'BATTER');
  const firstPitchers = firstPlayers.filter((p) => p.type === 'PITCHER');

  // スタメン9名 = 一軍野手を打撃力で降順ソートした上位9名
  const startersSorted = [...firstBatters].sort(
    (a, b) => b.contact + b.power - (a.contact + a.power),
  );
  const starters = startersSorted.slice(0, 9);
  const benchBatters = startersSorted.slice(9);

  const batting = avg(starters.map((p) => (p.contact + p.power) / 2));
  const running = avg(starters.map((p) => p.speed));
  const fielding = avg(starters.map((p) => p.defense));
  const pitching = avg(firstPitchers.map((p) => pitcherRating(p)));

  // 選手層: 控え野手 + 二軍主要選手（能力上位）の平均
  const farmSorted = [...farmPlayers].sort((a, b) => playerOverall(b) - playerOverall(a));
  const farmKey = farmSorted.slice(0, 12);
  const depthPool = [
    ...benchBatters.map(playerOverall),
    ...farmKey.map(playerOverall),
  ];
  const depth = avg(depthPool);

  const total =
    batting * 0.25 + pitching * 0.35 + fielding * 0.15 + running * 0.1 + depth * 0.15;

  return { batting, running, fielding, pitching, depth, total };
}

/** 選手個人の総合力（選手層算出用の簡易指標） */
function playerOverall(p: Player): number {
  if (p.type === 'PITCHER') {
    return pitcherRating(p);
  }
  return (p.contact + p.power + p.speed + p.defense) / 4;
}
