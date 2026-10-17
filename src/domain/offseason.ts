// ============================================================
// オフシーズン処理
// 日本シリーズ終了後に実行される一連の処理をまとめる。
//   タイトル表彰 → 年度別成績保存 → 加齢/成長補正 → 引退/殿堂
//   → ドラフト会議 → チーム反映 → 翌シーズン開幕
// ============================================================

import type { GameState, PlayerCareer, SeasonHistory, TeamSeasonResult } from './gameState';
import { startNextSeason, normalizeRoster } from './gameState';
import { awardTitles } from './titleAward';
import { emptyTitleCounts, TITLE_DEFS, type TitleCounts } from './stats';
import { buildStandings } from './standings';
import { applyAgingAdjustment } from './growthEngine';
import {
  generateDraftProspects,
  generateRound1CpuBids,
  resolveCpuCompetitions,
  createLotteryDraw,
  pickForCpu,
} from './draft';
import { generateForeignProspects } from './foreignScout';
import type { DraftState, ForeignScoutState } from './gameState';
import type { Position } from './types';
import type { League, Player, RosterLevel, Team, TeamOrder } from './types';
import { buildBestOrder } from './orderFactory';
import {
  emptyBatting, emptyPitching, battingAvg, battingObp, battingOps, pitchingEra,
  type SeasonBatting, type SeasonPitching, type PlayerSeasonStats,
} from '../match/matchStats';
import { toBattingStats, toPitchingStats, type HallOfFamer, type CareerRecord } from './stats';

/** タイトル受賞者1件 */
export interface TitleWinnerEntry {
  playerId: string;
  playerName: string;
  teamName: string;
  titleLabels: string[]; // 例: ['首位打者', 'MVP']
}

/** 引退選手の簡易通算成績（引退発表の表示用） */
export interface RetirementCareer {
  isPitcher: boolean;
  years: number;
  // 打者
  games: number;
  hits: number;
  hr: number;
  rbi: number;
  avg: number;
  // 投手
  wins: number;
  losses: number;
  saves: number;
  era: number;
}

/** 引退選手1件 */
export interface RetirementEntry {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  position: string;
  age: number;
  hallOfFame: boolean;
  /** マイチームの引退者のみ簡易通算成績を持つ（他球団は undefined） */
  career?: RetirementCareer;
}

/** 新加入選手1件（ドラフト/外国人） */
export interface SigningEntry {
  playerName: string;
  teamName: string;
  position: string;
  kind: 'draft' | 'foreign';
}

/** 主な成長選手1件 */
export interface GrowthEntry {
  playerName: string;
  teamName: string;
  note: string; // 例: 「パワー +8」
}

/** タイトル表の受賞者セル（名前・チーム・該当成績値） */
export interface TitleWinnerCell {
  playerName: string;
  teamName: string;
  /** そのタイトルの成績値（例: 首位打者 → ".331"、本塁打王 → "42"）。無い場合は空 */
  value: string;
}

/** タイトル表（1タイトル行）: タイトル名ごとにセ・パの受賞者を並べる */
export interface TitleTableRow {
  label: string; // タイトル名
  /** セ・リーグ受賞者（いなければ null） */
  central: TitleWinnerCell | null;
  /** パ・リーグ受賞者（いなければ null） */
  pacific: TitleWinnerCell | null;
}

/** 特別タイトル（三冠王・沢村賞）。該当者がいる場合のみ別枠で表示 */
export interface SpecialTitleEntry {
  label: string;
  playerName: string;
  teamName: string;
}

/** オフシーズン結果サマリー */
export interface OffseasonReport {
  year: number; // 終了した年度
  titleWinners: TitleWinnerEntry[];
  /** タイトル名×リーグの受賞者テーブル（三冠王・沢村賞を除く） */
  titleTable: TitleTableRow[];
  /** 三冠王・沢村賞（該当者がいる場合のみ。別枠表示用） */
  specialTitles: SpecialTitleEntry[];
  retirements: RetirementEntry[];
  signings: SigningEntry[];
  notableGrowth: GrowthEntry[];
  /** マイチームの引退選手で殿堂入り資格を満たす候補（ユーザーが承認すると殿堂入り） */
  hofCandidates: HallOfFamer[];
}

/** 空のオフシーズン結果 */
export function emptyOffseasonReport(year: number): OffseasonReport {
  return {
    year,
    titleWinners: [],
    titleTable: [],
    specialTitles: [],
    retirements: [],
    signings: [],
    notableGrowth: [],
    hofCandidates: [],
  };
}

/**
 * 当年の成績を年度別履歴へ保存する。
 *  ・playerCareers: 各選手の当年 playerStats を seasons に追加
 *  ・seasonHistory: 当年のリーグ順位・勝敗・優勝/日本一を追加
 */
