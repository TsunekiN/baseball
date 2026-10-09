import { useMemo } from 'react';
import type { Team } from '../domain/types';
import type { ScheduleGame } from '../domain/seasonSchedule';
import type { GameResult } from '../match/matchTypes';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { PostseasonState, SeriesState } from '../match/postseason';
import type { GamePhase, DraftState, OffseasonStage, ForeignScoutState, RecentGame } from '../domain/gameState';
import type { OffseasonReport } from '../domain/offseason';
import type { HallOfFamer } from '../domain/stats';
import type { Position } from '../domain/types';
import { MatchResultView } from './MatchResultView';
import { OffseasonSummary } from './OffseasonSummary';
import { DraftScreen } from './DraftScreen';
import { ForeignScoutScreen } from './ForeignScoutScreen';

interface Props {
  teams: Team[];
  myTeam: Team;
  year: number;
  schedule: ScheduleGame[];
  gameCursor: number;
  lastResults: GameResult[];
  playerStats: Record<string, PlayerSeasonStats>;
  recentGames: RecentGame[];
  postseason: PostseasonState | null;
  phase: GamePhase;
  offseasonReport: OffseasonReport | null;
  offseasonStage: OffseasonStage | null;
  draft: DraftState | null;
  foreignScout: ForeignScoutState | null;
  canSignForeign: boolean;
  onAdvance: () => void;
  onStartDraft: () => void;
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
}

