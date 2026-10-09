import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'app-theme';

/** OSの配色設定を取得（ライト/ダーク） */
function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

/** 初期テーマ: 保存済みがあればそれを、なければOS設定に追従 */
function getInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return getSystemTheme();
}

/**
 * ライト/ダークテーマの状態管理フック。
 * <html data-theme="..."> を切り替え、選択を localStorage に保存する。
 * ユーザーが未選択の場合は OS の設定変更にも追従する。
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  // ユーザーが明示的に選んだか（未選択ならOS追従）
  const [userSelected, setUserSelected] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) !== null,
  );

  // <html> へ反映
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ユーザー未選択のときは OS の変更に追従
  useEffect(() => {
    if (userSelected) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setThemeState(getSystemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [userSelected]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
    setUserSelected(true);
  }, []);

  return { theme, toggleTheme };
}
