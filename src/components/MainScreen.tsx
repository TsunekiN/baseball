import { useEffect, useMemo, useState } from 'react';
import type { Team, TeamOrder, Player } from '../domain/types';
import type { AdvanceUnit, TeamRecord, GamePhase, PlayerCareer, SeasonHistory, InjuryEntry, DraftState, OffseasonStage, ForeignScoutState, RecentGame, AbilitySnapshot } from '../domain/gameState';
import type { Position } from '../domain/types';
import type { OffseasonReport } from '../domain/offseason';
import type { TitleCounts, HallOfFamer } from '../domain/stats';
import type { ScheduleGame } from '../domain/seasonSchedule';
import type { GameResult } from '../match/matchTypes';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { PostseasonState } from '../match/postseason';
import { calcTeamStrength } from '../domain/teamStrength';
import { sanitizeOrder } from '../domain/orderFactory';
import { rankFromValue } from '../domain/rank';
import { RankBadge } from './RankBadge';
import { StandingsScreen } from './StandingsScreen';
import { PlayersScreen } from './PlayersScreen';
import { PlayerHeroCard } from './PlayerHeroCard';
import { RecordScreen } from './RecordScreen';
import { GameScreen } from './GameScreen';
import { BottomNav, type NavTab } from './BottomNav';
import { ConfirmModal } from './ConfirmModal';
import type { Theme } from '../hooks/useTheme';
import type { User } from 'firebase/auth';
import { AuthButton } from './AuthButton';

interface Props {
  teams: Team[];
  myTeam: Team;
  weekIndex: number;
  orders: Record<string, TeamOrder>;
  records: Record<string, TeamRecord>;
  schedule: ScheduleGame[];
  gameCursor: number;
  advanceUnit: AdvanceUnit;
  lastResults: GameResult[];
  playerStats: Record<string, PlayerSeasonStats>;
  postseasonStats: Record<string, PlayerSeasonStats>;
  playerCareers: Record<string, PlayerCareer>;
  playerTitles: Record<string, TitleCounts>;
  seasonHistory: SeasonHistory[];
  hallOfFame: HallOfFamer[];
  injuries: Record<string, InjuryEntry>;
  recentGames: RecentGame[];
  seasonStartAbilities: Record<string, AbilitySnapshot>;
  postseason: PostseasonState | null;
  phase: GamePhase;
  offseasonReport: OffseasonReport | null;
  offseasonStage: OffseasonStage | null;
  draft: DraftState | null;
  foreignScout: ForeignScoutState | null;
  canSignForeign: boolean;
  year: number;
  theme: Theme;
  authUser: User | null;
  authLoading: boolean;
  cloudSaving: boolean;
  onToggleTheme: () => void;
  /** 現在のデータを手動保存する */
  onSave?: () => Promise<void> | void;
  /** クラウドからセーブデータを手動読み込みする */
  onCloudLoad?: () => Promise<{ success: boolean; message: string }>;
  /** 全データを削除して初期化する */
  onReset: () => void;
  onUpdateOrder: (teamId: string, order: TeamOrder) => void;
  onAdvance: () => void;
  onStartDraft: () => void;
  onRestartDraft?: () => void;
  onPickDraft: (prospectId: string) => void;
  onLotteryDraw: (cardIndex: number) => void;
  onConfirmLottery: () => void;
  onScoutDraft: (prospectId: string) => void;
  onFinishDraft: () => void;
  onStartForeignScout: () => void;
  onOfferForeign: (position: Position) => void;
  onSignForeign: (prospectId: string) => void;
  onFinishForeignScout: () => void;
  onStartNextSeason: () => void;
  onHofDecide: (hof: HallOfFamer, accept: boolean) => void;
  onChangeAdvanceUnit: (unit: AdvanceUnit) => void;
  onReleasePlayer?: (playerId: string) => void;
  injuryBadge: boolean;
  onClearInjuryBadge: () => void;
  /** ケガ通知（チーム総合力の下に表示）。空なら非表示 */
  injuryAlerts: string[];
  onCloseInjuryAlerts: () => void;
  /** お知らせ通知（開幕・優勝など。チーム総合力の下に表示）。空なら非表示 */
  noticeAlerts: string[];
  onCloseNoticeAlerts: () => void;
  debugMode?: boolean;
  onToggleDebugMode?: () => void;
}

