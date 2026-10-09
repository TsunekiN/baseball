import { useState } from 'react';
import type { Team } from '../domain/types';
import type { AtBatOutcome, GameResult, PitcherLine, PlateAppearance } from '../match/matchTypes';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { RecentGame } from '../domain/gameState';

interface Props {
  result: GameResult;
  awayTeam: Team;
  homeTeam: Team;
  myTeamId: string;
  playerStats: Record<string, PlayerSeasonStats>;
  recentGames: RecentGame[];
}

/** 打席結果の基本ラベル（単打→ヒット） */
function outcomeLabel(o: AtBatOutcome): string {
  switch (o) {
    case 'K': return '三振';
    case 'BB': return '四球';
    case 'OUT': return '凡打';
    case '1B': return 'ヒット';
    case '2B': return '二塁打';
    case '3B': return '三塁打';
    case 'HR': return 'ホームラン';
  }
}

/** 得点状況のプレフィックス（先制/同点/逆転/勝ち越し） */
function situationPrefix(offBefore: number, offAfter: number, defScore: number): string {
  if (offBefore === 0 && defScore === 0) return '先制'; // 試合最初の得点
  if (offBefore < defScore && offAfter === defScore) return '同点';
  if (offBefore < defScore && offAfter > defScore) return '逆転';
  if (offBefore === defScore && offAfter > defScore) return '勝ち越し';
  return '';
}

/** 得点した打席の説明文 */
function scoringDesc(p: PlateAppearance): string {
  const offBefore = p.half === 'T' ? p.awayScoreBefore : p.homeScoreBefore;
  const defScore = p.half === 'T' ? p.homeScoreBefore : p.awayScoreBefore;
  const offAfter = offBefore + p.runsScored;
  const prefix = situationPrefix(offBefore, offAfter, defScore);

  if (p.subType === 'sacFly') return `${prefix}犠牲フライ`;
  if (p.subType === 'groundRBI') return `${prefix}ゴロの間に1点`;

  if (p.outcome === 'HR') {
    if (p.runsScored >= 4) return `${prefix}満塁ホームラン！`;
    const kind = p.runsScored === 1 ? 'ソロ' : `${p.runsScored}ラン`;
    return `${prefix}${kind}！`;
  }
  if (p.outcome === 'BB') {
    return '押し出し四球';
  }
  const hitLabel = p.outcome === '1B' ? 'タイムリーヒット' : p.outcome === '2B' ? 'タイムリー二塁打' : 'タイムリー三塁打';
  return `${prefix}${hitLabel}`;
}

