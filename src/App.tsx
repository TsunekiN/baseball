import { useEffect, useRef, useState } from 'react';
import type { TeamOrder } from './domain/types';
import {
  createNewGameState,
  getMyTeam,
  loadGameState,
  clearGameState,
  saveGameState,
  type AdvanceUnit,
  type GameState,
} from './domain/gameState';
import { advanceMatches } from './match/progress';
import { applyWeeklyGrowth } from './domain/growthEngine';
import {
  runOffseason,
  startDraft,
  makeDraftPick,
  resolveLotteryDraw,
  confirmLotteryOutcome,
  finishMyTeamDraft,
  releasePlayer,
  scoutDraftProspect,
  finalizeOffseason,
  startForeignScout,
  offerForeignProspects,
  signForeign,
  finishForeignScout,
  canSignForeign,
} from './domain/offseason';
import type { Position } from './domain/types';
import { advancePostseason } from './match/postseasonProgress';
import { initPostseason, type PostseasonState } from './match/postseason';
import { buildStandings, pennantMagicInfo } from './domain/standings';
import { weekDef } from './domain/schedule';
import type { HallOfFamer } from './domain/stats';
import type { GameResult } from './match/matchTypes';
import { StartScreen } from './components/StartScreen';
import { MainScreen } from './components/MainScreen';
import { HeaderSchedule } from './components/HeaderSchedule';
import { LoginScreen } from './components/LoginScreen';
import { useTheme } from './hooks/useTheme';
import type { User } from 'firebase/auth';
import {
  subscribeAuthState,
  loadGameStateFromCloud,
  saveGameStateToCloud,
  clearGameStateFromCloud,
} from './firebase';