const UNIT_LABELS: { unit: AdvanceUnit; label: string }[] = [
  { unit: 'game', label: '1試合' },
  { unit: 'week', label: '1週' },
  { unit: 'month', label: '1か月' },
];

/** メイン画面: マイチームのダッシュボード */
export function MainScreen({
  teams,
  myTeam,
  orders,
  records,
  schedule,
  gameCursor,
  advanceUnit,
  lastResults,
  playerStats,
  postseasonStats,
  playerCareers,
  playerTitles,
  seasonHistory,
  hallOfFame,
  injuries,
  recentGames,
  seasonStartAbilities,
  postseason,
  phase,
  offseasonReport,
  offseasonStage,
  draft,
  foreignScout,
  canSignForeign,
  year,
  theme,
  authUser,
  authLoading,
  cloudSaving,
  onToggleTheme,
  onSave,
  onCloudLoad,
  onReset,
  onUpdateOrder,
  onAdvance,
  onStartDraft,
  onRestartDraft,
  onPickDraft,
  onLotteryDraw,
  onConfirmLottery,
  onScoutDraft,
  onFinishDraft,
  onStartForeignScout,
  onOfferForeign,
  onSignForeign,
  onFinishForeignScout,
  onStartNextSeason,
  onHofDecide,
  onChangeAdvanceUnit,
  onReleasePlayer,
  injuryBadge,
  onClearInjuryBadge,
  injuryAlerts,
  onCloseInjuryAlerts,
  noticeAlerts,
  onCloseNoticeAlerts,
  debugMode,
  onToggleDebugMode,
}: Props) {
  const s = useMemo(() => calcTeamStrength(myTeam), [myTeam]);
  const [tab, setTab] = useState<NavTab>('standings');
  // オーダー/編成画面で選手タップ時にヘッダーへ表示する選手（playersタブ時のみ有効）
  const [heroPlayer, setHeroPlayer] = useState<Player | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCloudLoadConfirm, setShowCloudLoadConfirm] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudLoadNotice, setCloudLoadNotice] = useState<{ message: string; success: boolean } | null>(null);

  const handleManualSave = async () => {
    if (manualSaving || !onSave) return;
    setManualSaving(true);
    try {
      await onSave();
      setSaveNotice(true);
      setTimeout(() => setSaveNotice(false), 2500);
    } finally {
      setManualSaving(false);
    }
  };

  const handleCloudLoad = async () => {
    if (cloudLoading || !onCloudLoad) return;
    setCloudLoading(true);
    try {
      const res = await onCloudLoad();
      setCloudLoadNotice(res);
      setTimeout(() => setCloudLoadNotice(null), 3000);
    } finally {
      setCloudLoading(false);
    }
  };

  const myOrder = useMemo(() => sanitizeOrder(orders[myTeam.id], myTeam), [orders, myTeam]);

  useEffect(() => {
    // 内容が変わっていない場合は書き戻さない（参照比較だと無限更新・編成操作の巻き戻しが起きる）
    if (JSON.stringify(orders[myTeam.id]) !== JSON.stringify(myOrder)) {
      onUpdateOrder(myTeam.id, myOrder);
    }
  }, [myTeam.id, orders, myOrder, onUpdateOrder]);
  // ヘッダー差し替えは players タブ表示中のみ。選手は最新の teams から引き直す（能力は変動するため）
  const headerPlayer =
    tab === 'players' && heroPlayer
      ? myTeam.players.find((p) => p.id === heroPlayer.id) ?? null
      : null;

  return (
    <div className="dashboard">
      {headerPlayer ? (
        <PlayerHeroCard
          player={headerPlayer}
          stats={playerStats[headerPlayer.id]}
          startAbilities={seasonStartAbilities[headerPlayer.id]}
          year={year}
          color={myTeam.colorPrimary}
        />
      ) : (
        <div className="my-team-hero" style={{ borderColor: myTeam.colorPrimary }}>
          <div className="hero-row">
            <span className="team-badge lg" style={{ background: myTeam.colorPrimary }}>
              {myTeam.shortName}
            </span>
            <span className="hero-name">{myTeam.name}</span>
            <div className="hero-strength">
              <Cell label="打" value={s.batting} />
              <Cell label="走" value={s.running} />
              <Cell label="守" value={s.fielding} />
              <Cell label="投" value={s.pitching} />
              <Cell label="層" value={s.depth} />
              <Cell label="総合" value={s.total} highlight />
            </div>
          </div>
        </div>
      )}

      {/* ケガ・お知らせ通知はチーム総合力表示の下に出す */}
      {injuryAlerts.length > 0 && (
        <div className="injury-banner">
          {injuryAlerts.map((m, i) => (
            <div key={i} className="injury-banner-line">🩹 {m}</div>
          ))}
          <button className="injury-banner-close" onClick={onCloseInjuryAlerts} aria-label="閉じる">
            ×
          </button>
        </div>
      )}
      {noticeAlerts.length > 0 && (
        <div className="notice-banner">
          {noticeAlerts.map((m, i) => (
            <div key={i} className="notice-banner-line">📣 {m}</div>
          ))}
          <button className="notice-banner-close" onClick={onCloseNoticeAlerts} aria-label="閉じる">
            ×
          </button>
        </div>
      )}

      <div className="tab-content">
        {tab === 'standings' && (
          <StandingsScreen
            teams={teams}
            myLeague={myTeam.league}
            myTeamId={myTeam.id}
            records={records}
            schedule={schedule}
            gameCursor={gameCursor}
            orders={orders}
            playerStats={playerStats}
            postseasonStats={postseasonStats}
            playerCareers={playerCareers}
            playerTitles={playerTitles}
            seasonStartAbilities={seasonStartAbilities}
            year={year}
          />
        )}
        {tab === 'game' && (
          <GameScreen
            teams={teams}
            myTeam={myTeam}
            year={year}
            schedule={schedule}
            gameCursor={gameCursor}
            lastResults={lastResults}
            playerStats={playerStats}
            recentGames={recentGames}
            postseason={postseason}
            phase={phase}
            offseasonReport={offseasonReport}
            offseasonStage={offseasonStage}
            draft={draft}
            foreignScout={foreignScout}
            canSignForeign={canSignForeign}
            onAdvance={onAdvance}
            onStartDraft={onStartDraft}
            onRestartDraft={onRestartDraft}
            onPickDraft={onPickDraft}
            onLotteryDraw={onLotteryDraw}
            onConfirmLottery={onConfirmLottery}
            onScoutDraft={onScoutDraft}
            onFinishDraft={onFinishDraft}
            onStartForeignScout={onStartForeignScout}
            onOfferForeign={onOfferForeign}
            onSignForeign={onSignForeign}
            onFinishForeignScout={onFinishForeignScout}
            onStartNextSeason={onStartNextSeason}
            onHofDecide={onHofDecide}
            debugMode={debugMode}
          />
        )}
        {tab === 'players' && (
          <PlayersScreen
            team={myTeam}
            order={myOrder}
            onChangeOrder={(o) => onUpdateOrder(myTeam.id, o)}
            playerStats={playerStats}
            postseasonStats={postseasonStats}
            playerCareers={playerCareers}
            playerTitles={playerTitles}
            year={year}
            injuries={injuries}
            seasonStartAbilities={seasonStartAbilities}
            onRelease={onReleasePlayer}
            onHeroPlayer={setHeroPlayer}
          />
        )}
        {tab === 'record' && (
          <RecordScreen
            teams={teams}
            myTeam={myTeam}
            playerStats={playerStats}
            postseasonStats={postseasonStats}
            playerCareers={playerCareers}
            playerTitles={playerTitles}
            seasonHistory={seasonHistory}
            hallOfFame={hallOfFame}
            year={year}
            seasonStartAbilities={seasonStartAbilities}
          />
        )}
        {tab === 'settings' && (
          <div className="home-panel">
            <div className="setting-row">
              <span className="setting-label">アカウント</span>
              <AuthButton user={authUser} loading={authLoading} />
            </div>
            {authUser && (
              <div className="setting-row">
                <span className="setting-label">クラウド同期</span>
                <span className={`cloud-status-badge ${cloudSaving ? 'syncing' : 'synced'}`}>
                  {cloudSaving ? '🔄 保存中...' : '☁️ クラウド同期完了'}
                </span>
              </div>
            )}
            <div className="setting-row">
              <span className="setting-label">データ保存</span>
              <button
                className="ghost-btn setting-btn"
                onClick={handleManualSave}
                disabled={manualSaving}
                style={
                  saveNotice
                    ? { color: '#2ed573', borderColor: '#2ed573', fontWeight: 600 }
                    : undefined
                }
                title="現在のゲーム状態を手動で保存します"
              >
                {manualSaving ? '🔄 保存中...' : saveNotice ? '✅ 保存完了！' : '💾 現在のデータを保存'}
              </button>
            </div>
            {authUser && onCloudLoad && (
              <div className="setting-row">
                <span className="setting-label">クラウド読込</span>
                <button
                  className="ghost-btn setting-btn"
                  onClick={() => setShowCloudLoadConfirm(true)}
                  disabled={cloudLoading || manualSaving}
                  style={
                    cloudLoadNotice
                      ? {
                          color: cloudLoadNotice.success ? '#2ed573' : '#ff4757',
                          borderColor: cloudLoadNotice.success ? '#2ed573' : '#ff4757',
                          fontWeight: 600,
                        }
                      : undefined
                  }
                  title="クラウドに保存されている最新のデータを読み込みます"
                >
                  {cloudLoading
                    ? '🔄 読み込み中...'
                    : cloudLoadNotice
                      ? (cloudLoadNotice.success ? `✅ ${cloudLoadNotice.message}` : `⚠️ ${cloudLoadNotice.message}`)
                      : '☁️ クラウドから読み込む'}
                </button>
              </div>
            )}
            <div className="setting-row">
              <span className="setting-label">テーマ</span>
              <button className="ghost-btn setting-btn" onClick={onToggleTheme}>
                {theme === 'dark' ? '🌙 ダークモード' : '☀️ ライトモード'}
              </button>
            </div>
            <div className="setting-row">
              <span className="setting-label">進行単位</span>
              <div className="unit-btns">
                {UNIT_LABELS.map((u) => (
                  <button
                    key={u.unit}
                    className={`unit-btn${advanceUnit === u.unit ? ' active' : ''}`}
                    onClick={() => onChangeAdvanceUnit(u.unit)}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
            {onToggleDebugMode && (
              <div className="setting-row">
                <span className="setting-label">デバッグモード</span>
                <button
                  className="ghost-btn setting-btn"
                  onClick={onToggleDebugMode}
                  style={
                    debugMode
                      ? { color: '#ff4757', borderColor: '#ff4757', fontWeight: 600 }
                      : undefined
                  }
                  title="ドラフト会議でのやり直しボタンや才能・努力の全開示を切り替えます"
                >
                  {debugMode ? '🛠️ ON' : 'OFF'}
                </button>
              </div>
            )}
            <button className="ghost-btn debug-btn" onClick={() => setShowResetConfirm(true)}>
              初期化する
            </button>
          </div>
        )}
      </div>

      <BottomNav
        active={tab}
        onChange={(t) => {
          setTab(t);
          if (t === 'players') onClearInjuryBadge();
        }}
        playersBadge={injuryBadge}
      />

      {showResetConfirm && (
        <ConfirmModal
          title="初期化の確認"
          message="全てのデータを削除して初期化しますか？"
          confirmLabel="初期化する"
          danger
          onConfirm={() => {
            setShowResetConfirm(false);
            onReset();
          }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {showCloudLoadConfirm && (
        <ConfirmModal
          title="クラウドデータの読み込み"
          message={[
            'クラウドに保存されたデータを読み込みますか？',
            '※現在のローカルデータはクラウドのデータで上書きされます。',
          ]}
          confirmLabel="読み込む"
          onConfirm={() => {
            setShowCloudLoadConfirm(false);
            handleCloudLoad();
          }}
          onCancel={() => setShowCloudLoadConfirm(false)}
        />
      )}
    </div>
  );
}

function Cell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`strength-cell${highlight ? ' hl' : ''}`}>
      <span className="label">{label}</span>
      <RankBadge rank={rankFromValue(value)} title={value.toFixed(1)} />
    </div>
  );
}
