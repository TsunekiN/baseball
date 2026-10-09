export type NavTab = 'game' | 'standings' | 'players' | 'record' | 'settings';

interface Props {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  /** 選手ボタンに未確認の故障者通知バッジを表示 */
  playersBadge?: boolean;
}

const TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'game', label: '試合', icon: '⚾' },
  { id: 'standings', label: '順位', icon: '📊' },
  { id: 'players', label: '選手', icon: '👥' },
  { id: 'record', label: '記録', icon: '📖' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

/** 最下段の固定タブバー */
export function BottomNav({ active, onChange, playersBadge }: Props) {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`nav-btn${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="nav-icon">
            {t.icon}
            {t.id === 'players' && playersBadge && <span className="nav-badge" />}
          </span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