function saveSeason(state: GameState): {
  careers: Record<string, PlayerCareer>;
  history: SeasonHistory[];
} {
  const year = state.year;
  const championId = state.postseason?.championId ?? null;

  // playerId -> team/player の逆引き（成績・能力スナップショット用）
  const teamOf = new Map<string, { teamId: string; teamName: string }>();
  const playerById = new Map<string, (typeof state.teams)[number]['players'][number]>();
  for (const t of state.teams) {
    for (const p of t.players) {
      teamOf.set(p.id, { teamId: t.id, teamName: t.nickName });
      playerById.set(p.id, p);
    }
  }

  // --- 選手の年度別成績（全チームの全選手を対象） ---
  const careers: Record<string, PlayerCareer> = { ...state.playerCareers };
  for (const [pid, p] of playerById.entries()) {
    const t = teamOf.get(pid);
    if (!t) continue;
    const stats = state.playerStats[pid] ?? {};
    const prev = careers[pid];
    const seasons = prev ? [...prev.seasons] : [];
    // 能力は「その年の開幕時スナップショット」を記録（無ければ現在値でフォールバック）
    const startAb = state.seasonStartAbilities?.[pid];
    seasons.push({
      year,
      teamId: t.teamId,
      teamName: t.teamName,
      stats: structuredClone(stats),
      abilities: startAb ?? {
        contact: p.contact, power: p.power, speed: p.speed, defense: p.defense,
        velocity: p.velocity, breaking: p.breaking, control: p.control, stamina: p.stamina,
        age: p.age,
      },
    });
    careers[pid] = { playerId: pid, seasons };
  }

  // --- チーム打撃/投手の年間集計 ---
  const teamBat = new Map<string, SeasonBatting>();
  const teamPit = new Map<string, SeasonPitching>();
  for (const t of state.teams) {
    teamBat.set(t.id, emptyBatting());
    teamPit.set(t.id, emptyPitching());
  }
  for (const [pid, stats] of Object.entries(state.playerStats)) {
    const t = teamOf.get(pid);
    if (!t) continue;
    const b = stats.batting;
    if (b) {
      const acc = teamBat.get(t.teamId)!;
      acc.ab += b.ab; acc.hits += b.hits; acc.doubles += b.doubles; acc.triples += b.triples;
      acc.hr += b.hr; acc.rbi += b.rbi; acc.runs += b.runs; acc.bb += b.bb; acc.hbp += b.hbp; acc.so += b.so;
      acc.sac += b.sac; acc.sf += b.sf; acc.sb += b.sb; acc.errors += b.errors;
    }
    const p = stats.pitching;
    if (p) {
      const acc = teamPit.get(t.teamId)!;
      acc.outs += p.outs; acc.hits += p.hits; acc.hr += p.hr; acc.bb += p.bb; acc.hbp += p.hbp;
      acc.so += p.so; acc.runs += p.runs;
      acc.errors += p.errors;
    }
  }

  // --- チーム年度成績（リーグ順位＋集計） ---
  const teamResults: TeamSeasonResult[] = [];
  const leagues: League[] = ['CENTRAL', 'PACIFIC'];
  for (const league of leagues) {
    const standings = buildStandings(state.teams, league, state.records);
    standings.forEach((row, idx) => {
      const rec = state.records[row.team.id] ?? { wins: 0, losses: 0, draws: 0 };
      const tb = teamBat.get(row.team.id)!;
      const tp = teamPit.get(row.team.id)!;
      teamResults.push({
        year,
        teamId: row.team.id,
        rank: idx + 1,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
        leagueChampion: idx === 0,
        japanChampion: row.team.id === championId,
        avg: battingAvg(tb),
        ops: battingOps(tb),
        hr: tb.hr,
        sb: tb.sb,
        runsScored: tb.runs,
        runsAllowed: tp.runs,
        era: pitchingEra(tp),
        errors: tb.errors + tp.errors,
      });
    });
  }
  const history: SeasonHistory[] = [...state.seasonHistory, { year, teams: teamResults }];

  return { careers, history };
}

/** 選手の通算成績を年度別履歴から合算する */
export function careerTotals(seasons: { stats: { batting?: SeasonBatting; pitching?: SeasonPitching } }[]): {
  batting?: SeasonBatting;
  pitching?: SeasonPitching;
  years: number;
} {
  let batting: SeasonBatting | undefined;
  let pitching: SeasonPitching | undefined;
  for (const s of seasons) {
    if (s.stats.batting) {
      batting ??= emptyBatting();
      const b = s.stats.batting;
      batting.games += b.games; batting.ab += b.ab; batting.hits += b.hits;
      batting.doubles += b.doubles; batting.triples += b.triples; batting.hr += b.hr;
      batting.rbi += b.rbi; batting.runs += b.runs; batting.bb += b.bb; batting.hbp += b.hbp; batting.so += b.so;
      batting.sac += b.sac; batting.sf += b.sf; batting.sb += b.sb; batting.errors += b.errors;
    }
    if (s.stats.pitching) {
      pitching ??= emptyPitching();
      const p = s.stats.pitching;
      pitching.games += p.games; pitching.outs += p.outs; pitching.batters += p.batters;
      pitching.hits += p.hits; pitching.hr += p.hr; pitching.bb += p.bb; pitching.hbp += p.hbp; pitching.so += p.so;
      pitching.runs += p.runs; pitching.unearnedRuns += p.unearnedRuns; pitching.wins += p.wins; pitching.losses += p.losses;
      pitching.saves += p.saves; pitching.holds += p.holds; pitching.errors += p.errors;
    }
  }
  return { batting, pitching, years: seasons.length };
}

/** 選手の主力能力の平均（引退判定用）。野手は表能力4、投手は球速換算＋変化・制球・スタミナ。 */
function coreAbility(p: Player): number {
  if (p.type === 'BATTER') {
    return (p.contact + p.power + p.speed + p.defense) / 4;
  }
  const velo = Math.max(0, Math.min(110, (p.velocity - 125) * 2.5));
  return (velo + p.breaking + p.control + p.stamina) / 4;
}

