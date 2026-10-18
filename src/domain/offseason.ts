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
    // 同一年度の重複保存を防止
    const seasons = prev ? prev.seasons.filter((s) => s.year !== year) : [];
    // 当年度の確定能力を記録（成長後の実力値を反映）
    seasons.push({
      year,
      teamId: t.teamId,
      teamName: t.teamName,
      stats: structuredClone(stats),
      abilities: {
        contact: p.contact,
        power: p.power,
        speed: p.speed,
        defense: p.defense,
        velocity: p.velocity,
        breaking: p.breaking,
        control: p.control,
        stamina: p.stamina,
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
function coreAbility(p: Pick<Player, 'type' | 'contact' | 'power' | 'speed' | 'defense' | 'velocity' | 'breaking' | 'control' | 'stamina'>): number {
  if (p.type === 'BATTER') {
    return (p.contact + p.power + p.speed + p.defense) / 4;
  }
  const velo = Math.max(0, Math.min(110, (p.velocity - 125) * 2.5));
  return (velo + p.breaking + p.control + p.stamina) / 4;
}

/** ピーク能力からこの割合以上低下したら引退（20%） */
const PEAK_DECLINE_RETIRE_RATIO = 0.2;

/** 年度別履歴（保存済みの各年度能力）と現在能力から、選手の主力能力のピーク値を求める。 */
function peakAbility(p: Player, career: PlayerCareer | undefined): number {
  let peak = coreAbility(p);
  for (const s of career?.seasons ?? []) {
    const a = s.abilities;
    if (!a) continue;
    peak = Math.max(peak, coreAbility({ type: p.type, ...a }));
  }
  return peak;
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
  careers: Record<string, PlayerCareer> = state.playerCareers,
  rng: () => number = Math.random,
): { teams: Team[]; retirements: RetirementEntry[]; hofCandidates: HallOfFamer[] } {
  const retirements: RetirementEntry[] = [];
  const hofCandidates: HallOfFamer[] = [];
  const nextTeams: Team[] = [];

  for (const team of teams) {
    const kept: Player[] = [];
    const rosterLevel = { ...team.rosterLevel };
    for (const p of team.players) {
      // ピーク能力から20%以上低下した選手は確定で引退。それ以外は年齢・能力に応じた確率判定。
      const peak = peakAbility(p, careers[p.id]);
      const declined = peak > 0 && coreAbility(p) <= peak * (1 - PEAK_DECLINE_RETIRE_RATIO);
      const retire = declined || rng() < retireProbability(p);
      if (!retire) {
        kept.push(p);
        continue;
      }
      // 引退確定
      delete rosterLevel[p.id];
      const career = careers[p.id];
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
  const retired = processRetirements(agedTeams, state, nextCareers);
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
