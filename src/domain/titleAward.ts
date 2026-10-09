// ============================================================
// タイトル表彰
// 当年の実集計(playerStats)からセ・パ各リーグのタイトルを確定する。
// ============================================================

import type { GameState } from './gameState';
import type { League, Player } from './types';
import type { PlayerSeasonStats, SeasonBatting, SeasonPitching } from '../match/matchStats';
import { battingAvg, battingObp, pitchingEra } from '../match/matchStats';
import type { TitleCounts } from './stats';
import { buildStandings } from './standings';

/** 規定打席（143試合 × 3.1） */
const QUAL_PA = 443;
/** 規定投球回（143イニング）= アウト数 */
const QUAL_OUTS = 143 * 3;

interface BatCand {
  player: Player;
  teamId: string;
  teamName: string;
  s: SeasonBatting;
  pa: number;
}
interface PitCand {
  player: Player;
  teamId: string;
  teamName: string;
  s: SeasonPitching;
  ip: number;
  winPct: number;
}

/** タイトル授与結果 */
export interface TitleAwardResult {
  /** playerId -> 獲得したタイトルキー一覧 */
  gains: Record<string, (keyof TitleCounts)[]>;
  /** playerId -> 表示用情報 */
  info: Record<string, { playerName: string; teamName: string }>;
}

/** 最大（または最小）の候補を1つ返す。requireQual時は資格者のみ。 */
function pickBest<T>(
  cands: T[],
  value: (c: T) => number,
  higherIsBetter: boolean,
): T | null {
  if (cands.length === 0) return null;
  let best = cands[0];
  let bestV = value(best);
  for (const c of cands.slice(1)) {
    const v = value(c);
    if (higherIsBetter ? v > bestV : v < bestV) {
      best = c;
      bestV = v;
    }
  }
  return best;
}

/** 当年のタイトルを確定する */
export function awardTitles(state: GameState): TitleAwardResult {
  const gains: Record<string, (keyof TitleCounts)[]> = {};
  const info: Record<string, { playerName: string; teamName: string }> = {};

  const addGain = (playerId: string, key: keyof TitleCounts, name: string, team: string) => {
    (gains[playerId] ??= []).push(key);
    info[playerId] = { playerName: name, teamName: team };
  };

  // playerId -> team の逆引き
  const teamOf = new Map<string, { teamId: string; teamName: string; league: League }>();
  for (const t of state.teams) {
    for (const p of t.players) teamOf.set(p.id, { teamId: t.id, teamName: t.nickName, league: t.league });
  }
  const playerById = new Map<string, Player>();
  for (const t of state.teams) for (const p of t.players) playerById.set(p.id, p);

  const leagues: League[] = ['CENTRAL', 'PACIFIC'];
  for (const league of leagues) {
    // このリーグの打者・投手候補を集める
    const bats: BatCand[] = [];
    const pits: PitCand[] = [];
    for (const [pid, stats] of Object.entries(state.playerStats)) {
      const t = teamOf.get(pid);
      const player = playerById.get(pid);
      if (!t || !player || t.league !== league) continue;
      const st = stats as PlayerSeasonStats;
      if (st.batting && st.batting.ab > 0) {
        const s = st.batting;
        bats.push({ player, teamId: t.teamId, teamName: t.teamName, s, pa: s.ab + s.bb });
      }
      if (st.pitching && st.pitching.batters > 0) {
        const s = st.pitching;
        const wl = s.wins + s.losses;
        pits.push({ player, teamId: t.teamId, teamName: t.teamName, s, ip: s.outs / 3, winPct: wl > 0 ? s.wins / wl : 0 });
      }
    }

    // ---- 野手タイトル ----
    const qualBats = bats.filter((b) => b.pa >= QUAL_PA);
    const avgWin = pickBest(qualBats, (b) => battingAvg(b.s), true);
    const obpWin = pickBest(qualBats, (b) => battingObp(b.s), true);
    const hrWin = pickBest(bats, (b) => b.s.hr, true);
    const rbiWin = pickBest(bats, (b) => b.s.rbi, true);
    const hitsWin = pickBest(bats, (b) => b.s.hits, true);
    const sbWin = pickBest(bats, (b) => b.s.sb, true);

    const batTitles: [BatCand | null, keyof TitleCounts][] = [
      [avgWin, 'battingAvg'], [obpWin, 'obp'], [hrWin, 'hr'],
      [rbiWin, 'rbi'], [hitsWin, 'hits'], [sbWin, 'sb'],
    ];
    for (const [w, key] of batTitles) {
      if (w) addGain(w.player.id, key, w.player.name, w.teamName);
    }

    // ---- 三冠王（首位打者・本塁打王・打点王を独占） ----
    if (avgWin && hrWin && rbiWin && avgWin.player.id === hrWin.player.id && avgWin.player.id === rbiWin.player.id) {
      addGain(avgWin.player.id, 'crown', avgWin.player.name, avgWin.teamName);
    }

    // ---- 投手タイトル ----
    const qualPits = pits.filter((p) => p.s.outs >= QUAL_OUTS);
    const eraWin = pickBest(qualPits, (p) => pitchingEra(p.s), false);
    const winsWin = pickBest(pits, (p) => p.s.wins, true);
    const soWin = pickBest(pits, (p) => p.s.so, true);
    const winPctWin = pickBest(qualPits, (p) => p.winPct, true);
    const savesWin = pickBest(pits, (p) => p.s.saves, true);
    const holdsWin = pickBest(pits, (p) => p.s.holds, true);

    const pitTitles: [PitCand | null, keyof TitleCounts][] = [
      [eraWin, 'era'], [winsWin, 'wins'], [soWin, 'so'],
      [winPctWin, 'winPct'], [savesWin, 'saves'], [holdsWin, 'holds'],
    ];
    for (const [w, key] of pitTitles) {
      if (w && (key === 'saves' ? w.s.saves > 0 : key === 'holds' ? w.s.holds > 0 : true)) {
        addGain(w.player.id, key, w.player.name, w.teamName);
      }
    }

    // ---- MVP: リーグ優勝チームを中心に、野手はOPS×出場、投手は勝利・防御率で総合最大 ----
    const standings = buildStandings(state.teams, league, state.records);
    const champId = standings[0]?.team.id;
    const mvpBat = pickBest(bats, (b) => mvpBatScore(b, b.teamId === champId), true);
    const mvpPit = pickBest(pits, (p) => mvpPitScore(p, p.teamId === champId), true);
    const bScore = mvpBat ? mvpBatScore(mvpBat, mvpBat.teamId === champId) : -1;
    const pScore = mvpPit ? mvpPitScore(mvpPit, mvpPit.teamId === champId) : -1;
    if (mvpBat && bScore >= pScore) addGain(mvpBat.player.id, 'mvp', mvpBat.player.name, mvpBat.teamName);
    else if (mvpPit) addGain(mvpPit.player.id, 'mvp', mvpPit.player.name, mvpPit.teamName);

    // ---- 新人王: 初年度（履歴が無い）選手で最も活躍 ----
    const rookies = [
      ...bats.filter((b) => isRookie(state, b.player)),
      ...pits.filter((p) => isRookie(state, p.player)),
    ];
    const rookieWin = pickBest(rookies, (c) => rookieScore(c), true);
    if (rookieWin && rookieScore(rookieWin) > 0) {
      const name = rookieWin.player.name;
      const team = rookieWin.teamName;
      addGain(rookieWin.player.id, 'rookie', name, team);
    }
  }

  // ---- 沢村賞: セ・パ通じて1名。先発格の総合最優秀 ----
  const allPits: PitCand[] = [];
  for (const [pid, stats] of Object.entries(state.playerStats)) {
    const t = teamOf.get(pid);
    const player = playerById.get(pid);
    if (!t || !player) continue;
    const st = stats as PlayerSeasonStats;
    if (st.pitching && st.pitching.outs >= QUAL_OUTS) {
      const s = st.pitching;
      const wl = s.wins + s.losses;
      allPits.push({ player, teamId: t.teamId, teamName: t.teamName, s, ip: s.outs / 3, winPct: wl > 0 ? s.wins / wl : 0 });
    }
  }
  const sawamura = pickBest(allPits, (p) => sawamuraScore(p), true);
  if (sawamura) addGain(sawamura.player.id, 'sawamura', sawamura.player.name, sawamura.teamName);

  return { gains, info };
}

