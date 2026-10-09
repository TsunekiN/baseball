import { useMemo, useState } from 'react';
import type { OffseasonReport, RetirementEntry } from '../domain/offseason';
import type { HallOfFamer } from '../domain/stats';
import { formatWinRate, formatEra } from '../domain/standings';

interface Props {
  report: OffseasonReport;
  myTeamId: string;
  onHofDecide: (hof: HallOfFamer, accept: boolean) => void;
  onStartDraft: () => void;
}

type Step = 'TITLES' | 'RETIRE';

/**
 * オフシーズン結果。
 * 1画面目: タイトル受賞一覧（お祝い演出）
 * 2画面目: 引退発表（マイチームのみ・簡易通算成績つき）→ ドラフト会議へ
 */
export function OffseasonSummary({ report, myTeamId, onHofDecide, onStartDraft }: Props) {
  const [step, setStep] = useState<Step>('TITLES');

  // マイチームの引退者のみ
  const myRetirements = useMemo(
    () => report.retirements.filter((r) => r.teamId === myTeamId),
    [report.retirements, myTeamId],
  );

  if (step === 'TITLES') {
    return (
      <div className="offseason-summary">
        <div className="award-hero">
          <h2 className="award-hero-title">🏆 {report.year}年 タイトル受賞者 🏆</h2>
        </div>

        {/* 三冠王・沢村賞（該当者がいる場合のみ別枠） */}
        {report.specialTitles.length > 0 && (
          <div className="award-special">
            {report.specialTitles.map((s, i) => (
              <div key={i} className="award-special-row">
                <span className="award-special-label">🌟 {s.label}</span>
                <span className="award-special-name">{s.playerName}</span>
                <span className="award-special-team">{s.teamName}</span>
              </div>
            ))}
          </div>
        )}

        {report.titleTable.length === 0 ? (
          <div className="award-empty">受賞者はいませんでした</div>
        ) : (
          <div className="award-table">
            <div className="award-table-head">
              <span className="award-th-title"></span>
              <span className="award-th-league ce">セ・リーグ</span>
              <span className="award-th-league pa">パ・リーグ</span>
            </div>
            {report.titleTable.map((row) => (
              <div key={row.label} className="award-row">
                <span className="award-row-title">👑 {row.label}</span>
                <Cell w={row.central} />
                <Cell w={row.pacific} />
              </div>
            ))}
          </div>
        )}

        <button className="primary-btn full" style={{ marginTop: 16 }} onClick={() => setStep('RETIRE')}>
          引退発表へ進む →
        </button>
      </div>
    );
  }

  // 引退発表
  return (
    <div className="offseason-summary">
      <div className="retire-hero">
        <div className="retire-hero-sub">{report.year}年オフ</div>
        <h2 className="retire-hero-title">引退発表</h2>
      </div>

      {/* 殿堂入り資格者の確認（マイチーム） */}
      {report.hofCandidates.length > 0 && (
        <div className="hof-confirm-block">
          <div className="hof-confirm-head">🏛 殿堂入り資格者</div>
          {report.hofCandidates.map((h) => (
            <div key={h.player.id} className="hof-confirm-row">
              <div className="hof-confirm-name">
                {h.player.name}
                <span className="hof-confirm-span">在籍 {h.joinYear}〜{h.leaveYear}</span>
              </div>
              <div className="hof-confirm-ask">
                <span>殿堂入りさせますか？</span>
                <button className="primary-btn sm" onClick={() => onHofDecide(h, true)}>はい</button>
                <button className="ghost-btn sm" onClick={() => onHofDecide(h, false)}>いいえ</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {myRetirements.length === 0 ? (
        <div className="retire-empty">今オフの引退者はいません</div>
      ) : (
        <div className="retire-list">
          {myRetirements.map((r) => (
            <RetireCard key={r.playerId} r={r} />
          ))}
        </div>
      )}

      <button className="primary-btn full" style={{ marginTop: 16 }} onClick={onStartDraft}>
        🗳 ドラフト会議へ進む
      </button>
    </div>
  );
}

/** タイトル表の1リーグ分セル（受賞者名＋チーム＋成績値） */
function Cell({ w }: { w: { playerName: string; teamName: string; value: string } | null }) {
  return (
    <span className="award-row-cell">
      {w ? (
        <>
          <span className="award-cell-name">
            {w.playerName}
            {w.value && <span className="award-cell-value">{w.value}</span>}
          </span>
          <span className="award-cell-team">{w.teamName}</span>
        </>
      ) : (
        <span className="award-cell-dash">—</span>
      )}
    </span>
  );
}

/** 引退選手カード（簡易通算成績つき） */
function RetireCard({ r }: { r: RetirementEntry }) {
  const c = r.career;
  return (
    <div className="retire-card">
      <div className="retire-card-head">
        <span className="retire-card-name">{r.playerName}</span>
        <span className="retire-card-meta">{r.position} ・ {r.age}歳{r.hallOfFame ? ' ・ 殿堂入り' : ''}</span>
      </div>
      {c && (
        <div className="retire-card-stats">
          <span className="retire-stat"><b>{c.years}</b>年</span>
          {c.isPitcher ? (
            <>
              <span className="retire-stat"><b>{c.wins}</b>勝</span>
              <span className="retire-stat"><b>{c.losses}</b>敗</span>
              <span className="retire-stat"><b>{c.saves}</b>S</span>
              <span className="retire-stat">防御率 <b>{formatEra(c.era)}</b></span>
            </>
          ) : (
            <>
              <span className="retire-stat"><b>{c.games}</b>試合</span>
              <span className="retire-stat"><b>{c.hits}</b>安打</span>
              <span className="retire-stat"><b>{c.hr}</b>本</span>
              <span className="retire-stat"><b>{c.rbi}</b>打点</span>
              <span className="retire-stat">打率 <b>{formatWinRate(c.avg)}</b></span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