export function GameScreen({
  teams,
  myTeam,
  year,
  schedule,
  gameCursor,
  lastResults,
  playerStats,
  recentGames,
  postseason,
  phase,
  offseasonReport,
  offseasonStage,
  draft,
  foreignScout,
  canSignForeign,
  onAdvance,
  onStartDraft,
  onPickDraft,
  onLotteryDraw,
  onConfirmLottery,
  onScoutDraft,
  onFinishDraft,
  onStartForeignScout,
  onOfferForeign,
  onSignForeign,
  onFinishForeignScout,
  onHofDecide,
}: Props) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // 次のマイチーム試合
  const nextGame = useMemo(
    () =>
      schedule
        .slice(gameCursor)
        .find((g) => g.awayId === myTeam.id || g.homeId === myTeam.id) ?? null,
    [schedule, gameCursor, myTeam.id],
  );

  const seasonOver = nextGame === null;

  // 直近の結果（複数消化時は最後の試合をメイン表示）
  const mainResult = lastResults.length > 0 ? lastResults[lastResults.length - 1] : null;

  // オフシーズン中
  if (phase === 'OFFSEASON') {
    // ドラフト会議中
    if (offseasonStage === 'DRAFT' && draft) {
      return (
        <DraftScreen
          draft={draft}
          myTeam={myTeam}
          teams={teams}
          onPick={onPickDraft}
          onLotteryDraw={onLotteryDraw}
          onConfirmLottery={onConfirmLottery}
          onScout={onScoutDraft}
          onFinishDraft={onFinishDraft}
          onCompleteAll={onStartForeignScout}
        />
      );
    }

    // 外国人スカウト中
    if (offseasonStage === 'SCOUT' && foreignScout) {
      return (
        <ForeignScoutScreen
          scout={foreignScout}
          myTeam={myTeam}
          year={year}
          draftPickCount={draft?.myPicks.length ?? 0}
          canSign={canSignForeign}
          onOffer={onOfferForeign}
          onSign={onSignForeign}
          onFinish={onFinishForeignScout}
        />
      );
    }

    // オフシーズン結果サマリー表示中
    if (offseasonReport) {
      return (
        <OffseasonSummary
          report={offseasonReport}
          myTeamId={myTeam.id}
          onHofDecide={onHofDecide}
          onStartDraft={onStartDraft}
        />
      );
    }
  }

  // 開幕（1試合目に進む前・レギュラー・結果未表示）なら、開幕メッセージを大きく表示
  const isOpening = phase === 'REGULAR' && !postseason && gameCursor === 0 && !mainResult;

  const done = !!postseason && postseason.stage === 'DONE';
  const buttonLabel = done
    ? '🏅 タイトル受賞者一覧へ進む'
    : !postseason && seasonOver
      ? '🏆 クライマックスシリーズへ進む'
      : '⚾ 次の試合に進む';

  return (
    <div>
      {/* 開幕メッセージ（1試合目に進む前） */}
      {isOpening && (
        <div className="season-opening">{year}年度ペナントレース開幕！</div>
      )}

      {/* 試合結果（最上部） */}
      {mainResult && (
        <div style={{ marginBottom: 14 }}>
          {lastResults.length > 1 && (
            <p className="dummy-note" style={{ marginTop: 0 }}>
              今回 {lastResults.length} 試合を消化しました（最新の試合を表示）
            </p>
          )}
          <MatchResultView
            result={mainResult}
            awayTeam={teamMap.get(mainResult.awayTeamId)!}
            homeTeam={teamMap.get(mainResult.homeTeamId)!}
            myTeamId={myTeam.id}
            playerStats={playerStats}
            recentGames={recentGames}
          />
          {lastResults.length > 1 && (
            <div className="recent-list">
              {lastResults.map((r, i) => (
                <ResultLine key={i} result={r} myTeam={myTeam} teamMap={teamMap} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 状況（次の試合 / ポストシーズン / シーズン終了） */}
      {postseason ? (
        <PostseasonView postseason={postseason} teamMap={teamMap} />
      ) : seasonOver ? (
        <div className="home-panel">
          <p className="home-note">レギュラーシーズンが終了しました。</p>
        </div>
      ) : null}

      {/* 固定ボタンの高さ分、コンテンツ末尾に余白を確保（重なり防止） */}
      <div className="advance-spacer" />

      {/* 進むボタン: 最下部メニュー（BottomNav）のすぐ上に固定。DONE時は「オフシーズンへ進む」 */}
      <div className="advance-fixed">
        <button className="primary-btn full" onClick={onAdvance}>
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

/** 消化した各試合の1行スコア（マイチーム視点） */
function ResultLine({
  result,
  myTeam,
  teamMap,
}: {
  result: GameResult;
  myTeam: Team;
  teamMap: Map<string, Team>;
}) {
  const myIsHome = result.homeTeamId === myTeam.id;
  const myScore = myIsHome ? result.homeScore : result.awayScore;
  const oppScore = myIsHome ? result.awayScore : result.homeScore;
  const oppId = myIsHome ? result.awayTeamId : result.homeTeamId;
  const opp = teamMap.get(oppId)!;
  const wl = result.draw ? '分' : myScore > oppScore ? '○' : '●';
  return (
    <div className="recent-row">
      <span className={`recent-wl ${wl === '○' ? 'win' : wl === '●' ? 'lose' : ''}`}>{wl}</span>
      <span className="recent-opp">
        {myIsHome ? 'vs' : '@'} {opp.nickName}
      </span>
      <span className="recent-score">
        {myScore} - {oppScore}
      </span>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  CS_FIRST: 'CSファーストステージ',
  CS_FINAL: 'CSファイナルステージ',
  JAPAN: '日本シリーズ',
  DONE: 'シーズン終了',
};

/** ポストシーズン表示 */
function PostseasonView({
  postseason,
  teamMap,
}: {
  postseason: PostseasonState;
  teamMap: Map<string, Team>;
}) {
  // CSはセ・リーグ列とパ・リーグ列に分けて2列表示（ファースト→ファイナルの順）
  const centralCards: { label: string; series: SeriesState }[] = [];
  if (postseason.central.first) centralCards.push({ label: 'CSファースト', series: postseason.central.first });
  if (postseason.central.final) centralCards.push({ label: 'CSファイナル', series: postseason.central.final });
  const pacificCards: { label: string; series: SeriesState }[] = [];
  if (postseason.pacific.first) pacificCards.push({ label: 'CSファースト', series: postseason.pacific.first });
  if (postseason.pacific.final) pacificCards.push({ label: 'CSファイナル', series: postseason.pacific.final });

  const champion = postseason.championId ? teamMap.get(postseason.championId) : null;
  const isDone = postseason.stage === 'DONE';

  return (
    <div>
      {/* シーズン終了（日本一確定）時は、見出しと日本一表示を日本シリーズ結果の下に出す */}
      {!isDone && (
        <div className="roster-group-title">{STAGE_LABEL[postseason.stage] ?? 'ポストシーズン'}</div>
      )}

      {/* ポストシーズン: CSはセ／パの2列レイアウト（見出しは終了後も残す） */}
      {(centralCards.length > 0 || pacificCards.length > 0) && (
        <>
          <div className="roster-group-title">ポストシーズン</div>
          <div className="series-columns">
            <div className="series-col">
              {centralCards.map((c, i) => (
                <SeriesCard key={i} label={c.label} series={c.series} teamMap={teamMap} />
              ))}
            </div>
            <div className="series-col">
              {pacificCards.map((c, i) => (
                <SeriesCard key={i} label={c.label} series={c.series} teamMap={teamMap} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* 日本シリーズはリーグ横断のため全幅で表示 */}
      {postseason.japan && (
        <div className="series-list">
          <SeriesCard label="日本シリーズ" series={postseason.japan} teamMap={teamMap} />
        </div>
      )}

      {/* シーズン終了（日本一確定）: 日本シリーズ結果の下に見出し＋日本一を表示 */}
      {isDone && (
        <>
          <div className="roster-group-title" style={{ marginTop: 10 }}>
            {STAGE_LABEL.DONE}
          </div>
          {champion && (
            <div className="champ-banner" style={{ borderColor: champion.colorPrimary }}>
              🏆 日本一: <span style={{ color: champion.colorPrimary }}>{champion.name}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 1シリーズの表示 */
function SeriesCard({
  label,
  series,
  teamMap,
}: {
  label: string;
  series: SeriesState;
  teamMap: Map<string, Team>;
}) {
  const home = teamMap.get(series.homeId)!;
  const away = teamMap.get(series.awayId)!;
  const winner = series.winnerId ? teamMap.get(series.winnerId) : null;
  return (
    <div className="series-card">
      <div className="series-label">{label}（{series.target}勝先勝）</div>
      <div className="series-body">
        <span className="team-badge sm" style={{ background: home.colorPrimary }}>
          {home.markChar}
        </span>
        <span className="series-team">{home.nickName}</span>
        <span className="series-score">
          {series.homeWins} - {series.awayWins}
        </span>
        <span className="series-team right">{away.nickName}</span>
        <span className="team-badge sm" style={{ background: away.colorPrimary }}>
          {away.markChar}
        </span>
      </div>
      {series.done && winner && <div className="series-winner">{winner.nickName} 勝利</div>}
    </div>
  );
}