export function MatchResultView({ result, awayTeam, homeTeam, myTeamId, playerStats, recentGames }: Props) {
  const [showDetail, setShowDetail] = useState(false);

  const scoringLog = result.log.filter((p) => p.runsScored > 0);

  // ---- 試合レポート（マイチーム視点） ----
  const isMyHome = result.homeTeamId === myTeamId;
  const myPitchers = isMyHome ? result.homePitchers : result.awayPitchers;
  const myBatters = isMyHome ? result.homeBatters : result.awayBatters;
  const myAttackHalf = isMyHome ? 'B' : 'T';
  const starter = myPitchers[0] ?? null;

  // 一番活躍した打者（活躍度 = 安打+打点+HR+盗塁。同値は 安打→打点→HR→盗塁 の順で比較）
  const topBatter = [...myBatters]
    .filter((b) => b.ab > 0 || b.bb > 0)
    .sort((a, b) => {
      const sa = a.hits + a.rbi + a.hr + a.sb;
      const sb = b.hits + b.rbi + b.hr + b.sb;
      if (sb !== sa) return sb - sa;
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (b.rbi !== a.rbi) return b.rbi - a.rbi;
      if (b.hr !== a.hr) return b.hr - a.hr;
      return b.sb - a.sb;
    })[0] ?? null;

  // 活躍打者の成績文（0の項目は省略、打数・安打は常時表示）
  const topBatterText = topBatter
    ? `${topBatter.name}は、${topBatter.ab}打数${topBatter.hits}安打` +
      (topBatter.rbi > 0 ? `${topBatter.rbi}打点` : '') +
      (topBatter.hr > 0 ? `${topBatter.hr}HR` : '') +
      (topBatter.sb > 0 ? `${topBatter.sb}盗塁` : '')
    : null;

  const ipText = (outs: number) => {
    const w = Math.floor(outs / 3);
    const r = outs % 3;
    return r === 0 ? `${w}回` : `${w}回${r}/3`;
  };

  // 主な得点（マイチーム攻撃で、状況打 or 大きな本塁打）
  const myScorings = scoringLog.filter((p) => p.half === myAttackHalf);
  const lastScoringIdx = scoringLog.length - 1;
  const majorScorings = myScorings
    .map((p) => ({ p, desc: reportScoringDesc(p, result, scoringLog.indexOf(p) === lastScoringIdx) }))
    .filter((x) => x.desc !== null);

  const achievements = result.achievements ?? [];
  const injuries = result.injuries ?? [];
  const returns = result.returns ?? [];

  // 勝敗・セーブ投手
  const allPitchers = [...result.awayPitchers, ...result.homePitchers];
  const winP = allPitchers.find((p) => p.win) ?? null;
  const loseP = allPitchers.find((p) => p.loss) ?? null;
  const saveP = allPitchers.find((p) => p.save) ?? null;

  const pitcherRec = (p: PitcherLine) => {
    const s = playerStats[p.playerId]?.pitching;
    return s ? { w: s.wins, l: s.losses, sv: s.saves } : { w: 0, l: 0, sv: 0 };
  };

  // 本塁打（この試合で打った打者と通算号数）
  const hrBatters = [...result.awayBatters, ...result.homeBatters]
    .filter((b) => b.hr > 0)
    .map((b) => {
      const total = playerStats[b.playerId]?.batting?.hr ?? b.hr;
      // 通算末尾からこの試合の本数ぶんの号数
      const numbers: number[] = [];
      for (let i = b.hr - 1; i >= 0; i--) numbers.push(total - i);
      return { name: b.name, numbers };
    });

  const defenseTeam = (p: PlateAppearance) => (p.half === 'T' ? homeTeam : awayTeam);

  return (
    <div className="match-result">
      {/* スコア見出し */}
      <div className="mr-score">
        <div className="mr-team">
          <span className="team-badge sm" style={{ background: homeTeam.colorPrimary }}>
            {homeTeam.markChar}
          </span>
          <span className="mr-team-name">{homeTeam.nickName}</span>
          <span className="mr-runs">{result.homeScore}</span>
        </div>
        <div className="mr-vs">{result.extra ? '延長' : ''}</div>
        <div className="mr-team">
          <span className="mr-runs">{result.awayScore}</span>
          <span className="mr-team-name">{awayTeam.nickName}</span>
          <span className="team-badge sm" style={{ background: awayTeam.colorPrimary }}>
            {awayTeam.markChar}
          </span>
        </div>
      </div>

      {/* スコアボード */}
      <div className="mr-board-wrap">
        <table className="mr-board">
          <thead>
            <tr>
              <th></th>
              {result.innings.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th className="mr-rh">R</th>
              <th className="mr-rh">H</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mr-board-team">{awayTeam.markChar}</td>
              {result.innings.map((s, i) => (
                <td key={i}>{s.top === null ? '' : s.top}</td>
              ))}
              <td className="mr-rh">{result.awayScore}</td>
              <td className="mr-rh">{result.awayHits}</td>
            </tr>
            <tr>
              <td className="mr-board-team">{homeTeam.markChar}</td>
              {result.innings.map((s, i) => (
                <td key={i}>{s.bottom === null ? 'X' : s.bottom}</td>
              ))}
              <td className="mr-rh">{result.homeScore}</td>
              <td className="mr-rh">{result.homeHits}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 勝敗投手・本塁打（左） ＋ 直近6試合（右） */}
      <div className="mr-decisions-wrap">
        <div className="mr-decisions">
          {winP && (
            <div className="mr-dec-row">
              <span className="mr-dec-tag win">勝</span>
              <span className="mr-dec-name">{winP.name}</span>
              <span className="mr-dec-rec">
                {pitcherRec(winP).w}勝{pitcherRec(winP).l}敗
              </span>
              {saveP && (
                <>
                  <span className="mr-dec-tag sv">S</span>
                  <span className="mr-dec-name">{saveP.name}</span>
                  <span className="mr-dec-rec">{pitcherRec(saveP).sv}S</span>
                </>
              )}
            </div>
          )}
          {loseP && (
            <div className="mr-dec-row">
              <span className="mr-dec-tag lose">負</span>
              <span className="mr-dec-name">{loseP.name}</span>
              <span className="mr-dec-rec">
                {pitcherRec(loseP).w}勝{pitcherRec(loseP).l}敗
              </span>
            </div>
          )}
          {hrBatters.length > 0 && (
            <div className="mr-dec-row hr-row">
              <span className="mr-dec-tag hr">本</span>
              <span className="mr-hr-list">
                {hrBatters.map((b, i) => (
                  <span key={i} className="mr-hr-item">
                    {b.name} {b.numbers.join(',')}号
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>

        {/* 直近6試合（新しい順。記号はマイチーム視点） */}
        {recentGames.length > 0 && (
          <div className="mr-recent">
            <div className="mr-recent-title">直近6試合</div>
            {[...recentGames].reverse().map((g, i) => (
              <div key={i} className="mr-recent-row">
                <span className={`mr-recent-mark ${g.myResult}`}>
                  {g.myResult === 'win' ? '〇' : g.myResult === 'lose' ? '✕' : '△'}
                </span>
                <span className="mr-recent-score">
                  {g.homeMark}{g.homeScore}-{g.awayScore}{g.awayMark}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 試合レポート（マイチーム） */}
      <div className="roster-group-title">試合レポート</div>
      <div className="mr-report">
        {starter && (
          <div className="mr-rep-line">
            先発の{starter.name}は、{ipText(starter.outs)} 被安打{starter.hits} 失点{starter.runs} 四死球
            {starter.bb + starter.hbp}
          </div>
        )}
        {topBatterText && (
          <div className="mr-rep-line">{topBatterText}</div>
        )}
        {majorScorings.map(({ p, desc }, i) => (
          <div key={`s${i}`} className="mr-rep-line">
            {p.inning}回{p.half === 'T' ? '表' : '裏'} {p.batterName} {desc}
          </div>
        ))}
        {achievements.map((a, i) => (
          <div key={`a${i}`} className="mr-rep-line ach">
            {a}
          </div>
        ))}
        {injuries.map((inj, i) => (
          <div key={`i${i}`} className="mr-rep-line inj">
            {inj.name} 全治{inj.games}試合の{inj.severe ? '大ケガ' : 'ケガ'}
          </div>
        ))}
        {returns.map((name, i) => (
          <div key={`r${i}`} className="mr-rep-line ret">
            {name}がケガから復帰しました。
          </div>
        ))}
        {!starter && !topBatterText && majorScorings.length === 0 && achievements.length === 0 && injuries.length === 0 && returns.length === 0 && (
          <div className="mr-log-empty">特記事項なし</div>
        )}
      </div>

      {/* イニング詳細（全打席・継投表記） */}
      <button className="ghost-btn" style={{ marginTop: 8 }} onClick={() => setShowDetail((v) => !v)}>
        {showDetail ? 'イニング詳細を閉じる' : 'イニング詳細'}
      </button>
      {showDetail && (
        <div className="mr-detail">
          {result.log.map((p, i) => {
            const isScore = p.runsScored > 0;
            return (
              <div key={i}>
                {p.pitcherChanged && (
                  <div className="mr-change">
                    ◇ 投手交代: {p.pitcherName}（{defenseTeam(p).markChar}）
                  </div>
                )}
                <div className="mr-detail-row">
                  <span className="mr-log-inning">
                    {p.inning}回{p.half === 'T' ? '表' : '裏'}
                  </span>
                  <span className="mr-detail-desc">
                    {p.batterName}{' '}
                    {isScore
                      ? scoringDesc(p)
                      : (p.outDesc ?? outcomeLabel(p.outcome))}
                    {isScore ? ` ${p.runsScored}点` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 主な得点の説明（状況打・大きな本塁打・サヨナラのみ。その他はnull） */
function reportScoringDesc(p: PlateAppearance, _result: GameResult, isLast: boolean): string | null {
  const offBefore = p.half === 'T' ? p.awayScoreBefore : p.homeScoreBefore;
  const defScore = p.half === 'T' ? p.homeScoreBefore : p.awayScoreBefore;
  const offAfter = offBefore + p.runsScored;
  const prefix = situationPrefix(offBefore, offAfter, defScore);
  const walkOff = p.half === 'B' && p.inning >= 9 && isLast && offAfter > defScore;
  const isHR = p.outcome === 'HR';
  const bigHR = isHR && p.runsScored >= 3;

  // 主要でなければ除外（ただのタイムリー・ソロ/2ランHRなど）
  if (!prefix && !bigHR && !walkOff) return null;

  let body: string;
  if (isHR) {
    if (p.runsScored >= 4) body = '満塁ホームラン！';
    else body = `${p.runsScored === 1 ? 'ソロ' : `${p.runsScored}ラン`}！`;
  } else if (p.subType === 'sacFly') {
    body = '犠牲フライ';
  } else if (p.subType === 'groundRBI') {
    body = 'ゴロの間に1点';
  } else if (p.outcome === 'BB') {
    body = '押し出し四球';
  } else if (walkOff) {
    // サヨナラは「タイムリー」を付けず簡潔に
    body = p.outcome === '1B' ? 'ヒット' : p.outcome === '2B' ? '二塁打' : '三塁打';
  } else {
    body = p.outcome === '1B' ? 'タイムリーヒット' : p.outcome === '2B' ? 'タイムリー二塁打' : 'タイムリー三塁打';
  }

  const pre = walkOff ? 'サヨナラ' : prefix;
  return `${pre}${body}`;
}