/** 引退確率（0〜1）。40歳以上は高確率、40歳に近づくベテラン（36〜39歳）も衰えに応じて引退する場合がある。 */
function retireProbability(p: Player): number {
  const ability = coreAbility(p);
  if (p.age >= 40) {
    // 高齢ほど、能力が低いほど引退しやすい
    const low = Math.max(0, 65 - ability) / 40;
    return Math.min(0.95, 0.6 + (p.age - 40) * 0.1 + low * 0.3);
  }
  if (p.age >= 38) {
    // 38〜39歳: 40歳に近づき衰えた選手は引退する場合がある
    if (ability < 52) return 0.55;
    if (ability < 60) return 0.35;
    if (ability < 68) return 0.15;
    return 0.05;
  }
  if (p.age >= 36) {
    // 36〜37歳: 大きく能力が低下した場合は引退
    if (ability < 55) return 0.35;
    if (ability < 60) return 0.15;
  }
  return 0;
}

/** 殿堂入り資格を満たすか（野手1500安打or300本 / 投手120勝orセーブ+ホールド150） */
function meetsHofCriteria(totals: { batting?: SeasonBatting; pitching?: SeasonPitching }): boolean {
  const b = totals.batting;
  const p = totals.pitching;
  if (b && (b.hits >= 1500 || b.hr >= 300)) return true;
  if (p && (p.wins >= 120 || p.saves + p.holds >= 150)) return true;
  return false;
}

/**
 * 引退処理。全12球団で引退判定し、引退者をチームから除外する。
 * マイチームの引退者で殿堂資格を満たす者は殿堂入り候補(hofCandidates)として返す。
 */
function processRetirements(
  teams: Team[],
  state: GameState,
  rng: () => number = Math.random,
): { teams: Team[]; retirements: RetirementEntry[]; hofCandidates: HallOfFamer[] } {
  const retirements: RetirementEntry[] = [];
  const hofCandidates: HallOfFamer[] = [];
  const nextTeams: Team[] = [];

  for (const team of teams) {
    const kept: Player[] = [];
    const rosterLevel = { ...team.rosterLevel };
    for (const p of team.players) {
      const retire = rng() < retireProbability(p);
      if (!retire) {
        kept.push(p);
        continue;
      }
      // 引退確定
      delete rosterLevel[p.id];
      const career = state.playerCareers[p.id];
      const totals = career ? careerTotals(career.seasons) : { batting: undefined, pitching: undefined, years: 0 };
      const qualifies = meetsHofCriteria(totals);
      const isMy = team.id === state.myTeamId;
      // マイチームの引退者のみ簡易通算成績を詰める
      let retCareer: RetirementCareer | undefined;
      if (isMy) {
        const b = totals.batting;
        const pt = totals.pitching;
        const isPitcher = p.type === 'PITCHER';
        retCareer = {
          isPitcher,
          years: totals.years,
          games: b?.games ?? 0,
          hits: b?.hits ?? 0,
          hr: b?.hr ?? 0,
          rbi: b?.rbi ?? 0,
          avg: b ? battingAvg(b) : 0,
          wins: pt?.wins ?? 0,
          losses: pt?.losses ?? 0,
          saves: pt?.saves ?? 0,
          era: pt ? pitchingEra(pt) : 0,
        };
      }
      retirements.push({
        playerId: p.id,
        playerName: p.name,
        teamId: team.id,
        teamName: team.nickName,
        position: p.position,
        age: p.age,
        hallOfFame: false, // 承認されるまで false
        career: retCareer,
      });
      // マイチームの資格保持者のみ殿堂入り候補
      if (team.id === state.myTeamId && qualifies) {
        const careerRec: CareerRecord = {
          seasons: totals.years,
          batting: totals.batting ? toBattingStats(totals.batting) : undefined,
          pitching: totals.pitching ? toPitchingStats(totals.pitching) : undefined,
        };
        hofCandidates.push({
          player: p,
          joinYear: p.debutYear,
          leaveYear: state.year,
          career: careerRec,
          titles: state.playerTitles[p.id] ?? emptyTitleCounts(),
          seasons: career ? [...career.seasons].sort((a, b) => b.year - a.year) : [],
        });
      }
    }
    nextTeams.push({ ...team, players: kept, rosterLevel });
  }

  return { teams: nextTeams, retirements, hofCandidates };
}

/**
 * オフシーズン全処理を実行し、翌シーズン開幕状態の GameState を返す。
 * phase='OFFSEASON' とし、結果サマリー(offseasonReport)を付ける。
 * 「翌シーズン開幕」操作で phase='REGULAR' に切り替える。
 *
 * 現状は骨格: 年度を進めてリセットするのみ。
 * 今後ここに タイトル表彰 / 履歴保存 / 加齢補正 / 引退 / ドラフト / スカウト を追加する。
 */
/** タイトルに対応する成績値を整形する（新人王は数値なし）。 */
function titleStatValue(key: keyof TitleCounts, stats: PlayerSeasonStats | undefined): string {
  if (!stats) return '';
  const b = stats.batting;
  const p = stats.pitching;
  const avg3 = (v: number) => v.toFixed(3).replace(/^0/, '');
  switch (key) {
    case 'battingAvg': return b ? avg3(battingAvg(b)) : '';
    case 'hr': return b ? `${b.hr}本` : '';
    case 'rbi': return b ? `${b.rbi}点` : '';
    case 'hits': return b ? `${b.hits}本` : '';
    case 'obp': return b ? avg3(battingObp(b)) : '';
    case 'sb': return b ? `${b.sb}個` : '';
    case 'era': return p ? pitchingEra(p).toFixed(2) : '';
    case 'wins': return p ? `${p.wins}勝` : '';
    case 'so': return p ? `${p.so}個` : '';
    case 'winPct': {
      if (!p) return '';
      const wl = p.wins + p.losses;
      return wl > 0 ? avg3(p.wins / wl) : '';
    }
    case 'saves': return p ? `${p.saves}S` : '';
    case 'holds': return p ? `${p.holds}H` : '';
    default: return ''; // rookie 等は数値なし
  }
}

