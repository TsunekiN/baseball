import { useEffect, useRef, useState } from 'react';
import type { Team, TeamOrder } from './domain/types';
import {
  createNewGameState,
  getMyTeam,
  loadGameState,
  clearGameState,
  saveGameState,
  getLocalSavedAt,
  hasLocalGameState,
  type AdvanceUnit,
  type GameState,
} from './domain/gameState';
import { advanceMatches } from './match/progress';
import { applyWeeklyGrowth } from './domain/growthEngine';
import { runOffseason, releasePlayer, finalizeOffseason } from './domain/offseason';
import {
  startDraft,
  makeDraftPick,
  resolveLotteryDraw,
  confirmLotteryOutcome,
  finishMyTeamDraft,
  scoutDraftProspect,
} from './domain/draftFlow';
import {
  startForeignScout,
  offerForeignProspects,
  signForeign,
  finishForeignScout,
  canSignForeign,
} from './domain/foreignScoutFlow';
import type { Position } from './domain/types';
import { advancePostseason } from './match/postseasonProgress';
import { initPostseason, type PostseasonState } from './match/postseason';
import { buildStandings } from './domain/standings';
import { detectMilestoneNotices } from './domain/milestones';
import type { HallOfFamer } from './domain/stats';
import type { GameResult } from './match/matchTypes';
import { StartScreen } from './components/StartScreen';
import { MainScreen } from './components/MainScreen';
import { SpringCampModal } from './components/SpringCampModal';
import { HeaderSchedule } from './components/HeaderSchedule';
import { LoginScreen } from './components/LoginScreen';
import { useTheme } from './hooks/useTheme';
import { useDebugMode } from './hooks/useDebugMode';
import type { User } from 'firebase/auth';
import {
  subscribeAuthState,
  loadGameStateFromCloud,
  saveGameStateToCloud,
  clearGameStateFromCloud,
} from './firebase';