/** MVP用の野手スコア（優勝チームは加点） */
function mvpBatScore(b: BatCand, champ: boolean): number {
  const ops = battingObp(b.s) + slg(b.s);
  const base = ops * 400 + b.s.hr * 2 + b.s.rbi + b.s.sb * 0.5;
  return base * (champ ? 1.25 : 1);
}
/** MVP用の投手スコア（優勝チームは加点） */
function mvpPitScore(p: PitCand, champ: boolean): number {
  const base = p.s.wins * 8 + p.s.saves * 3 + p.s.holds * 2 + p.s.so * 0.1 - pitchingEra(p.s) * 6;
  return base * (champ ? 1.25 : 1);
}
/** 新人王スコア */
function rookieScore(c: BatCand | PitCand): number {
  if ('pa' in c) return battingAvg(c.s) * 200 + c.s.hr * 2 + c.s.rbi + c.s.hits * 0.3;
  return c.s.wins * 8 + c.s.saves * 3 + c.s.holds * 2 + c.s.so * 0.1 - pitchingEra(c.s) * 4;
}
/** 沢村賞スコア（先発の総合） */
function sawamuraScore(p: PitCand): number {
  return p.s.wins * 10 + p.s.so * 0.15 + p.ip * 0.2 - pitchingEra(p.s) * 8;
}

function slg(s: SeasonBatting): number {
  if (s.ab === 0) return 0;
  const singles = s.hits - s.doubles - s.triples - s.hr;
  return (singles + s.doubles * 2 + s.triples * 3 + s.hr * 4) / s.ab;
}

/**
 * 新人王の資格を満たすか。
 *  ・ゲーム初年度（履歴が無い年）は該当なし。
 *  ・登録5年以内（state.year - debutYear <= 4）。
 *  ・前年までの一軍実績が、投手は30投球回(90アウト)以内・打者は60打席以内。
 */
function isRookie(state: GameState, player: Player): boolean {
  if (state.seasonHistory.length === 0) return false; // 初年度は該当なし
  const yearsRegistered = state.year - player.debutYear + 1;
  if (yearsRegistered > 5 || yearsRegistered < 1) return false;

  // 前年までの通算一軍実績（当年分は careers 未反映なので「前年まで」）
  const career = state.playerCareers[player.id];
  let priorOuts = 0;
  let priorPa = 0;
  if (career) {
    for (const s of career.seasons) {
      priorOuts += s.stats.pitching?.outs ?? 0;
      const b = s.stats.batting;
      if (b) priorPa += b.ab + b.bb;
    }
  }
  if (player.type === 'PITCHER') return priorOuts <= 90;
  return priorPa <= 60;
}
