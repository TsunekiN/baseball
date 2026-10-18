// ============================================================
// ドラフト会議
// 候補プール生成 → 1巡目入札・抽選 → 2巡目以降ウェーバー（スネーク）→ 指名終了
// ============================================================

import type { GameState, DraftState } from './gameState';
import type { League, Player, Team } from './types';
import {
  generateDraftProspects,
  generateRound1CpuBids,
  resolveCpuCompetitions,
  createLotteryDraw,
  pickForCpu,
} from './draft';

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
