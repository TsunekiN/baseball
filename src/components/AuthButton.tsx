import { useState } from 'react';
import type { User } from 'firebase/auth';
import { logout } from '../firebase';

interface Props {
  user: User | null;
  loading: boolean;
}

export function AuthButton({ user, loading }: Props) {
  const [inAction, setInAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogout = async () => {
    setErrorMsg(null);
    setInAction(true);
    try {
      await logout();
    } catch (err) {
      console.error(err);
      setErrorMsg('ログアウトに失敗しました');
    } finally {
      setInAction(false);
    }
  };

  if (loading) {
    return <div className="auth-btn-container"><span className="auth-loading-text">読込中...</span></div>;
  }

  return (
    <div className="auth-btn-container">
      {user ? (
        <div className="auth-user-info">
          {user.photoURL && (
            <img src={user.photoURL} alt={user.displayName ?? 'user'} className="auth-avatar" />
          )}
          <span className="auth-name" title={user.displayName ?? user.email ?? ''}>
            {user.displayName ?? 'ユーザー'}
          </span>
          <button
            className="ghost-btn auth-action-btn"
            onClick={handleLogout}
            disabled={inAction}
            title="ログアウト"
          >
            ログアウト
          </button>
        </div>
      ) : null}
      {errorMsg && <span className="auth-error-msg">{errorMsg}</span>}
    </div>
  );
}
