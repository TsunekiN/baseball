import { useMemo, useState } from 'react';
import type { Position, Team } from '../domain/types';
import type { DraftState } from '../domain/gameState';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  draft: DraftState;
  myTeam: Team;
  teams: Team[];
  onPick: (prospectId: string) => void;
  onLotteryDraw: (cardIndex: number) => void;
  onConfirmLottery: () => void;
  onScout: (prospectId: string) => void;
  onFinishDraft: () => void;
  onCompleteAll: () => void;
}

type PosFilter = 'ALL' | Position;
type SortField = 'overall' | 'age' | 'mainStat';

/** ドラフト会議メイン画面 */
export function DraftScreen({
  draft,
  myTeam,
  teams,
  onPick,
  onLotteryDraw,
  onConfirmLottery,
  onScout,
  onFinishDraft,
  onCompleteAll,
}: Props) {
  const [posFilter, setPosFilter] = useState<PosFilter>('P');
  const [sortField, setSortField] = useState<SortField>('overall');
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [rosterTab, setRosterTab] = useState<'BATTER' | 'PITCHER'>('BATTER');
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  // 球団マップ
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // 残り獲得枠（最大50名、かつドラフトで最大6名）
  const maxRoster = 50;
  const currentTotal = myTeam.players.length;
  const spotsLeft = Math.max(0, maxRoster - currentTotal);
  const maxDraftPicks = Math.min(6, draft.myPicks.length + spotsLeft);
  const myPicksCount = draft.myPicks.length;
  const canPickMore = !draft.done && !draft.myTeamFinished && myPicksCount < maxDraftPicks && spotsLeft > 0;

  // 候補リストのフィルタ & ソート
  const filteredPool = useMemo(() => {
    return draft.pool
      .filter((p) => p.position === posFilter)
      .sort((a, b) => {
        const aPicked = !!draft.picked[a.id];
        const bPicked = !!draft.picked[b.id];
        // 未指名を常に上に表示
        if (aPicked !== bPicked) return aPicked ? 1 : -1;

        if (sortField === 'age') return a.age - b.age;
        if (sortField === 'mainStat') {
          const aStat = a.type === 'PITCHER' ? a.velocity : a.power;
          const bStat = b.type === 'PITCHER' ? b.velocity : b.power;
          return bStat - aStat;
        }
        // overall
        const aScore = a.type === 'PITCHER'
          ? (a.velocity - 125) * 2.5 * 0.35 + a.breaking * 0.35 + a.control * 0.3
          : a.contact * 0.3 + a.power * 0.3 + a.speed * 0.2 + a.defense * 0.2;
        const bScore = b.type === 'PITCHER'
          ? (b.velocity - 125) * 2.5 * 0.35 + b.breaking * 0.35 + b.control * 0.3
          : b.contact * 0.3 + b.power * 0.3 + b.speed * 0.2 + b.defense * 0.2;
        return bScore - aScore;
      });
  }, [draft.pool, draft.picked, posFilter, sortField]);

  // 1巡目の競合抽選情報
  const lottery = draft.pendingLottery;
  const lotteryProspect = lottery ? draft.pool.find((p) => p.id === lottery.prospectId) : null;
  const totalCards = lottery ? lottery.competitorTeamIds.length + 1 : 0;

  return (
    <div className="draft-container">
      {/* ===== ヘッダーステータスバー ===== */}
      <div className="draft-header-panel">
        <div className="draft-header-left">
          <span className="draft-badge round">
            {draft.done ? '会議終了' : `${draft.round}巡目`}
          </span>
          <span className="draft-status-text">
            支配下: <strong>{currentTotal}</strong>/{maxRoster}
          </span>
        </div>
        <div className="draft-header-right">
          <button
            className="ghost-btn sm"
            onClick={() => setShowRosterModal(true)}
            title="現在の自チーム戦力（野手/投手）を確認"
          >
            📋 戦力
          </button>
          {!draft.done && !draft.myTeamFinished && (
            <button
              className="ghost-btn sm"
              style={{ color: '#ff9f43', borderColor: '#ff9f43' }}
              onClick={() => setShowFinishConfirm(true)}
            >
              指名終了
            </button>
          )}
          {draft.done && (
            <button className="primary-btn sm" onClick={onCompleteAll}>
              新外国人スカウトへ
            </button>
          )}
        </div>
      </div>

      {/* 指名終了メッセージ */}
      {draft.myTeamFinished && !draft.done && (
        <div className="draft-banner">
          自チームの指名は終了しました。他球団の指名が完了するまでお待ちください。
        </div>
      )}

      {/* ===== フィルタ & ソートバー ===== */}
      <div className="draft-filter-bar">
        <div className="filter-group">
          {(['P', 'C', '1B', '2B', '3B', 'SS', 'OF'] as PosFilter[]).map((pos) => (
            <button
              key={pos}
              className={`filter-chip${posFilter === pos ? ' active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </button>
          ))}
          <span className="draft-scout-badge" title="隠しパラメータ（才能または努力）を片方調査できます（最大10回）">
            🔍 調査残: <strong>{draft.scoutsLeft}</strong> 回
          </span>
        </div>
        <div className="sort-group">
          <span className="sort-label">並び順:</span>
          <select
            className="draft-select"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
          >
            <option value="overall">総合力順</option>
            <option value="mainStat">主力能力順</option>
            <option value="age">年齢順</option>
          </select>
        </div>
      </div>

      {/* ===== 候補選手テーブル ===== */}
      <div className="draft-table-wrapper">
        <table className="draft-table">
          <thead>
            <tr>
              <th style={{ width: '7em' }}>名前</th>
              <th className="center" style={{ width: 30 }}>年齢</th>
              {(posFilter === 'P'
                ? ['球速', '制球', '変化', 'スタ', '健康']
                : ['ミート', 'パワー', '走力', '守備', '健康']
              ).map((lbl) => (
                <th key={lbl} className="center" style={{ width: 38 }}>{lbl}</th>
              ))}
              <th className="center" style={{ width: 50 }}>調査</th>
              <th className="center" style={{ width: 46 }}>指名</th>
            </tr>
          </thead>
          <tbody>
            {filteredPool.map((p) => {
              const pickedTeamId = draft.picked[p.id];
              const isPicked = !!pickedTeamId;
              const pickedTeam = isPicked ? teamMap.get(pickedTeamId) : null;
              const scoutResult = draft.scouted[p.id]; // 'talent' | 'effort' | undefined

              // 指名不可（指名済み or これ以上指名できない）の行はグレーアウト
              const disabled = isPicked || !canPickMore;
              // 主要4能力（投手/野手で項目が異なる）
              const abils = p.type === 'PITCHER'
                ? [
                    { v: p.velocity, velo: true },
                    { v: p.control, velo: false },
                    { v: p.breaking, velo: false },
                    { v: p.stamina, velo: false },
                  ]
                : [
                    { v: p.contact, velo: false },
                    { v: p.power, velo: false },
                    { v: p.speed, velo: false },
                    { v: p.defense, velo: false },
                  ];

              return (
                <tr key={p.id} className={disabled ? 'row-disabled' : ''}>
                  <td>
                    <span className="prospect-name">{p.name}</span>
                  </td>
                  <td className="center">{p.age}</td>
                  {abils.map((a, i) => (
                    <td key={i} className="center"><AbCell value={a.v} isVelo={a.velo} /></td>
                  ))}
                  <td className="center"><AbCell value={p.health} isVelo={false} /></td>
                  <td className="center">
                    {scoutResult ? (
                      <span className="scout-revealed-chip">
                        <span className="scout-chip-label">才</span>
                        <span className="scout-chip-val" style={{ color: scoutResult === 'talent' ? rankColor(rankFromValue(p.talent)).border : '#888' }}>
                          {scoutResult === 'talent' ? rankFromValue(p.talent) : '？'}
                        </span>
                        <span className="scout-chip-sep">/</span>
                        <span className="scout-chip-label">努</span>
                        <span className="scout-chip-val" style={{ color: scoutResult === 'effort' ? rankColor(rankFromValue(p.effort)).border : '#888' }}>
                          {scoutResult === 'effort' ? rankFromValue(p.effort) : '？'}
                        </span>
                      </span>
                    ) : !isPicked && draft.scoutsLeft > 0 ? (
                      <button
                        className="ghost-btn xs scout-icon-btn"
                        onClick={() => onScout(p.id)}
                        title="才能値・努力値の片方を調査（最大10回）"
                      >
                        🔍
                      </button>
                    ) : (
                      <span className="disabled-text">-</span>
                    )}
                  </td>
                  <td className="center">
                    {isPicked ? (
                      <span
                        className="draft-pick-team"
                        style={{ color: pickedTeam?.colorPrimary || 'var(--text)' }}
                      >
                        {pickedTeam?.nickName ?? '獲得済'}
                      </span>
                    ) : canPickMore ? (
                      <button className="primary-btn draft-pick-btn" onClick={() => onPick(p.id)}>
                        指名
                      </button>
                    ) : (
                      <span className="disabled-text">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ===== 1巡目 競合くじ引きモーダル ===== */}
      {lottery && lotteryProspect && (
        <div className="modal-overlay">
          <div className="modal-panel lottery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lottery-header">
              <h3>🗳 第1巡目 競合抽選</h3>
              <p className="lottery-sub">
                <strong>{lotteryProspect.name}</strong> 選手（{lotteryProspect.position}）の指名が重複しました！
              </p>
              <div className="competing-teams">
                <span
                  className="team-tag"
                  style={{ backgroundColor: myTeam.colorPrimary, color: '#fff' }}
                >
                  {myTeam.name}
                </span>
                {lottery.competitorTeamIds.map((tid) => {
                  const t = teamMap.get(tid);
                  return (
                    <span
                      key={tid}
                      className="team-tag"
                      style={{ backgroundColor: t?.colorPrimary || '#444', color: '#fff' }}
                    >
                      {t?.name || '他球団'}
                    </span>
                  );
                })}
              </div>
            </div>

            <p className="lottery-instruction">
              {lottery.revealedIndex === undefined
                ? `どれか1枚の紙をタップしてめくってください（全${totalCards}枚中、当たりは1枚）`
                : '抽選結果が出ました'}
            </p>

            {/* くじ引きカードの並び（2枚または3枚） */}
            <div className="lottery-cards">
              {Array.from({ length: totalCards }).map((_, idx) => {
                const isSelected = lottery.revealedIndex === idx;
                const isRevealed = lottery.revealedIndex !== undefined;
                const isWinningCard = idx === lottery.winningIndex;

                let cardClass = 'lottery-card';
                if (isRevealed) {
                  cardClass += ' revealed';
                  if (isWinningCard) cardClass += ' win';
                  else cardClass += ' lose';
                }

                return (
                  <div
                    key={idx}
                    className={cardClass}
                    onClick={() => {
                      if (!isRevealed) {
                        onLotteryDraw(idx);
                      }
                    }}
                  >
                    {!isRevealed ? (
                      <div className="card-back">
                        <span className="card-number">第 {idx + 1} 票</span>
                        <span className="card-tap-hint">タップ</span>
                      </div>
                    ) : (
                      <div className="card-front">
                        {isWinningCard ? (
                          <div className="card-win-text">
                            <span className="kuji-mark">💮</span>
                            <span>交渉権獲得</span>
                          </div>
                        ) : (
                          <div className="card-lose-text">
                            <span>×</span>
                            <span>ハズレ</span>
                          </div>
                        )}
                        {isSelected && <span className="selected-tag">あなたが選択</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 抽選結果メッセージと次へ進むボタン */}
            {lottery.revealedIndex !== undefined && (
              <div className="lottery-outcome-box">
                {lottery.won ? (
                  <div className="outcome-text win">
                    🎉 交渉権獲得！！見事当たりを引き当てました！
                  </div>
                ) : (
                  <div className="outcome-text lose">
                    😢 残念ながら交渉権を獲得できませんでした（他球団が獲得）。
                    外れ1巡目指名を行います。
                  </div>
                )}
                <button
                  className="primary-btn full"
                  style={{ marginTop: 12 }}
                  onClick={onConfirmLottery}
                >
                  {lottery.won ? '第2巡目へ進む' : '外れ1巡目の再指名へ'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 自チーム戦力参照モーダル ===== */}
      {showRosterModal && (
        <div className="modal-overlay" onClick={() => setShowRosterModal(false)}>
          <div className="modal-panel draft-roster-modal" onClick={(e) => e.stopPropagation()}>
            <div className="roster-modal-head">
              <h3>📋 {myTeam.name} 現有戦力一覧</h3>
              <button className="modal-close" onClick={() => setShowRosterModal(false)}>
                ×
              </button>
            </div>

            <div className="roster-tabs">
              <button
                className={`roster-tab${rosterTab === 'BATTER' ? ' active' : ''}`}
                onClick={() => setRosterTab('BATTER')}
              >
                野手 ({myTeam.players.filter((p) => p.type === 'BATTER').length}名)
              </button>
              <button
                className={`roster-tab${rosterTab === 'PITCHER' ? ' active' : ''}`}
                onClick={() => setRosterTab('PITCHER')}
              >
                投手 ({myTeam.players.filter((p) => p.type === 'PITCHER').length}名)
              </button>
            </div>

            <div className="modal-roster-table-wrapper">
              <table className="draft-table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th style={{ width: 40 }}>POS</th>
                    <th style={{ width: 40 }}>年齢</th>
                    <th>能力</th>
                    <th style={{ width: 44 }}>登録</th>
                  </tr>
                </thead>
                <tbody>
                  {myTeam.players
                    .filter((p) => p.type === rosterTab)
                    .map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="center">{p.position}</td>
                        <td className="center">{p.age}</td>
                        <td>
                          {p.type === 'PITCHER' ? (
                            <div className="ability-chips">
                              <AbChip label="球速" value={p.velocity} isVelo />
                              <AbChip label="制球" value={p.control} />
                              <AbChip label="変化" value={p.breaking} />
                            </div>
                          ) : (
                            <div className="ability-chips">
                              <AbChip label="ミート" value={p.contact} />
                              <AbChip label="パワー" value={p.power} />
                              <AbChip label="走力" value={p.speed} />
                              <AbChip label="守備" value={p.defense} />
                            </div>
                          )}
                        </td>
                        <td className="center">
                          <span className={`roster-level-badge ${myTeam.rosterLevel[p.id]}`}>
                            {myTeam.rosterLevel[p.id] === 'FIRST' ? '一軍' : '二軍'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showFinishConfirm && (
        <ConfirmModal
          title="指名終了の確認"
          message={['これ以上の指名を行わず、ドラフト会議を終了しますか？', '残りの巡は他球団のみ自動進行します。']}
          confirmLabel="指名終了"
          onConfirm={() => {
            setShowFinishConfirm(false);
            onFinishDraft();
          }}
          onCancel={() => setShowFinishConfirm(false)}
        />
      )}
    </div>
  );
}

/** 能力セル（数値＋ランク。1列表示用のコンパクト版） */
function AbCell({ value, isVelo }: { value: number; isVelo: boolean }) {
  const rank = isVelo ? rankFromVelocity(value) : rankFromValue(value);
  const color = rankColor(rank);
  return (
    <span className="draft-ab-cell">
      <span className="draft-ab-num">{displayAbility(value)}</span>
      <span className="draft-ab-rank" style={{ color: color.border }}>{rank}</span>
    </span>
  );
}

/** 能力チップ */
function AbChip({ label, value, isVelo }: { label: string; value: number; isVelo?: boolean }) {
  const rank = isVelo ? rankFromVelocity(value) : rankFromValue(value);
  const color = rankColor(rank);
  return (
    <span className="ab-chip" title={label}>
      <span className="ab-chip-val">{displayAbility(value)}</span>
      <span className="ab-chip-rank" style={{ color: color.border }}>
        {rank}
      </span>
    </span>
  );
}