export function runOffseason(state: GameState): GameState {
  const report = emptyOffseasonReport(state.year);

  // --- task4: タイトル表彰 ---
  const award = awardTitles(state);
  const nextTitles: Record<string, TitleCounts> = { ...state.playerTitles };
  for (const [playerId, keys] of Object.entries(award.gains)) {
    const tc: TitleCounts = { ...(nextTitles[playerId] ?? emptyTitleCounts()) };
    for (const k of keys) tc[k] += 1;
    nextTitles[playerId] = tc;
    const inf = award.info[playerId];
    // TITLE_DEFS の順に並べたラベル
    const labels = TITLE_DEFS.filter((d) => keys.includes(d.key)).map((d) => d.label);
    report.titleWinners.push({
      playerId,
      playerName: inf.playerName,
      teamName: inf.teamName,
      titleLabels: labels,
    });
  }
  // 三冠王・MVP等の重要タイトル獲得者を上に（タイトル数が多い順）
  report.titleWinners.sort((a, b) => b.titleLabels.length - a.titleLabels.length);

  // タイトル名×リーグのテーブルを構築（タイトル名を行、セ/パを列に並べる）
  const leagueOf = new Map<string, League>();
  const nameOf = new Map<string, string>();
  const teamNickOf = new Map<string, string>();
  for (const t of state.teams) {
    for (const p of t.players) {
      leagueOf.set(p.id, t.league);
      nameOf.set(p.id, p.name);
      teamNickOf.set(p.id, t.nickName);
    }
  }
  // タイトルキー -> 受賞 playerId 一覧
  const winnersByKey = new Map<keyof TitleCounts, string[]>();
  for (const [playerId, keys] of Object.entries(award.gains)) {
    for (const k of keys) {
      const arr = winnersByKey.get(k) ?? [];
      arr.push(playerId);
      winnersByKey.set(k, arr);
    }
  }
  for (const def of TITLE_DEFS) {
    const ids = winnersByKey.get(def.key) ?? [];
    if (ids.length === 0) continue;
    // 三冠王・沢村賞は該当者がいる場合のみ別枠（specialTitles）へ
    if (def.key === 'crown' || def.key === 'sawamura') {
      for (const pid of ids) {
        report.specialTitles.push({
          label: def.label,
          playerName: nameOf.get(pid) ?? '',
          teamName: teamNickOf.get(pid) ?? '',
        });
      }
      continue;
    }
    const cell = (id: string | undefined): TitleWinnerCell | null => {
      if (!id) return null;
      return {
        playerName: nameOf.get(id) ?? '',
        teamName: teamNickOf.get(id) ?? '',
        value: titleStatValue(def.key, state.playerStats[id]),
      };
    };
    const cenId = ids.find((id) => leagueOf.get(id) === 'CENTRAL');
    const pacId = ids.find((id) => leagueOf.get(id) === 'PACIFIC');
    report.titleTable.push({
      label: def.label,
      central: cell(cenId),
      pacific: cell(pacId),
    });
  }

  // --- task5: 年度別成績保存（当年の能力・成績が確定した状態で保存） ---
  const { careers: nextCareers, history: nextHistory } = saveSeason(state);

  // --- task6: 加齢の年度末補正（全選手 age+1・上限超過の行き過ぎ補正） ---
  const agedTeams = applyAgingAdjustment(state.teams);

  // --- task7: 引退（全12球団・自動）と殿堂入り候補（マイチームのみ） ---
  const retired = processRetirements(agedTeams, state);
  report.retirements = retired.retirements;
  report.hofCandidates = retired.hofCandidates;

  // 引退により空いた一軍枠を二軍から補充し、オーダーも引退選手を除外して最新のベストオーダーに再編成する
  const normalizedTeams = retired.teams.map((t) => normalizeRoster(t, false));
  const nextOrders: Record<string, TeamOrder> = { ...state.orders };
  for (const team of normalizedTeams) {
    nextOrders[team.id] = buildBestOrder(team);
  }

  // TODO(task8): ドラフト新人加入 → teams へ追加、report.signings
  // TODO(task9): 外国人スカウト → teams へ追加、report.signings

  // オフシーズン開始状態（サマリー段階）。翌シーズン開幕はドラフト／スカウト後に行う。
  // year はまだ当年のまま。teams は加齢＋引退を反映済み（＝翌シーズンの母体）。
  return {
    ...state,
    playerTitles: nextTitles,
    playerCareers: nextCareers,
    seasonHistory: nextHistory,
    teams: normalizedTeams,
    orders: nextOrders,
    phase: 'OFFSEASON',
    offseasonStage: 'SUMMARY',
    offseasonReport: report,
    draft: null,
  };
}

/**
 * ドラフト会議を開始する。候補プールを生成し、前年順位の悪い順（全12球団ウェーバー）を作る。
 * offseasonStage を 'DRAFT' にした状態を返す。
 */
