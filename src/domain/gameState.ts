import { calcStuff, calcVelocity, type Player, type Team, type TeamOrder } from './types';
import { generateAllTeams } from './teamFactory';
import { buildBestOrder, normalizeRoster, FIRST_BATTERS, FIRST_PITCHERS } from './orderFactory';
import { generateSeason, type ScheduleGame } from './seasonSchedule';
import { SEASON_START_YEAR } from './schedule';
import type { GameResult } from '../match/matchTypes';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { PostseasonState } from '../match/postseason';
import type { TitleCounts, HallOfFamer } from './stats';
import type { OffseasonReport } from './offseason';
import { backfillMissingCareers, sanitizePlayerCareers, generatePlayerPastCareer } from './careerGenerator';
import { generateUniquePlayerId } from './playerFactory';
import { applySpringCamp, type SpringCampReport } from './growthEngine';

const STORAGE_KEY = 'pennant-game-state';
const SAVED_AT_KEY = 'pennant-game-state-saved-at';
export const SCHEMA_VERSION = 23;

/** チームの勝敗記録 */
export interface TeamRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** 進行単位（1試合 / 1週 / 1か月） */
export type AdvanceUnit = 'game' | 'week' | 'month';

/** 進行フェーズ（レギュラー進行中 / オフシーズン中） */
export type GamePhase = 'REGULAR' | 'OFFSEASON';

/** 故障者リストの1件（離脱中の選手） */
export interface InjuryEntry {
  playerId: string;
  name: string;
  position: string;
  gamesLeft: number; // 残り離脱試合数（0になったら復帰）
  totalGames: number; // 全治試合数（表示用）
  severe: boolean; // 大ケガ（60試合以上）
}

/** 直近試合の簡易結果（試合レポート脇の表示用） */
export interface RecentGame {
  myResult: 'win' | 'lose' | 'draw'; // マイチーム視点
  homeMark: string; // ホーム球団の1文字マーク
  awayMark: string; // ビジター球団の1文字マーク
  homeScore: number;
  awayScore: number;
}

/** オフシーズンの段階（サマリー確認 → ドラフト会議 → スカウト → 開幕） */
export type OffseasonStage = 'SUMMARY' | 'DRAFT' | 'SCOUT';

/** 外国人スカウトの進行状態 */
export interface ForeignScoutState {
  /** 選択中のポジション（提示を受けたポジション） */
  position: import('./types').Position | null;
  /** ポジションごとの候補プール（ボタン再押下での再抽選を防止） */
  pool?: Partial<Record<import('./types').Position, Player[]>>;
  /** 現在提示中の候補（最大5名） */
  offered: Player[];
  /** 今回のスカウトで獲得した外国人 */
  signed: Player[];
  /** スカウト終了フラグ */
  done: boolean;
}

/** ドラフト会議の進行状態 */
export interface DraftState {
  /** 候補選手プール */
  pool: Player[];
  /** 指名済み: playerId -> 指名した球団ID */
  picked: Record<string, string>;
  /** マイチームの指名 playerId（順） */
  myPicks: string[];
  /** 現在の巡（1〜6） */
  round: number;
  /** 指名順（前年順位の悪い順の teamId 配列。全12球団ウェーバー） */
  waiverOrder: string[];
  /** スカウト調査結果: playerId -> 見えたパラメータ */
  scouted: Record<string, 'talent' | 'effort'>;
  /** 残りスカウト回数 */
  scoutsLeft: number;
  /** 1巡目の抽選待ち（マイが指名した選手・競合数・当選カード番号0..competitors）。null なら抽選不要 */
  pendingLottery: {
    prospectId: string;
    competitorTeamIds: string[]; // 競合球団（自チーム除く、最大2球団）
    winningIndex: number; // 0..competitorTeamIds.length
    revealedIndex?: number; // ユーザーがタップしたカード
    won?: boolean;
    cpuBids?: Record<string, string>; // その入札回のCPU指名マップ (teamId -> prospectId)
  } | null;
  /** 1巡目進行中の未確定CPU入札マップ (teamId -> prospectId) */
  round1CpuBids?: Record<string, string>;
  /** マイチームが「指名終了」を押したか */
  myTeamFinished?: boolean;
  /** ドラフト終了フラグ */
  done: boolean;
}

/** 能力値スナップショット（年度開幕時点。能力推移・今季増減の表示用） */
export interface AbilitySnapshot {
  contact: number;
  power: number;
  speed: number;
  defense: number;
  stuff?: number;
  velocity: number;
  breaking: number;
  control: number;
  stamina: number;
  age: number;
}