export default function App() {
  // 保存済みがあれば復元、なければ新規（12球団生成・マイチーム未選択）
  const [game, setGame] = useState<GameState>(() => {
    const local = loadGameState();
    console.log('[App Init] LocalStorage game:', local ? `year=${local.year}, week=${local.weekIndex}` : 'null');
    return local ?? createNewGameState();
  });
  const [lastResults, setLastResults] = useState<GameResult[]>([]);
  // 故障者リストの未確認通知（選手タブで確認するとクリア）
  const [injuryBadge, setInjuryBadge] = useState(false);
  const [injuryAlerts, setInjuryAlerts] = useState<string[]>([]);
  // お知らせ通知（開幕・交流戦・CS・日本シリーズ。緑枠で表示）
  const [noticeAlerts, setNoticeAlerts] = useState<string[]>([]);
  // 春季キャンプ覚醒モーダルの表示制御
  const [showSpringCamp, setShowSpringCamp] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { debugMode, toggleDebugMode, resetDebugMode } = useDebugMode();

  // 認証済みか、セーブデータが存在するか管理
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudSaving, setCloudSaving] = useState(false);
  // クラウド保存エラーメッセージ（null = エラーなし）
  const [cloudSaveError, setCloudSaveError] = useState<string | null>(null);
  // クラウドからの初回読み込み・比較が完了したかどうかのフラグ
  const isCloudLoadedRef = useRef(false);
  // 最後にローカルストレージへ保存した状態（不要な再保存・タイムスタンプ上書きを防止）
  const lastSavedGameRef = useRef<GameState>(game);
  // 常に最新の game を参照するための ref（stale closure 防止）
  const gameRef = useRef(game);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // 認証状態の監視
  useEffect(() => {
    const unsubscribe = subscribeAuthState(async (user) => {
      console.log('[Auth] State changed. user:', user?.uid ?? 'null');
      setAuthUser(user);
      if (user) {
        // ログイン時: クラウドロード完了前の自動保存を防ぐ
        isCloudLoadedRef.current = false;
        console.log('[Auth] Starting cloud load & compare...');
        try {
          const result = await loadGameStateFromCloud(user.uid);
          console.log(
            '[Auth] Cloud load result:',
            result
              ? `year=${result.state.year}, week=${result.state.weekIndex}, updatedAt=${result.updatedAt}`
              : 'null',
          );

          const hasLocal = hasLocalGameState();
          const localSavedAt = getLocalSavedAt();
          const cloudUpdatedAt = result?.updatedAt;

          console.log('[Auth] hasLocal:', hasLocal, '/ localSavedAt:', localSavedAt, '/ cloudUpdatedAt:', cloudUpdatedAt);

          if (result && hasLocal) {
            // ローカルにもクラウドにもデータがある場合: タイムスタンプを比較して新しい方を読み込む
            const localTime = localSavedAt ? new Date(localSavedAt).getTime() : 0;
            const cloudTime = cloudUpdatedAt ? new Date(cloudUpdatedAt).getTime() : 0;
            const validLocalTime = !isNaN(localTime) && localTime > 0;
            const validCloudTime = !isNaN(cloudTime) && cloudTime > 0;

            let localIsNewer = false;
            if (validLocalTime && validCloudTime) {
              localIsNewer = localTime > cloudTime;
            } else if (validLocalTime) {
              localIsNewer = true;
            } else if (validCloudTime) {
              localIsNewer = false;
            } else {
              // どちらもタイムスタンプ無効な場合は進行度（年・週・消化試合数）を比較
              const currentLocal = gameRef.current;
              if (currentLocal.year > result.state.year) {
                localIsNewer = true;
              } else if (currentLocal.year === result.state.year) {
                localIsNewer = currentLocal.gameCursor > result.state.gameCursor;
              } else {
                localIsNewer = false;
              }
            }

            console.log(
              '[Auth] Comparison result: localIsNewer =',
              localIsNewer,
              `(localSavedAt: ${localSavedAt}, cloudUpdatedAt: ${cloudUpdatedAt})`,
            );

            if (localIsNewer) {
              // ローカルの方が新しい → ローカル状態を維持（クラウドへは自動保存せず手動保存のみ）
              console.log('[Auth] Local cache is newer → keeping local state.');
            } else {
              // クラウドの方が新しい（または同等） → クラウドデータを読み込んで適用、ローカルキャッシュも同期
              console.log('[Auth] Cloud data is newer or equal → loading cloud data.');
              setGame(result.state);
              saveGameState(result.state, result.updatedAt);
              lastSavedGameRef.current = result.state;
              setLastResults([]);
              setInjuryAlerts([]);
              setNoticeAlerts([]);
              setInjuryBadge(false);
            }
          } else if (result && !hasLocal) {
            // ローカルにプレイ中データがなくクラウドに有効データがある場合 → クラウドデータを読み込む
            console.log('[Auth] Valid cloud data found and no local active game. Loading cloud data.');
            setGame(result.state);
            saveGameState(result.state, result.updatedAt);
            lastSavedGameRef.current = result.state;
            setLastResults([]);
            setInjuryAlerts([]);
            setNoticeAlerts([]);
            setInjuryBadge(false);
          } else if (!result && hasLocal) {
            // クラウドにデータがなくローカルにデータがある場合 → ローカルデータを維持（クラウドへは自動保存せず手動保存のみ）
            console.log('[Auth] Cloud data not found. Keeping local cache.');
          } else {
            // どちらにもデータがない（新規ユーザー）
            console.log('[Auth] Neither local nor cloud data exists. Starting fresh.');
          }
        } catch (err) {
          // ネットワークエラー等でクラウドロードが完全に失敗
          // ローカルデータをそのまま使い、データを上書きしない
          console.error('[Auth] Cloud load failed (network error). Using local data.', err);
        }
        // クラウドからのロード・比較が完了してからローカル自動保存を許可する
        isCloudLoadedRef.current = true;
        console.log('[Auth] Cloud load/compare complete. Auto-save enabled.');
      } else {
        // ログアウト時: フラグをリセット
        isCloudLoadedRef.current = false;
        console.log('[Auth] Logged out. Auto-save disabled.');
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 「次の試合に進む」連打による多重進行を防ぐガード。
  // 進行開始でtrueにし、state(game)が実際に更新されたら解除する。
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [game]);

  // 故障者リスト(IL)の整合性補正:
  // 有効な負傷情報(gamesLeft>0)が無い、またはオフシーズン中なのに rosterLevel が 'IL' のまま残っている選手は
  // 二軍(FARM)へ戻す。残っていると一軍/編成の補充対象から外れ、投手が13人以下になったまま自動編成でも直らない。
  useEffect(() => {
    const isOff = game.phase === 'OFFSEASON';
    const stale = (t: Team) =>
      Object.entries(t.rosterLevel).some(
        ([id, lv]) => lv === 'IL' && (isOff || !((game.injuries?.[id]?.gamesLeft ?? 0) > 0)),
      );
    if (!game.teams.some(stale)) return;
    setGame((prev) => ({
      ...prev,
      teams: prev.teams.map((t) => {
        const off = prev.phase === 'OFFSEASON';
        const rosterLevel = { ...t.rosterLevel };
        let changed = false;
        for (const [id, lv] of Object.entries(rosterLevel)) {
          if (lv === 'IL' && (off || !((prev.injuries?.[id]?.gamesLeft ?? 0) > 0))) {
            rosterLevel[id] = 'FARM';
            changed = true;
          }
        }
        return changed ? { ...t, rosterLevel } : t;
      }),
    }));
  }, [game.teams, game.injuries, game.phase]);

  // 状態が変わるたびにローカル保存（無料）。
  // ※ クラウド保存は「現在のデータを保存」ボタン（手動）のみ行い、自動では保存しない。
  useEffect(() => {
    // ログイン＆クラウド比較が完了する前はローカル保存しない（起動時のタイムスタンプ汚染を防止）
    if (!isCloudLoadedRef.current) return;
    if (game === lastSavedGameRef.current) return;

    saveGameState(game);
    lastSavedGameRef.current = game;
  }, [game]);

  // タブを閉じる直前にローカルストレージへ確実に保存する
  useEffect(() => {
    const handleBeforeUnload = () => {
      // クラウドロード完了後、かつ未保存の変更がある場合のみ
      if (isCloudLoadedRef.current && gameRef.current !== lastSavedGameRef.current) {
        saveGameState(gameRef.current);
        lastSavedGameRef.current = gameRef.current;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

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
    resetDebugMode();
    if (authUser) {
      await clearGameStateFromCloud(authUser.uid);
    }
    const fresh = createNewGameState();
    setGame(fresh);
    lastSavedGameRef.current = fresh;
  };

  // 現在のデータを明示的に保存（ローカルおよびクラウド）
  const handleManualSave = async () => {
    const now = new Date().toISOString();
    saveGameState(game, now);
    lastSavedGameRef.current = game;
    if (authUser) {
      setCloudSaving(true);
      setCloudSaveError(null);
      try {
        await saveGameStateToCloud(authUser.uid, game, now);
      } catch (err) {
        console.error('[ManualSave] Cloud save failed:', err);
        setCloudSaveError('クラウドへの保存に失敗しました。ネットワーク接続を確認してください。');
      } finally {
        setCloudSaving(false);
      }
    }
  };

  // クラウドからセーブデータを手動で読み込む
  const handleCloudLoad = async (): Promise<{ success: boolean; message: string }> => {
    if (!authUser) {
      return { success: false, message: 'ログインしていません' };
    }
    setCloudSaveError(null);
    try {
      const result = await loadGameStateFromCloud(authUser.uid);
      if (!result) {
        return { success: false, message: 'セーブデータがありません' };
      }
      setGame(result.state);
      saveGameState(result.state, result.updatedAt);
      lastSavedGameRef.current = result.state;
      setLastResults([]);
      setInjuryAlerts([]);
      setNoticeAlerts([]);
      setInjuryBadge(false);
      isCloudLoadedRef.current = true;
      return { success: true, message: `${result.state.year}年のデータを読込` };
    } catch (err) {
      console.error('[ManualCloudLoad] Failed to load from cloud:', err);
      return { success: false, message: '読み込みに失敗しました' };
    }
  };

  // オーダー更新（選手タブの編成画面から）
  const handleUpdateOrder = (teamId: string, order: TeamOrder) => {
    setGame((prev) => {
      // オーダーの選手配置に基づいて team.rosterLevel も整合性を保つ
      const nextTeams = prev.teams.map((t) => {
        if (t.id !== teamId) return t;
        const rosterLevel = { ...t.rosterLevel };
        // 一軍野手
        for (const slot of order.lineup) {
          if (slot?.playerId) rosterLevel[slot.playerId] = 'FIRST';
        }
        for (const id of order.benchBatters) {
          if (id) rosterLevel[id] = 'FIRST';
        }
        // 二軍野手（IL以外をFARMに）
        for (const id of order.farmBatters) {
          if (id && rosterLevel[id] !== 'IL') rosterLevel[id] = 'FARM';
        }
        // 一軍投手
        for (const p of order.pitchers) {
          if (p?.playerId) rosterLevel[p.playerId] = 'FIRST';
        }
        // 二軍投手（IL以外をFARMに）
        for (const id of order.farmPitchers) {
          if (id && rosterLevel[id] !== 'IL') rosterLevel[id] = 'FARM';
        }
        return { ...t, rosterLevel };
      });
      return {
        ...prev,
        teams: nextTeams,
        orders: { ...prev.orders, [teamId]: order },
      };
    });
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
      if (out.myResults.length > 0) {
        setLastResults(out.myResults);
      } else {
        setLastResults([]);
      }
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

    // お知らせ通知（投手の通算100/150/200...勝・セーブ、野手の通算200/300...本塁打、通算1000/1500...安打。マイチームの選手のみ）
    const notices = detectMilestoneNotices({
      teams: game.teams,
      playerCareers: game.playerCareers,
      beforeStats: game.playerStats,
      afterStats: out.playerStats,
      targetTeamId: game.myTeamId,
    });
    if (notices.length > 0) {
      setNoticeAlerts(notices);
    }
  };

  // オフシーズン結果を確認し終えて翌シーズンを開幕する（ドラフト完了後に呼ばれる）
  const handleStartNextSeason = () => {
    setLastResults([]);
    setGame((prev) => finalizeOffseason(prev));
    setShowSpringCamp(true);
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
    setShowSpringCamp(true);
  };

  // 春季キャンプ覚醒モーダルを閉じたときの処理
  const handleCloseSpringCamp = () => {
    setShowSpringCamp(false);
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
      {/* クラウド保存失敗時のエラーバナー */}
      {cloudSaveError && (
        <div className="cloud-save-error-banner">
          <span>⚠️ {cloudSaveError}</span>
          <button className="cloud-save-error-close" onClick={() => setCloudSaveError(null)}>×</button>
        </div>
      )}
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
            onCloudLoad={handleCloudLoad}
            onReset={handleReset}
            onUpdateOrder={handleUpdateOrder}
            onAdvance={handleAdvance}
            onStartDraft={handleStartDraft}
            onRestartDraft={handleStartDraft}
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
            debugMode={debugMode}
            onToggleDebugMode={toggleDebugMode}
          />
        ) : (
          <StartScreen
            teams={game.teams}
            onDecide={handleDecide}
            onRegenerate={handleRegenerate}
            onCloudLoad={handleCloudLoad}
          />
        )}
      </main>

      {showSpringCamp && game.springCampReport && (
        <SpringCampModal
          report={game.springCampReport}
          onClose={handleCloseSpringCamp}
        />
      )}
    </>
  );
}
