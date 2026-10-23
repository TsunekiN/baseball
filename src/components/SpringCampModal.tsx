import type { SpringCampReport, AwakeningPlayerDetail } from '../domain/growthEngine';

interface Props {
  report: SpringCampReport;
  onClose: () => void;
}

export function SpringCampModal({ report, onClose }: Props) {
  const awakenings = report.awakenings;
  const batter = awakenings.find((a) => a.type === 'BATTER');
  const pitcher = awakenings.find((a) => a.type === 'PITCHER');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel spring-camp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="spring-camp-head">
          <div className="spring-camp-tag">🏕️ SPRING TRAINING</div>
          <h2 className="spring-camp-title">{report.year}年 春季キャンプ覚醒</h2>
          <p className="spring-camp-desc">
            開幕直前の猛練習により、25歳以下の若手選手が急成長を遂げました！
          </p>
        </div>

        <div className="spring-camp-body">
          {awakenings.length === 0 ? (
            <div className="spring-camp-empty">
              25歳以下の該当選手がいなかったため、覚醒選手はいませんでした。
            </div>
          ) : (
            <div className="spring-camp-cards">
              {batter && (
                <AwakeningCard player={batter} icon="🏏" typeLabel="野手覚醒" />
              )}
              {pitcher && (
                <AwakeningCard player={pitcher} icon="⚾" typeLabel="投手覚醒" />
              )}
            </div>
          )}
        </div>

        <div className="spring-camp-foot">
          <button type="button" className="spring-camp-btn" onClick={onClose}>
            確認してペナント開幕へ
          </button>
        </div>
      </div>
    </div>
  );
}

function AwakeningCard({
  player,
  icon,
  typeLabel,
}: {
  player: AwakeningPlayerDetail;
  icon: string;
  typeLabel: string;
}) {
  return (
    <div className="spring-camp-card">
      <div className="sc-card-head">
        <span className="sc-badge">
          {icon} {typeLabel}
        </span>
        <span className="sc-sub">
          {player.position} / {player.age}歳
        </span>
      </div>

      <div className="sc-name">{player.playerName}</div>

      <div className="sc-summary">
        ✨ {player.growthSummary}
      </div>

      <div className="sc-stats-list">
        {player.statDeltas.map((stat) => (
          <div key={stat.key} className="sc-stat-row">
            <span className="sc-stat-label">{stat.label}</span>
            <div className="sc-stat-vals">
              <span className="sc-stat-prev">
                {stat.key === 'velocity' ? `${stat.before}km` : stat.before}
              </span>
              <span className="sc-arrow">➔</span>
              <span className="sc-stat-curr">
                {stat.key === 'velocity' ? `${stat.after}km` : stat.after}
              </span>
              {stat.delta > 0 && (
                <span className="sc-gain">
                  +{stat.delta}
                  {stat.key === 'velocity' ? 'km' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