/** ある年度の1選手の成績スナップショット（実集計ベース） */
export interface SeasonStatLine {
  year: number;
  teamId: string;
  teamName: string;
  stats: PlayerSeasonStats;
  /** その年度末時点の能力値（能力推移表示用） */
  abilities: AbilitySnapshot;
}

/** 選手の通算・年度別成績の蓄積 */
export interface PlayerCareer {
  playerId: string;
  /** 年度別成績（新しい年が末尾） */
  seasons: SeasonStatLine[];
}

/** ある年度のチーム最終成績 */
export interface TeamSeasonResult {
  year: number;
  teamId: string;
  rank: number; // リーグ内順位（1〜6）
  wins: number;
  losses: number;
  draws: number;
  leagueChampion: boolean; // リーグ優勝（1位）
  japanChampion: boolean; // 日本一
  // チーム打撃/投手の年間集計（年度別表示用）
  avg: number; // チーム打率
  ops: number; // チームOPS
  hr: number; // チーム本塁打
  sb: number; // チーム盗塁
  runsScored: number; // チーム総得点
  runsAllowed: number; // チーム総失点
  era: number; // チーム防御率
  errors: number; // 失策（未集計につき現状0）
}

/** 年度別のリーグ全体スナップショット */
export interface SeasonHistory {
  year: number;
  teams: TeamSeasonResult[];
}

/** 保存されるゲーム全体の状態 */
export interface GameState {
  version: number;
  /** ユーザーが操作する球団ID（未選択時はnull） */
  myTeamId: string | null;
  /** 12球団の全データ */
  teams: Team[];
  /** 各球団のオーダー（teamId -> オーダー） */
  orders: Record<string, TeamOrder>;
  /** 現在の週インデックス（0始まり。0=4月1週） */
  weekIndex: number;
  /** シーズン日程（全12球団・143日） */
  schedule: ScheduleGame[];
  /** 消化済みの試合数（schedule配列の次に消化するインデックス） */
  gameCursor: number;
  /** 各球団の勝敗記録（teamId -> 記録） */
  records: Record<string, TeamRecord>;
  /** 進行単位の設定 */
  advanceUnit: AdvanceUnit;
  /** 選手の累計シーズン成績（playerId -> 成績）。レギュラーシーズンのみ集計 */
  playerStats: Record<string, PlayerSeasonStats>;
  /**
   * ポストシーズン(CS・日本シリーズ)の累計成績（playerId -> 成績）。
   * レギュラーの playerStats とは独立に集計し、年間/通算成績には含めない。マイチームのみ。
   */
  postseasonStats: Record<string, PlayerSeasonStats>;
  /** ポストシーズン状態（レギュラー終了後に開始。未開始はnull） */
  postseason: PostseasonState | null;

  // ---- 年度・履歴（オフシーズン処理で更新） ----
  /** 現在の年度（例: 2027） */
  year: number;
  /** 進行フェーズ */
  phase: GamePhase;
  /** 年度別のリーグ最終成績（新しい年が末尾） */
  seasonHistory: SeasonHistory[];
  /** 選手ごとの通算・年度別成績（playerId -> 履歴） */
  playerCareers: Record<string, PlayerCareer>;
  /** 選手ごとのタイトル獲得回数（playerId -> 回数） */
  playerTitles: Record<string, TitleCounts>;
  /** 殿堂入り選手（登録の新しい順） */
  hallOfFame: HallOfFamer[];
  /** 直近オフシーズンの結果サマリー（未処理はnull） */
  offseasonReport: OffseasonReport | null;
  /** オフシーズンの段階（phase==='OFFSEASON' のとき有効） */
  offseasonStage: OffseasonStage | null;
  /** ドラフト会議の状態（DRAFT段階でのみ非null） */
  draft: DraftState | null;
  /** 外国人スカウトの状態（SCOUT段階でのみ非null） */
  foreignScout: ForeignScoutState | null;
  /** マイチームの故障者リスト（playerId -> 離脱情報） */
  injuries: Record<string, InjuryEntry>;
  /** マイチームの直近試合結果（新しい順ではなく消化順、最大6件） */
  recentGames: RecentGame[];
  /** 先発投手が最後に先発した日（playerId -> day）。中5日の登板間隔管理用（全球団） */
  starterLastDay: Record<string, number>;
  /** リリーフ投手の直近連続登板数（playerId -> 連続試合数）。3連投で次回休養（全球団） */
  relieverConsecutive: Record<string, number>;
  /**
   * ポストシーズン用ローテーション管理（teamId -> 次に先発するローテ番号 0始まり）。
   * シリーズをまたいでも先発が重複しないよう、試合ごとにインクリメントする。
   */
  postRotationIdx: Record<string, number>;
  /**
   * 今シーズン開幕時点の能力スナップショット（playerId -> 全能力）。
   * 「今年度の能力増減」表示に使う（現在値との差分）。全球団の全選手を対象。
   */
  seasonStartAbilities: Record<string, AbilitySnapshot>;
  /** 直近の春季キャンプ覚醒結果（開幕時に表示、未確認時は非null） */
  springCampReport?: SpringCampReport | null;
}