export function startDraft(state: GameState): GameState {
  const nextYear = state.year + 1;
  const pool = generateDraftProspects(nextYear);

  // NPB準拠のウェーバー順を作る（2巡目の指名順）。
  // 各リーグを順位の悪い順（6位→1位）に並べ、同順位は優先リーグを先にして交互に並べる。
  // 優先権はセ・パ隔年交互（入団年度の偶奇で決定）。例（セ優先）: セ6位→パ6位→セ5位→パ5位→…→セ1位→パ1位。
  const latest = state.seasonHistory[state.seasonHistory.length - 1];
  let waiverOrder: string[];
  if (latest) {
    const leagueOf = new Map(state.teams.map((t) => [t.id, t.league]));
    const byWorstRank = (lg: League) =>
      [...latest.teams]
        .filter((t) => leagueOf.get(t.teamId) === lg)
        .sort((a, b) => {
          // rank（1〜6）の降順＝順位の悪い順。rank 未設定時は勝率の低い順でフォールバック。
          if (a.rank && b.rank) return b.rank - a.rank;
          const pa = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
          const pb = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
          return pa - pb;
        })
        .map((t) => t.teamId);
    const ce = byWorstRank('CENTRAL');
    const pa = byWorstRank('PACIFIC');
    // 優先権: 入団年度が偶数ならセ・リーグ先、奇数ならパ・リーグ先（隔年交互）
    const [first, second] = nextYear % 2 === 0 ? [ce, pa] : [pa, ce];
    waiverOrder = [];
    const n = Math.max(first.length, second.length);
    for (let i = 0; i < n; i++) {
      if (first[i]) waiverOrder.push(first[i]);
      if (second[i]) waiverOrder.push(second[i]);
    }
  } else {
    waiverOrder = state.teams.map((t) => t.id);
  }

  // 1巡目: CPU全球団（マイチーム以外）が同時に1巡目を決定する（最大2球団重複）
  const cpuTeams = state.teams.filter((t) => t.id !== state.myTeamId);
  const round1CpuBids = generateRound1CpuBids(cpuTeams, pool);

  const draft: DraftState = {
    pool,
    picked: {}, // 1巡目は入札・抽選を経て決定するため初期は空
    myPicks: [],
    round: 1,
    waiverOrder,
    scouted: {},
    scoutsLeft: 10,
    pendingLottery: null,
    round1CpuBids,
    done: false,
  };

  return { ...state, offseasonStage: 'DRAFT', draft };
}

/**
 * ドラフト（および今後スカウト）完了後、指名選手をチームへ加え、翌シーズンを開幕する。
 */
export function finalizeOffseason(state: GameState): GameState {
  const draft = state.draft;
  const myTeamId = state.myTeamId;
  let teams = state.teams;

  if (draft) {
    // 指名選手を各球団へ二軍登録で追加
    const byTeam = new Map<string, Player[]>();
    for (const p of draft.pool) {
      const teamId = draft.picked[p.id];
      if (!teamId) continue;
      (byTeam.get(teamId) ?? byTeam.set(teamId, []).get(teamId)!).push(p);
    }
    teams = teams.map((t) => {
      const adds = byTeam.get(t.id);
      if (!adds || adds.length === 0) return t;
      const rosterLevel: Record<string, RosterLevel> = { ...t.rosterLevel };
      for (const p of adds) rosterLevel[p.id] = 'FARM';
      return { ...t, players: [...t.players, ...adds], rosterLevel };
    });
  }

  // 外国人スカウトで獲得した選手をマイチームへ二軍登録で追加
  const signed = state.foreignScout?.signed ?? [];
  if (myTeamId && signed.length > 0) {
    teams = teams.map((t) => {
      if (t.id !== myTeamId) return t;
      const rosterLevel: Record<string, RosterLevel> = { ...t.rosterLevel };
      for (const p of signed) rosterLevel[p.id] = 'FARM';
      return { ...t, players: [...t.players, ...signed], rosterLevel };
    });
  }

  // 翌シーズン開幕（year+1・日程/成績リセット・オーダー再編成）
  return startNextSeason(state, teams);
}

/**
 * マイチーム確定後に、まだ1巡目が確定していないCPU球団たちだけで
 * 外れ1巡目を全員確定するまで自動で消化する。
 */
function resolveRemainingCpuRound1(
  teams: Team[],
  pool: Player[],
  initialPicked: Record<string, string>,
  unresolvedTeamIds: string[],
): Record<string, string> {
  const nextPicked = { ...initialPicked };
  let currentUnresolved = [...unresolvedTeamIds];
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  while (currentUnresolved.length > 0) {
    const unresTeams = currentUnresolved.map((id) => teamMap.get(id)!).filter(Boolean);
    const available = pool.filter((p) => !nextPicked[p.id]);
    const bids = generateRound1CpuBids(unresTeams, available);
    const { winners, losers } = resolveCpuCompetitions(bids);
    for (const [pid, tid] of Object.entries(winners)) {
      nextPicked[pid] = tid;
    }
    currentUnresolved = losers;
  }
  return nextPicked;
}

/**
 * 1巡目指名が全球団確定した後に、第2巡目へ進める。
 * 2巡目のマイチームより前のCPUを先行指名し、マイチームの指名待ち状態にする。
 */
function advanceToRound2(state: GameState, picked: Record<string, string>, myPicks: string[]): GameState {
  const draft = state.draft!;
  const myTeamId = state.myTeamId!;
  const teamMap = new Map(state.teams.map((t) => [t.id, t]));
  const nextPicked = { ...picked };

  const cpuPick = (teamId: string) => {
    if (teamId === myTeamId) return;
    const team = teamMap.get(teamId);
    if (!team) return;
    const available = draft.pool.filter((p) => !nextPicked[p.id]);
    const pick = pickForCpu(team, available);
    if (pick) nextPicked[pick.id] = team.id;
  };

  // 2巡目ウェーバー順でマイより前のCPUを先行指名
  const order2 = draftOrderForRound(draft.waiverOrder, 2);
  const myIdx2 = order2.indexOf(myTeamId);
  for (const teamId of order2.slice(0, myIdx2)) {
    cpuPick(teamId);
  }

  return {
    ...state,
    draft: {
      ...draft,
      picked: nextPicked,
      myPicks,
      round: 2,
      pendingLottery: null,
      round1CpuBids: undefined,
      done: false,
    },
  };
}

