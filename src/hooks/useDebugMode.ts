import { useCallback, useState } from 'react';

const STORAGE_KEY = 'app-debug-mode';

/**
 * デバッグモードの状態管理フック。
 * localStorage に設定を保存し、再起動後も状態を維持する。
 */
export function useDebugMode() {
  const [debugMode, setDebugModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleDebugMode = useCallback(() => {
    setDebugModeState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage利用不可時の握りつぶし
      }
      return next;
    });
  }, []);

  const resetDebugMode = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 握りつぶし
    }
    setDebugModeState(false);
  }, []);

  return { debugMode, toggleDebugMode, resetDebugMode };
}