/** 全チームの全選手について、現時点の能力スナップショットを作る */
export function snapshotAbilities(teams: Team[]): Record<string, AbilitySnapshot> {
  const snap: Record<string, AbilitySnapshot> = {};
  for (const t of teams) {
    for (const p of t.players) {
      snap[p.id] = {
        contact: p.contact, power: p.power, speed: p.speed, defense: p.defense,
        stuff: p.stuff, velocity: p.velocity, breaking: p.breaking, control: p.control, stamina: p.stamina,
        age: p.age,
      };
    }
  }
  return snap;
}

/** 全チームの記録を0で初期化 */
function emptyRecords(teams: Team[]): Record<string, TeamRecord> {
  const r: Record<string, TeamRecord> = {};
  for (const t of teams) r[t.id] = { wins: 0, losses: 0, draws: 0 };
  return r;
}

/** 全球団のオーダーをベストオーダーで初期化 */
export function buildInitialOrders(teams: Team[]): Record<string, TeamOrder> {
  const orders: Record<string, TeamOrder> = {};
  for (const team of teams) {
    orders[team.id] = buildBestOrder(team);
  }
  return orders;
}

/** 新規ゲーム状態を生成（12球団を生成、マイチーム未選択、初期オーダー自動編成） */
export function createNewGameState(): GameState {
  const teams = generateAllTeams();
  return {
    version: SCHEMA_VERSION,
    myTeamId: null,
    teams,
    orders: buildInitialOrders(teams),
    weekIndex: 0,
    schedule: generateSeason(teams),
    gameCursor: 0,
    records: emptyRecords(teams),
    advanceUnit: 'game',
    playerStats: {},
    postseasonStats: {},
    postseason: null,
    year: SEASON_START_YEAR,
    phase: 'REGULAR',
    seasonHistory: [],
    playerCareers: backfillMissingCareers(teams, {}, SEASON_START_YEAR),
    playerTitles: {},
    hallOfFame: [],
    offseasonReport: null,
    offseasonStage: null,
    draft: null,
    foreignScout: null,
    injuries: {},
    recentGames: [],
    starterLastDay: {},
    relieverConsecutive: {},
    postRotationIdx: {},
    springCampReport: null,
    seasonStartAbilities: snapshotAbilities(teams),
  };
}

export { normalizeRoster, FIRST_BATTERS, FIRST_PITCHERS };

/**
 * 翌シーズンの開幕状態を作る。
 * 年度を+1し、日程・勝敗・当年成績・ポストシーズンをリセットする。
 * 履歴（seasonHistory/playerCareers/playerTitles/hallOfFame）は引き継ぐ。
 * teams はオフシーズン処理後のもの（加齢・引退・新加入を反映済み）を渡す。
 * orders は既存を維持しつつ、保有選手に存在しなくなったスロットは再編成する。
 */
export function startNextSeason(prev: GameState, teamsIn: Team[]): GameState {
  const nextYear = prev.year + 1;

  // 開幕直前の春季キャンプ覚醒イベント（自チームの25歳以下の若手から野手1名・投手1名が覚醒）
  const { teams: campTeams, report: campReport } = applySpringCamp(teamsIn, nextYear, prev.myTeamId);

  // オフシーズンで全快扱い＆一軍枠の正規化:
  //  - 故障者(IL)は二軍(FARM)へ戻す
  //  - 引退・新加入で崩れた一軍(FIRST)の人数を規定（野手15・投手14）に補正する。
  //    不足分は二軍から能力順に昇格、過剰分は能力下位から降格。
  const teams = campTeams.map((t) => normalizeRoster(t));

  // 翌シーズンはロースター（一軍/二軍）が組み替わるため、オーダーは全チーム再編成する。
  const orders: Record<string, TeamOrder> = {};
  for (const team of teams) {
    orders[team.id] = buildBestOrder(team);
  }

  return {
    ...prev,
    teams,
    orders,
    weekIndex: 0,
    schedule: generateSeason(teams),
    gameCursor: 0,
    records: emptyRecords(teams),
    playerStats: {},
    postseasonStats: {}, // 翌シーズンのポストシーズン成績はリセット
    postseason: null,
    year: nextYear,
    phase: 'REGULAR',
    offseasonStage: null,
    draft: null,
    foreignScout: null,
    injuries: {}, // オフシーズンで全快
    recentGames: [], // 翌シーズンはリセット
    starterLastDay: {}, // ローテ状態も翌シーズンでリセット
    relieverConsecutive: {}, // 連投状態もリセット
    postRotationIdx: {}, // ポストシーズンローテも翌シーズンでリセット
    springCampReport: campReport,
    seasonStartAbilities: snapshotAbilities(teams), // 開幕時能力を記録（今季増減の基準）
    // 履歴・タイトル・殿堂はそのまま引き継ぎ（呼び出し側で更新済み）
  };
}