/**
 * ユーザーが選手を指名したときの処理。
 * - 1巡目:
 *   他球団の事前入札と競合しているか判定。
 *   競合があれば pendingLottery をセットしてくじ引き待ちにする。
 *   競合がなければ即時交渉権獲得し、他球団の競合解決・残りの外れ1巡目を自動完結して2巡目へ。
 * - 2巡目以降:
 *   ウェーバー順でマイチームが指名し、その後他球団の当巡指名をシミュレート。
 */
export function makeDraftPick(state: GameState, prospectId: string): GameState {
  const draft = state.draft;
  const myTeamId = state.myTeamId;
  if (!draft || !myTeamId || draft.done) return state;

  const prospect = draft.pool.find((p) => p.id === prospectId);
  if (!prospect || draft.picked[prospectId]) return state;

  // --- 1巡目（および外れ1巡目） ---
  if (draft.round === 1 && !draft.myPicks.includes(prospectId)) {
    const cpuBids = { ...(draft.round1CpuBids ?? {}) };
    const competitors = Object.entries(cpuBids)
      .filter(([_, pid]) => pid === prospectId)
      .map(([tid]) => tid);

    if (competitors.length > 0) {
      // 競合発生！くじ引き演出へ
      const { winningIndex } = createLotteryDraw(competitors);
      return {
        ...state,
        draft: {
          ...draft,
          pendingLottery: {
            prospectId,
            competitorTeamIds: competitors,
            winningIndex,
            cpuBids,
          },
        },
      };
    } else {
      // 単独指名成功！
      const nextPicked: Record<string, string> = { ...draft.picked, [prospectId]: myTeamId };
      const nextMyPicks = [...draft.myPicks, prospectId];

      // マイ以外のCPU指名の競合を解決
      const otherCpuBids = Object.fromEntries(
        Object.entries(cpuBids).filter(([_, pid]) => pid !== prospectId),
      );
      const { winners, losers } = resolveCpuCompetitions(otherCpuBids);
      for (const [pid, tid] of Object.entries(winners)) {
        nextPicked[pid] = tid;
      }

      // 未確定CPU球団たちを外れ1巡目で自動完結
      const fullyPicked = resolveRemainingCpuRound1(state.teams, draft.pool, nextPicked, losers);
      return advanceToRound2(state, fullyPicked, nextMyPicks);
    }
  }

  // --- 2巡目以降 ---
  return finalizePickAndAdvanceRound(state, prospectId, myTeamId);
}

/**
 * くじ引きのタップ結果を確定させる。
 * selectedIndex: ユーザーがタップしたカードのインデックス (0..competitorTeamIds.length)
 */
export function resolveLotteryDraw(state: GameState, selectedIndex: number): GameState {
  const draft = state.draft;
  const myTeamId = state.myTeamId;
  if (!draft || !myTeamId || !draft.pendingLottery) return state;

  const lot = draft.pendingLottery;
  const won = selectedIndex === lot.winningIndex;

  return {
    ...state,
    draft: {
      ...draft,
      pendingLottery: {
        ...lot,
        revealedIndex: selectedIndex,
        won,
      },
    },
  };
}

/**
 * くじ引き結果確認後の確定処理。
 * - 当選なら獲得確定し、他球団の外れ1巡目を自動完結して第2巡目へ進む。
 * - 外れなら競合CPUが獲得し、外れた球団（マイチーム含む）で改めて外れ1巡目の指名待ちへ。
 */
export function confirmLotteryOutcome(state: GameState): GameState {
  const draft = state.draft;
  const myTeamId = state.myTeamId;
  if (!draft || !myTeamId || !draft.pendingLottery) return state;

  const { prospectId, competitorTeamIds, won, cpuBids = {} } = draft.pendingLottery;
  const teamMap = new Map(state.teams.map((t) => [t.id, t]));

  // マイ指名選手以外のCPU同士の競合を解決
  const otherCpuBids = Object.fromEntries(
    Object.entries(cpuBids).filter(([_, pid]) => pid !== prospectId),
  );
  const { winners, losers } = resolveCpuCompetitions(otherCpuBids);
  const nextPicked: Record<string, string> = { ...draft.picked };
  for (const [pid, tid] of Object.entries(winners)) {
    nextPicked[pid] = tid;
  }
  let allUnresolvedCpu = [...losers];

  if (won) {
    // 交渉権獲得！マイチーム確定
    nextPicked[prospectId] = myTeamId;
    const nextMyPicks = [...draft.myPicks, prospectId];
    // 競合相手のCPUは外れ
    allUnresolvedCpu.push(...competitorTeamIds);

    // 未確定CPU球団たちを外れ1巡目で自動完結し、第2巡目へ進む
    const fullyPicked = resolveRemainingCpuRound1(state.teams, draft.pool, nextPicked, allUnresolvedCpu);
    return advanceToRound2(state, fullyPicked, nextMyPicks);
  } else {
    // ハズレ: 競合相手のCPUの中から1球団が獲得
    const winningCpuTeamId = competitorTeamIds[Math.floor(Math.random() * competitorTeamIds.length)];
    nextPicked[prospectId] = winningCpuTeamId;
    // 競合相手で外れたCPU
    allUnresolvedCpu.push(...competitorTeamIds.filter((id) => id !== winningCpuTeamId));

    // 外れたCPU球団たちで外れ1巡目指名を同時に決定（最大2球団重複）
    const remainingPool = draft.pool.filter((p) => !nextPicked[p.id]);
    const unresolvedTeams = allUnresolvedCpu.map((id) => teamMap.get(id)!).filter(Boolean);
    const nextRound1CpuBids = generateRound1CpuBids(unresolvedTeams, remainingPool);

    return {
      ...state,
      draft: {
        ...draft,
        picked: nextPicked,
        pendingLottery: null,
        round1CpuBids: nextRound1CpuBids,
      },
    };
  }
}

