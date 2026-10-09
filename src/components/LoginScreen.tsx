import { useState } from 'react';
import { signInWithGoogle } from '../firebase';

interface Props {
  loading: boolean;
}

export function LoginScreen({ loading }: Props) {
  const [inAction, setInAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async () => {
    setErrorMsg(null);
    setInAction(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      console.error(err);
      const e = err as { code?: string; message?: string };
      if (e?.code !== 'auth/popup-closed-by-user') {
        setErrorMsg('ログインに失敗しました。もう一度お試しください。');
      }
    } finally {
      setInAction(false);
    }
  };

  return (
    <div className="login-screen-wrapper">
      <div className="login-stage">
        <img
          src="/baseball_bg.gif"
          alt="プロ野球ペナントシミュレーター"
          className="login-stage-image"
        />
        <div className="login-overlay" />
        <div className="login-action-box">
          <button
            className="login-google-cta-btn"
            onClick={handleLogin}
            disabled={inAction || loading}
          >
            <svg className="google-icon-svg" viewBox="0 0 24 24" width="22" height="22">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>{inAction || loading ? 'ログイン処理中...' : 'Googleでログインして始める'}</span>
          </button>

          {errorMsg && <p className="login-error-text">{errorMsg}</p>}
        </div>
      </div>
    </div>
  );
}