/**
 * セーブデータ読み込み時の整合性検証と自動修復を行う。
 * - 選手IDの重複検出と再採番（ドラフト・外国人等のID重複による記録混同を完全防止）
 * - オーダーの整合性修復
 * - playerCareers の欠損バックフィルおよび異常データ（異常な年齢・球速・記録混入）のサニタイズ
 * - seasonStartAbilities の欠損補完
 */
export function sanitizeGameState(state: GameState): GameState {
  if (!state || !Array.isArray(state.teams) || state.teams.length === 0) {
    return state;
  }

  // 1. 全球団の選手IDの重複検出と再採番、および球威・球速の整合性補正
  const seenIds = new Set<string>();

  for (const team of state.teams) {
    for (const player of team.players) {
      // 投手の球威(stuff)・球速(velocity)の整合性担保・移行処理
      if (player.type === 'PITCHER') {
        if (player.stuff == null || isNaN(player.stuff)) {
          player.stuff = calcStuff(player.velocity);
        }
        player.velocity = calcVelocity(player.stuff);
      } else if (player.stuff == null || isNaN(player.stuff)) {
        player.stuff = 15;
      }

      if (seenIds.has(player.id)) {
        const oldId = player.id;
        const newId = generateUniquePlayerId();
        player.id = newId;

        // team.rosterLevel の更新
        if (team.rosterLevel && team.rosterLevel[oldId] && !team.rosterLevel[newId]) {
          team.rosterLevel[newId] = team.rosterLevel[oldId];
        }

        // 過去年度別成績の個別生成（他人の記録との混同を防止）
        if (!state.playerCareers) state.playerCareers = {};
        if (player.debutYear < state.year) {
          state.playerCareers[newId] = generatePlayerPastCareer(player, state.year, team.id, team.nickName);
        } else {
          state.playerCareers[newId] = { playerId: newId, seasons: [] };
        }

        // 成績・能力スナップショットの個別付与
        if (state.playerStats) {
          state.playerStats[newId] = {};
        }
        if (state.seasonStartAbilities) {
          state.seasonStartAbilities[newId] = {
            contact: player.contact,
            power: player.power,
            speed: player.speed,
            defense: player.defense,
            stuff: player.stuff,
            velocity: player.velocity,
            breaking: player.breaking,
            control: player.control,
            stamina: player.stamina,
            age: player.age,
          };
        }
      } else {
        seenIds.add(player.id);
      }
    }
  }

  // ドラフト候補・外国人候補プール内のID重複も防止および球威補正
  if (state.draft?.pool) {
    for (const p of state.draft.pool) {
      if (p.type === 'PITCHER') {
        if (p.stuff == null || isNaN(p.stuff)) p.stuff = calcStuff(p.velocity);
        p.velocity = calcVelocity(p.stuff);
      } else if (p.stuff == null || isNaN(p.stuff)) {
        p.stuff = 15;
      }
      if (seenIds.has(p.id)) {
        p.id = generateUniquePlayerId();
      }
      seenIds.add(p.id);
    }
  }
  if (state.foreignScout?.pool) {
    for (const list of Object.values(state.foreignScout.pool)) {
      if (Array.isArray(list)) {
        for (const p of list) {
          if (p.type === 'PITCHER') {
            if (p.stuff == null || isNaN(p.stuff)) p.stuff = calcStuff(p.velocity);
            p.velocity = calcVelocity(p.stuff);
          } else if (p.stuff == null || isNaN(p.stuff)) {
            p.stuff = 15;
          }
          if (seenIds.has(p.id)) {
            p.id = generateUniquePlayerId();
          }
          seenIds.add(p.id);
        }
      }
    }
  }

  // 2. orders の整合性チェック＆補正
  if (!state.orders) {
    state.orders = buildInitialOrders(state.teams);
  } else {
    for (const team of state.teams) {
      const order = state.orders[team.id];
      if (!order) {
        state.orders[team.id] = buildBestOrder(team);
        continue;
      }
      const validPids = new Set(team.players.map((p) => p.id));
      const hasInvalid =
        !Array.isArray(order.lineup) ||
        !Array.isArray(order.pitchers) ||
        order.lineup.length !== 9 ||
        order.pitchers.length !== 14 ||
        order.lineup.some((s) => !validPids.has(s.playerId)) ||
        order.pitchers.some((p) => !validPids.has(p.playerId)) ||
        (Array.isArray(order.benchBatters) && order.benchBatters.some((id) => !validPids.has(id))) ||
        (Array.isArray(order.farmBatters) && order.farmBatters.some((id) => !validPids.has(id))) ||
        (Array.isArray(order.farmPitchers) && order.farmPitchers.some((id) => !validPids.has(id)));

      if (hasInvalid) {
        state.orders[team.id] = buildBestOrder(team);
      }
    }
  }

  // 3. playerCareers のバックフィル＆データサニタイズ（異常値・重複・混入の修復）
  if (!state.playerCareers) {
    state.playerCareers = {};
  }
  state.playerCareers = backfillMissingCareers(state.teams, state.playerCareers, state.year);
  state.playerCareers = sanitizePlayerCareers(state.teams, state.playerCareers, state.year);

  // 4. seasonStartAbilities の欠損補完
  if (!state.seasonStartAbilities) {
    state.seasonStartAbilities = snapshotAbilities(state.teams);
  } else {
    for (const team of state.teams) {
      for (const p of team.players) {
        if (!state.seasonStartAbilities[p.id]) {
          state.seasonStartAbilities[p.id] = {
            contact: p.contact,
            power: p.power,
            speed: p.speed,
            defense: p.defense,
            velocity: p.velocity,
            breaking: p.breaking,
            control: p.control,
            stamina: p.stamina,
            age: p.age,
          };
        }
      }
    }
  }

  if (!Array.isArray(state.hallOfFame)) {
    state.hallOfFame = [];
  }

  if (state.springCampReport === undefined) {
    state.springCampReport = null;
  }

  return state;
}