/**
 * その巡の指名順（teamId 配列）を返す。NPB準拠のスネーク方式:
 * 2巡目はウェーバー順（waiverOrder＝最下位から）、3巡目は逆順、以降交互に折り返す。
 * （waiverOrder は「最下位先・優先リーグ交互」で並んでいる前提）
 * 1巡目は入札制で順序は結果に影響しないため waiverOrder をそのまま返す。
 */
function draftOrderForRound(waiverOrder: string[], round: number): string[] {
  if (round === 1) return waiverOrder;
  // 2巡目=ウェーバー順（偶数巡）、3巡目=逆順（奇数巡）、以降折り返し
  return round % 2 === 0 ? waiverOrder : [...waiverOrder].reverse();
}

/**
 * 指名完了後の確定とCPU進行。
 *
 * ウェーバー制を正しく機能させるため、マイチームもウェーバー順（スネーク）の自分の位置で指名する。
 * - 1巡目のCPU指名は startDraft 時に事前処理済みのため、ここでは何もしない。
 * - 2巡目以降: マイより前のCPUは前巡末で「先行指名」済み。当巡はマイより後ろのCPUのみ指名。
 *   その後、次巡のマイより前のCPUを先行指名して再びマイの指名待ちにする。
 */
function finalizePickAndAdvanceRound(state: GameState, prospectId: string, myTeamId: string): GameState {
  const draft = state.draft!;
  const nextPicked = { ...draft.picked, [prospectId]: myTeamId };
  const nextMyPicks = [...draft.myPicks, prospectId];
  const teamMap = new Map(state.teams.map((t) => [t.id, t]));

  const cpuPick = (teamId: string) => {
    if (teamId === myTeamId) return;
    const team = teamMap.get(teamId);
    if (!team) return;
    const available = draft.pool.filter((p) => !nextPicked[p.id]);
    const pick = pickForCpu(team, available);
    if (pick) nextPicked[pick.id] = team.id;
  };

  const round = draft.round;
  const order = draftOrderForRound(draft.waiverOrder, round);

  // 1巡目: CPU指名はstartDraft時に事前処理済み。マイ指名後の追加CPU処理は不要。
  // 2巡目以降: マイより後ろのCPUを当巡で指名させる。
  if (round !== 1) {
    const myIdx = order.indexOf(myTeamId);
    for (const teamId of order.slice(myIdx + 1)) cpuPick(teamId);
  }

  const nextRound = round + 1;
  const isDone = nextRound > 6 || nextMyPicks.length >= 6;

  if (!isDone) {
    // 次巡のマイより前のCPUを先行指名し、マイが残ったプールから指名できるようにする
    // (1巡目→2巡目の先行分もここで処理)
    const orderNext = draftOrderForRound(draft.waiverOrder, nextRound);
    const myIdxNext = orderNext.indexOf(myTeamId);
    for (const teamId of orderNext.slice(0, myIdxNext)) cpuPick(teamId);
  }

  return {
    ...state,
    draft: {
      ...draft,
      picked: nextPicked,
      myPicks: nextMyPicks,
      round: nextRound,
      pendingLottery: null,
      done: isDone,
    },
  };
}

/**
 * ユーザーが「指名終了」を押したときの処理。
 * マイチームの指名を終了し、残りの巡をCPUだけで高速消化してドラフトを完了状態にする。
 */
export function finishMyTeamDraft(state: GameState): GameState {
  const draft = state.draft;
  const myTeamId = state.myTeamId;
  if (!draft || !myTeamId || draft.done) return state;

  const nextPicked = { ...draft.picked };
  const teamMap = new Map(state.teams.map((t) => [t.id, t]));

  const cpuPick = (teamId: string) => {
    if (teamId === myTeamId) return;
    const team = teamMap.get(teamId);
    if (!team) return;
    const available = draft.pool.filter((p) => !nextPicked[p.id]);
    const pick = pickForCpu(team, available);
    if (pick) nextPicked[pick.id] = team.id;
  };

  // 残りの巡を、各巡ウェーバー順（スネーク）でCPUだけ指名して消化。
  // 現在の巡（2巡目以降）はマイより前のCPUが既に先行指名済みなので、マイ以降だけを埋める。
  for (let r = draft.round; r <= 6; r++) {
    const order = draftOrderForRound(draft.waiverOrder, r);
    const skipBeforeMy = r === draft.round && r > 1;
    const start = skipBeforeMy ? order.indexOf(myTeamId) + 1 : 0;
    for (const teamId of order.slice(start)) cpuPick(teamId);
  }

  return {
    ...state,
    draft: {
      ...draft,
      picked: nextPicked,
      myTeamFinished: true,
      done: true,
    },
  };
}

/**
 * 任意の選手を自由契約（戦力外）にする。
 * オフシーズン中に実行され、チーム保有選手およびロースターから除外して50人枠を空ける。
 * オーダーに存在していた場合は自動で再編成する。
 */
