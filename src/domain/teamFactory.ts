import type { League, Player, Position, RosterLevel, Team } from './types';
import { generatePlayer } from './playerFactory';
import { randInt } from './random';

/** 12球団の定義（実在名を避けた仮想球団） */
interface TeamDef {
  id: string;
  name: string;
  shortName: string;
  nickName: string;
  markChar: string;
  league: League;
  colorPrimary: string;
}

export const TEAM_DEFS: TeamDef[] = [
  // セ・リーグ（本拠地を北から順に）
  { id: 'team_c4', name: 'ヤクルトスワローズ', shortName: '東京', nickName: 'ヤクルト', markChar: 'ヤ', league: 'CENTRAL', colorPrimary: '#2e8b57' }, // 東京
  { id: 'team_c1', name: '読売ジャイアンツ', shortName: '巨人', nickName: '巨人', markChar: '巨', league: 'CENTRAL', colorPrimary: '#f97709' }, // 東京
  { id: 'team_c3', name: 'DeNAベイスターズ', shortName: '横浜', nickName: 'DeNA', markChar: 'De', league: 'CENTRAL', colorPrimary: '#0d6efd' }, // 神奈川
  { id: 'team_c6', name: '中日ドラゴンズ', shortName: '中日', nickName: '中日', markChar: '中', league: 'CENTRAL', colorPrimary: '#00539b' }, // 愛知
  { id: 'team_c2', name: '阪神タイガース', shortName: '阪神', nickName: '阪神', markChar: '神', league: 'CENTRAL', colorPrimary: '#ffe201' }, // 兵庫
  { id: 'team_c5', name: '広島カープ', shortName: '広島', nickName: '広島', markChar: '広', league: 'CENTRAL', colorPrimary: '#c8102e' }, // 広島
  // パ・リーグ（本拠地を北から順に）
  { id: 'team_p6', name: '北海道日本ハムファイターズ', shortName: 'ハム', nickName: '日本ハム', markChar: '日', league: 'PACIFIC', colorPrimary: '#6b93a8' }, // 北海道
  { id: 'team_p4', name: '東北楽天イーグルス', shortName: '楽天', nickName: '楽天', markChar: '楽', league: 'PACIFIC', colorPrimary: '#870010' }, // 宮城
  { id: 'team_p2', name: '埼玉西武ライオンズ', shortName: '埼玉', nickName: '西武', markChar: '西', league: 'PACIFIC', colorPrimary: '#132257' }, // 埼玉
  { id: 'team_p3', name: '千葉ロッテマリーンズ', shortName: '千葉', nickName: 'ロッテ', markChar: 'ロ', league: 'PACIFIC', colorPrimary: '#e6558f' }, // 千葉
  { id: 'team_p5', name: '大阪オリックスバッファローズ', shortName: '大阪', nickName: 'オリックス', markChar: 'オ', league: 'PACIFIC', colorPrimary: '#000019' }, // 大阪
  { id: 'team_p1', name: '福岡ソフトバンクホークス', shortName: '福岡', nickName: 'ソフトバンク', markChar: 'ソ', league: 'PACIFIC', colorPrimary: '#f6c700' }, // 福岡
];

// 一軍野手スタメン想定のポジション構成（DH含む9名 → 守備位置8種＋DH）
// DHは守備位置を持たないので、野手は各ポジションに厚みを持たせて生成する。
const FIRST_TEAM_BATTER_POSITIONS: Position[] = [
  'C', 'C', // 捕手2
  '1B', '2B', '3B', 'SS', // 内野各1
  'OF', 'OF', 'OF', 'OF', // 外野4
  '1B', '2B', '3B', 'SS', 'OF', // 控え内外野5（計15名）
];

/**
 * 1チームを生成する。
 * ロースター構成（仕様書3章）:
 *   一軍29名 = 投手14 + 野手15
 *   二軍最大21名（合計50枠以内）
 */
export function generateTeam(def: TeamDef): Team {
  const players: Player[] = [];
  const rosterLevel: Record<string, RosterLevel> = {};

  // チーム全体の地力（強いチーム/弱いチームの差を出す）
  const teamBase = randInt(58, 68);

  // --- 一軍投手 14名 ---
  // 先発6, セットアッパー1, 抑え1, 中継ぎ6
  for (let i = 0; i < 14; i++) {
    // 先発・勝ちパは能力高め、中継ぎは平均的
    const isKeyPitcher = i < 8;
    const baseMean = teamBase + (isKeyPitcher ? randInt(0, 12) : randInt(-6, 4));
    const p = generatePlayer({ type: 'PITCHER', baseMean });
    players.push(p);
    rosterLevel[p.id] = 'FIRST';
  }

  // --- 一軍野手 15名 ---
  FIRST_TEAM_BATTER_POSITIONS.forEach((pos, i) => {
    const isStarter = i < 9;
    const baseMean = teamBase + (isStarter ? randInt(0, 12) : randInt(-8, 2));
    const p = generatePlayer({ type: 'BATTER', position: pos, baseMean });
    players.push(p);
    rosterLevel[p.id] = 'FIRST';
  });

  // --- 二軍 21名（投手9・野手12程度、能力は控えめ） ---
  for (let i = 0; i < 9; i++) {
    const p = generatePlayer({ type: 'PITCHER', baseMean: teamBase + randInt(-16, -2) });
    players.push(p);
    rosterLevel[p.id] = 'FARM';
  }
  const farmBatterPos: Position[] = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'C', '1B', 'SS', 'OF'];
  farmBatterPos.forEach((pos) => {
    const p = generatePlayer({ type: 'BATTER', position: pos, baseMean: teamBase + randInt(-16, -2) });
    players.push(p);
    rosterLevel[p.id] = 'FARM';
  });

  // 外国人選手を数名混ぜる（一軍の主力枠に）
  const foreignCount = randInt(2, 4);
  for (let i = 0; i < foreignCount && i < players.length; i++) {
    // 一軍の中からランダムに置き換え
    const idx = randInt(0, 28); // 一軍29名の範囲
    const original = players[idx];
    const replacement = generatePlayer({
      type: original.type,
      position: original.type === 'BATTER' ? original.position : undefined,
      isForeign: true,
      baseMean: teamBase + randInt(4, 14),
    });
    // 登録区分を引き継ぐ
    rosterLevel[replacement.id] = rosterLevel[original.id];
    delete rosterLevel[original.id];
    players[idx] = replacement;
  }

  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    nickName: def.nickName,
    markChar: def.markChar,
    league: def.league,
    colorPrimary: def.colorPrimary,
    players,
    rosterLevel,
  };
}

/** 12球団すべてを生成する */
export function generateAllTeams(): Team[] {
  return TEAM_DEFS.map((def) => generateTeam(def));
}