export default function App() {
  // 保存済みがあれば復元、なければ新規（12球団生成・マイチーム未選択）
  const [game, setGame] = useState<GameState>(() => loadGameState() ?? createNewGameState());
  const [lastResults, setLastResults] = useState<GameResult[]>([]);
  // 故障者リストの未確認通知（選手タブで確認するとクリア）
  const [injuryBadge, setInjuryBadge] = useState(false);
  const [injuryAlerts, setInjuryAlerts] = useState<string[]>([]);
  // お知らせ通知（開幕・交流戦・CS・日本シリーズ。緑枠で表示）
  const [noticeAlerts, setNoticeAlerts] = useState<string[]>([]);
  const { theme, toggleTheme } = useTheme();

  // 認証済みか、セーブデータが存在するか管理
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudSaving, setCloudSaving] = useState(false);
  // クラウドからの初回読み込みが完了したかどうかのフラグ
  const isCloudLoadedRef = useRef(false);

  // 認証状態の監視
  useEffect(() => {
    const unsubscribe = subscribeAuthState(async (user) => {
      setAuthUser(user);
      if (user) {
        // ログイン時: クラウドにセーブデータがあれば取得して続きから再開
        const cloudGame = await loadGameStateFromCloud(user.uid);
        if (cloudGame) {
          setGame(cloudGame);
          saveGameState(cloudGame); // ローカルキャッシュも同期
        } else {
          // セーブデータがない新規ユーザー: マイチーム未選択の初期ステートを用意（球団選択画面へ）
          const newGame = createNewGameState();
          setGame(newGame);
        }
      } else {
        // ログアウト時: 一旦クリア
        isCloudLoadedRef.current = false;
      }
      setAuthLoading(false);
      isCloudLoadedRef.current = true;
    });
    return () => unsubscribe();
  }, []);

  // 「次の試合に進む」連打による多重進行を防ぐガード。
  // 進行開始でtrueにし、state(game)が実際に更新されたら解除する。
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [game]);

  // 状態が変わるたびにローカル保存 & クラウド保存
  useEffect(() => {
    saveGameState(game);

    if (authUser && isCloudLoadedRef.current) {
      setCloudSaving(true);
      const timer = setTimeout(async () => {
        await saveGameStateToCloud(authUser.uid, game);
        setCloudSaving(false);
      }, 500); // 連続操作時の書き込み頻度を抑制（デバウンス）
      return () => clearTimeout(timer);
    }
  }, [game, authUser]);

  const myTeam = getMyTeam(game);

  // マイチームを決定
  const handleDecide = (teamId: string) => {
    setGame((prev) => ({ ...prev, myTeamId: teamId }));
  };

  // 選手を再生成（スタート画面でのみ使用）
  const handleRegenerate = () => {
    setGame(createNewGameState());
  };

  // 全データを削除して初期化（セーブデータ消去＋新規ゲーム生成）
  const handleReset = async () => {
    clearGameState();
    if (authUser) {
      await clearGameStateFromCloud(authUser.uid);
    }
    setGame(createNewGameState());
  };

  // 現在のデータを明示的に保存（ローカルおよびクラウド）
  const handleManualSave = async () => {
    saveGameState(game);
    if (authUser) {
      setCloudSaving(true);
      try {
        await saveGameStateToCloud(authUser.uid, game);
      } finally {
        setCloudSaving(false);
      }
    }
  };

  // オーダー更新（選手タブの編成画面から）
  const handleUpdateOrder = (teamId: string, order: TeamOrder) => {
    setGame((prev) => ({
      ...prev,
      orders: { ...prev.orders, [teamId]: order },
    }));
  };

  // 新規負傷・復帰をバッジ＋アラートで通知
  const notifyInjuries = (results: GameResult[]) => {
    const msgs: string[] = [];
    for (const r of results) {
      for (const inj of r.injuries ?? []) {
        msgs.push(`${inj.name} が全治${inj.games}試合の${inj.severe ? '大ケガ' : 'ケガ'}で離脱`);
      }
      for (const name of r.returns ?? []) {
        msgs.push(`${name} がケガから復帰`);
      }
    }
    if (msgs.length > 0) {
      setInjuryAlerts(msgs);
      setInjuryBadge(true);
    }
  };

  // 日程を進める（レギュラー→ポストシーズン）
  const handleAdvance = () => {
    // 連打ガード: 進行中（前回のstate反映待ち）なら無視する
    if (advancingRef.current) return;
    advancingRef.current = true;

    // ポストシーズン中（CS開幕・日本シリーズ開幕・日本一の通知は出さない）
    if (game.postseason && game.postseason.stage !== 'DONE') {
      const out = advancePostseason(game);
      setGame((prev) => ({
        ...prev,
        postseason: out.postseason,
        recentGames: out.recentGames,
        postseasonStats: out.postseasonStats,
        postRotationIdx: out.postRotationIdx,
      }));
      if (out.myResults.length > 0) setLastResults(out.myResults);
      return;
    }
    // 日本シリーズ終了（DONE）でまだオフシーズン未処理なら、オフシーズン処理を実行
    if (game.postseason && game.postseason.stage === 'DONE') {
      if (game.phase === 'REGULAR') {
        setGame((prev) => runOffseason(prev));
      } else {
        // state を更新しないパスではガードを即解除（固まり防止）
        advancingRef.current = false;
      }
      return; // オフシーズン結果はサマリー画面で確認（翌シーズン開幕は別操作）
    }

    // レギュラーシーズン
    const wasInterleague = weekDef(game.weekIndex).kind === 'INTERLEAGUE';
    // 進行前のマイチームのマジック情報（点灯/確定の遷移の瞬間だけ通知するため）
    const magicBefore =
      myTeam ? pennantMagicInfo(game.teams, myTeam.league, game.records, game.schedule, game.gameCursor) : null;
    const myMagicBefore = magicBefore && magicBefore.teamId === myTeam?.id ? magicBefore : null;
    const out = advanceMatches(game);
    let postseason: PostseasonState | null = game.postseason;
    if (out.finished && !postseason) {
      // 最終順位からポストシーズンを初期化
      const cenRows = buildStandings(game.teams, 'CENTRAL', out.records);
      const pacRows = buildStandings(game.teams, 'PACIFIC', out.records);
      const cen = cenRows.map((r) => r.team.id);
      const pac = pacRows.map((r) => r.team.id);
      // 2位・3位の1位からのゲーム差（CSファイナルのアドバンテージ判定用）
      const cenGb = { second: cenRows[1]?.gamesBehind ?? 0, third: cenRows[2]?.gamesBehind ?? 0 };
      const pacGb = { second: pacRows[1]?.gamesBehind ?? 0, third: pacRows[2]?.gamesBehind ?? 0 };
      postseason = initPostseason(cen, pac, cenGb, pacGb);
    }
    // 週の進行分だけ全選手の能力を成長/衰えさせる（負傷IL・補充を反映した teams に対して）
    const weeksAdvanced = out.weekIndex - game.weekIndex;
    const grownTeams = applyWeeklyGrowth(out.teams, weeksAdvanced);

    setGame((prev) => ({
      ...prev,
      teams: grownTeams,
      orders: out.orders,
      records: out.records,
      gameCursor: out.gameCursor,
      weekIndex: out.weekIndex,
      playerStats: out.playerStats,
      injuries: out.injuries,
      recentGames: out.recentGames,
      starterLastDay: out.starterLastDay,
      relieverConsecutive: out.relieverConsecutive,
      postseason,
    }));
    if (out.myResults.length > 0) setLastResults(out.myResults);
    notifyInjuries(out.myResults);

    // お知らせ（緑枠）: 開幕・交流戦・CS開幕。優先度は CS > 交流戦 > 開幕。
    const nowInterleague = !out.finished && weekDef(out.weekIndex).kind === 'INTERLEAGUE';
    const notices: string[] = [];
    // 優勝マジックのお知らせ: 点灯の瞬間＝「M{N}が点灯！」、確定の瞬間＝「優勝決定！」
    if (myTeam) {
      const magicAfter = pennantMagicInfo(game.teams, myTeam.league, out.records, game.schedule, out.gameCursor);
      const myMagicAfter = magicAfter && magicAfter.teamId === myTeam.id ? magicAfter : null;
      const leagueName = myTeam.league === 'CENTRAL' ? 'セ・リーグ' : 'パ・リーグ';
      if (myMagicAfter) {
        const beforeClinched = !!myMagicBefore && myMagicBefore.magic <= 0;
        if (myMagicAfter.magic <= 0) {
          // 優勝確定（M≤0）。確定済みでなかった場合のみ通知。
          if (!beforeClinched) {
            notices.push(`${myTeam.name}が${leagueName}優勝決定！`);
          }
        } else {
          // マジック点灯中（M≥1）。前が非点灯だった場合のみ通知。
          if (!myMagicBefore) {
            notices.push(`${myTeam.name}にM${myMagicAfter.magic}が点灯！`);
          }
        }
      }
    }
    // CS開幕・ペナント開幕の通知は出さない（開幕は試合画面に大きく表示する）。交流戦のみ通知。
    if (!wasInterleague && nowInterleague) {
      notices.push(`${game.year}年度交流戦スタート！`);
    }
    if (notices.length > 0) setNoticeAlerts(notices);
  };

  // オフシーズン結果を確認し終えて翌シーズンを開幕する（ドラフト完了後に呼ばれる）
  const handleStartNextSeason = () => {
    setLastResults([]);
    setGame((prev) => finalizeOffseason(prev));
  };

  // ドラフト会議の開始
  const handleStartDraft = () => {
    setGame((prev) => startDraft(prev));
  };

  // ドラフト指名
  const handlePickDraft = (prospectId: string) => {
    setGame((prev) => makeDraftPick(prev, prospectId));
  };

  // くじ引きカードのタップ
  const handleLotteryDraw = (cardIndex: number) => {
    setGame((prev) => resolveLotteryDraw(prev, cardIndex));
  };

  // くじ引き結果確認後の確定
  const handleConfirmLottery = () => {
    setGame((prev) => confirmLotteryOutcome(prev));
  };

  // ドラフト指名終了
  const handleFinishDraft = () => {
    setGame((prev) => finishMyTeamDraft(prev));
  };

  // ドラフト候補のスカウト調査
  const handleScoutDraft = (prospectId: string) => {
    setGame((prev) => scoutDraftProspect(prev, prospectId));
  };

  // 外国人スカウト開始（ドラフト完了後）
  const handleStartForeignScout = () => {
    setGame((prev) => startForeignScout(prev));
  };

  // 外国人候補の提示（ポジション指定）
  const handleOfferForeign = (position: Position) => {
    setGame((prev) => offerForeignProspects(prev, position));
  };

  // 外国人の獲得
  const handleSignForeign = (prospectId: string) => {
    setGame((prev) => signForeign(prev, prospectId));
  };

  // 外国人スカウト終了 → 翌シーズン開幕
  const handleFinishForeignScout = () => {
    setLastResults([]);
    setGame((prev) => finalizeOffseason(finishForeignScout(prev)));
  };

  // 自由契約（戦力外通告）
  const handleReleasePlayer = (playerId: string) => {
    setGame((prev) => releasePlayer(prev, playerId));
  };

  // 殿堂入りの承認/辞退
  const handleHofDecide = (hof: HallOfFamer, accept: boolean) => {
    setGame((prev) => {
      const report = prev.offseasonReport;
      if (!report) return prev;
      const remaining = report.hofCandidates.filter((c) => c.player.id !== hof.player.id);
      const retirements = report.retirements.map((r) =>
        r.playerId === hof.player.id ? { ...r, hallOfFame: accept } : r,
      );
      return {
        ...prev,
        hallOfFame: accept ? [hof, ...prev.hallOfFame] : prev.hallOfFame,
        offseasonReport: { ...report, hofCandidates: remaining, retirements },
      };
    });
  };

  // 進行単位の変更
  const handleChangeAdvanceUnit = (unit: AdvanceUnit) => {
    setGame((prev) => ({ ...prev, advanceUnit: unit }));
  };

  // 未ログイン時はトップページとしてログイン画面を表示
  if (!authUser) {
    return <LoginScreen loading={authLoading} />;
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          {myTeam ? (
            <HeaderSchedule
              teams={game.teams}
              myTeam={myTeam}
              weekIndex={game.weekIndex}
              year={game.year}
              records={game.records}
              gameCursor={game.gameCursor}
              schedule={game.schedule}
            />
          ) : (
            <h1 className="app-title">操作する球団を選択して下さい。</h1>
          )}
        </div>
      </header>

      <main className="app-main">
        {myTeam ? (
          <MainScreen
            teams={game.teams}
            myTeam={myTeam}
            weekIndex={game.weekIndex}
            orders={game.orders}
            records={game.records}
            schedule={game.schedule}
            gameCursor={game.gameCursor}
            advanceUnit={game.advanceUnit}
            lastResults={lastResults}
            playerStats={game.playerStats}
            postseasonStats={game.postseasonStats}
            playerCareers={game.playerCareers}
            playerTitles={game.playerTitles}
            seasonHistory={game.seasonHistory}
            hallOfFame={game.hallOfFame}
            injuries={game.injuries}
            recentGames={game.recentGames}
            seasonStartAbilities={game.seasonStartAbilities}
            postseason={game.postseason}
            phase={game.phase}
            offseasonReport={game.offseasonReport}
            offseasonStage={game.offseasonStage}
            draft={game.draft}
            foreignScout={game.foreignScout}
            canSignForeign={canSignForeign(game)}
            year={game.year}
            theme={theme}
            authUser={authUser}
            authLoading={authLoading}
            cloudSaving={cloudSaving}
            onToggleTheme={toggleTheme}
            onSave={handleManualSave}
            onReset={handleReset}
            onUpdateOrder={handleUpdateOrder}
            onAdvance={handleAdvance}
            onStartDraft={handleStartDraft}
            onPickDraft={handlePickDraft}
            onLotteryDraw={handleLotteryDraw}
            onConfirmLottery={handleConfirmLottery}
            onScoutDraft={handleScoutDraft}
            onFinishDraft={handleFinishDraft}
            onStartForeignScout={handleStartForeignScout}
            onOfferForeign={handleOfferForeign}
            onSignForeign={handleSignForeign}
            onFinishForeignScout={handleFinishForeignScout}
            onStartNextSeason={handleStartNextSeason}
            onHofDecide={handleHofDecide}
            onChangeAdvanceUnit={handleChangeAdvanceUnit}
            onReleasePlayer={handleReleasePlayer}
            injuryBadge={injuryBadge}
            onClearInjuryBadge={() => setInjuryBadge(false)}
            injuryAlerts={injuryAlerts}
            onCloseInjuryAlerts={() => setInjuryAlerts([])}
            noticeAlerts={noticeAlerts}
            onCloseNoticeAlerts={() => setNoticeAlerts([])}
          />
        ) : (
          <StartScreen
            teams={game.teams}
            onDecide={handleDecide}
            onRegenerate={handleRegenerate}
          />
        )}
      </main>
    </>
  );
}