export function releasePlayer(state: GameState, playerId: string): GameState {
  const myTeamId = state.myTeamId;
  if (!myTeamId) return state;

  const myTeam = state.teams.find((t) => t.id === myTeamId);
  if (!myTeam) return state;

  const targetPlayer = myTeam.players.find((p) => p.id === playerId);
  if (!targetPlayer) return state;

  // チームから選手を除外
  const nextPlayers = myTeam.players.filter((p) => p.id !== playerId);
  const nextRosterLevel = { ...myTeam.rosterLevel };
  delete nextRosterLevel[playerId];

  const releasedTeam: Team = {
    ...myTeam,
    players: nextPlayers,
    rosterLevel: nextRosterLevel,
  };

  // 一軍の規定人数（野手15・投手14）を保つため、二軍から昇格して補充する。
  // 自由契約で一軍選手が減ると控えが不足するため正規化が必要。
  const isRegular = state.phase === 'REGULAR';
  const updatedTeam = normalizeRoster(releasedTeam, isRegular);

  const nextTeams = state.teams.map((t) => (t.id === myTeamId ? updatedTeam : t));

  // オーダーの再編成（正規化後のロースターでベストオーダーを組み直す）
  const nextOrders = { ...state.orders };
  nextOrders[myTeamId] = buildBestOrder(updatedTeam);

  return {
    ...state,
    teams: nextTeams,
    orders: nextOrders,
  };
}

/**
 * ドラフト候補選手をスカウト調査する。
 * 1回のドラフト会議につき最大5回まで使用可能。
 * 隠しパラメータである「努力値」または「才能値」のどちらか一方をランダムに調査してUI表示可能にする。
 */
export function scoutDraftProspect(state: GameState, prospectId: string): GameState {
  const draft = state.draft;
  if (!draft || draft.done || draft.scoutsLeft <= 0) return state;
  // 既にスカウト済みの場合は消費しない
  if (draft.scouted[prospectId]) return state;

  const target = draft.pool.find((p) => p.id === prospectId);
  if (!target) return state;

  // 才能か努力のいずれかをランダム（50%）で開示
  const which: 'talent' | 'effort' = Math.random() < 0.5 ? 'talent' : 'effort';

  return {
    ...state,
    draft: {
      ...draft,
      scoutsLeft: draft.scoutsLeft - 1,
      scouted: {
        ...draft.scouted,
        [prospectId]: which,
      },
    },
  };
}



// ============================================================
// 外国人スカウト
// ============================================================

/** 外国人保有上限 */
const FOREIGN_LIMIT = 5;
/** 保有選手の上限（50人枠） */
const ROSTER_LIMIT = 50;

/** マイチームの現在の枠使用状況（ドラフト・スカウトで追加予定分も含む） */
function rosterUsage(state: GameState): { total: number; foreigners: number } {
  const myTeamId = state.myTeamId;
  const myTeam = state.teams.find((t) => t.id === myTeamId);
  if (!myTeam) return { total: 0, foreigners: 0 };
  const draftCount = state.draft?.myPicks.length ?? 0;
  const signed = state.foreignScout?.signed ?? [];
  const total = myTeam.players.length + draftCount + signed.length;
  const foreigners = myTeam.players.filter((p) => p.is_foreign).length + signed.length;
  return { total, foreigners };
}

/** 外国人をあと1名獲得できるか */
export function canSignForeign(state: GameState): boolean {
  const { total, foreigners } = rosterUsage(state);
  return total < ROSTER_LIMIT && foreigners < FOREIGN_LIMIT;
}

/** 外国人スカウトを開始する（ドラフト完了後）。SCOUT段階へ遷移。 */
export function startForeignScout(state: GameState): GameState {
  const positions: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'OF'];
  const pool: Partial<Record<Position, Player[]>> = {};
  for (const pos of positions) {
    pool[pos] = generateForeignProspects(pos, state.year + 1, 5);
  }
  const foreignScout: ForeignScoutState = {
    position: null,
    pool,
    offered: [],
    signed: [],
    done: false,
  };
  return { ...state, offseasonStage: 'SCOUT', foreignScout };
}

/** 指定ポジションの外国人候補5名を提示する。ボタン再押下での再抽選は行わずプールから取得する。 */
export function offerForeignProspects(state: GameState, position: Position): GameState {
  const fs = state.foreignScout;
  if (!fs || fs.done) return state;
  const pool = { ...(fs.pool ?? {}) };
  if (!pool[position]) {
    pool[position] = generateForeignProspects(position, state.year + 1, 5);
  }
  const offered = pool[position] ?? [];
  return { ...state, foreignScout: { ...fs, pool, position, offered } };
}

/** 提示中の候補から1名を獲得する（枠に空きがある場合のみ）。獲得した選手は候補プールから除外される。 */
export function signForeign(state: GameState, prospectId: string): GameState {
  const fs = state.foreignScout;
  if (!fs || fs.done) return state;
  if (!canSignForeign(state)) return state;
  const target = fs.offered.find((p) => p.id === prospectId);
  if (!target) return state;

  const pos = fs.position;
  const pool = { ...(fs.pool ?? {}) };
  if (pos && pool[pos]) {
    pool[pos] = pool[pos]!.filter((p) => p.id !== prospectId);
  }

  return {
    ...state,
    foreignScout: {
      ...fs,
      pool,
      signed: [...fs.signed, target],
      offered: [], // 獲得後は提示をクリア（再度ポジション選択）
      position: null,
    },
  };
}

/** 外国人スカウトを終了する。 */
export function finishForeignScout(state: GameState): GameState {
  const fs = state.foreignScout;
  if (!fs) return state;
  return { ...state, foreignScout: { ...fs, done: true, offered: [], position: null } };
}
