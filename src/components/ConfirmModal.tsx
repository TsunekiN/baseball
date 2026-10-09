interface Props {
  /** 見出し */
  title: string;
  /** 本文（改行は \n で指定可。配列でも可） */
  message: string | string[];
  /** 実行ボタンのラベル（既定: OK） */
  confirmLabel?: string;
  /** キャンセルボタンのラベル（既定: キャンセル） */
  cancelLabel?: string;
  /** 実行ボタンを警告色（赤）にする */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * アプリ内の確認ダイアログ（ブラウザ標準 confirm の代替）。
 * オーバーレイ外やキャンセルで onCancel、実行ボタンで onConfirm を呼ぶ。
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const lines = Array.isArray(message) ? message : message.split('\n');
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-body">
          {lines.map((l, i) => (
            <p key={i} className="confirm-line">{l}</p>
          ))}
        </div>
        <div className="confirm-actions">
          <button className="ghost-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="primary-btn"
            style={danger ? { background: '#e23b3b', borderColor: '#e23b3b' } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