/** localStorage から読み込む。無効/未保存なら null */
export function loadGameState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    // バージョンが存在し、現在以下のバージョンであればサニタイズして最新版として復元
    if (typeof parsed.version !== 'number' || parsed.version > SCHEMA_VERSION) {
      return null;
    }
    if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) return null;
    parsed.version = SCHEMA_VERSION;
    return sanitizeGameState(parsed);
  } catch {
    return null;
  }
}

/** localStorage に有効なプレイ中セーブデータがあるかどうか（マイチーム選択済み） */
export function hasLocalGameState(): boolean {
  const state = loadGameState();
  return state !== null && state.myTeamId !== null;
}

/** localStorage へ保存（保存日時も記録。savedAt が指定されればそれを使用、省略時は現在日時） */
export function saveGameState(state: GameState, savedAt?: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(SAVED_AT_KEY, savedAt ?? new Date().toISOString());
  } catch {
    // 保存失敗は致命的ではないので握りつぶす（容量超過など）
  }
}

/** ローカルの最終保存日時を取得 */
export function getLocalSavedAt(): string | null {
  return localStorage.getItem(SAVED_AT_KEY);
}

/** 保存データを消去（タイトルへ戻る/リセット用） */
export function clearGameState(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SAVED_AT_KEY);
}

/** マイチームを取得 */
export function getMyTeam(state: GameState): Team | null {
  if (!state.myTeamId) return null;
  return state.teams.find((t) => t.id === state.myTeamId) ?? null;
}

/** 指定球団のオーダーを取得（無ければベストオーダーを生成して返す） */
export function getOrder(state: GameState, teamId: string): TeamOrder | null {
  const existing = state.orders[teamId];
  if (existing) return existing;
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return null;
  return buildBestOrder(team);
}

/** 試合結果を勝敗記録へ反映（recordsをミューテート） */
export function applyResultToRecords(records: Record<string, TeamRecord>, res: GameResult): void {
  const away = records[res.awayTeamId];
  const home = records[res.homeTeamId];
  if (!away || !home) return;
  if (res.draw) {
    away.draws++;
    home.draws++;
  } else if (res.winnerId === res.homeTeamId) {
    home.wins++;
    away.losses++;
  } else {
    away.wins++;
    home.losses++;
  }
}
