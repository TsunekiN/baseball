import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Pointer Events ベースのスロット並べ替え用ドラッグフック。
 * マウス・タッチ両対応。各ドラッグ対象要素に data-slot="<key>" を付与し、
 * bind(key) が返す props を要素に展開する。
 * ドロップ時に onSwap(srcKey, dstKey) が呼ばれる。
 */
export function useSlotDnD(onSwap: (srcKey: string, dstKey: string) => void) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const draggingRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;

  const finish = useCallback(() => {
    const src = draggingRef.current;
    const dst = overRef.current;
    if (src && dst && src !== dst) {
      onSwapRef.current(src, dst);
    }
    draggingRef.current = null;
    overRef.current = null;
    setDraggingKey(null);
    setOverKey(null);
  }, []);

  // ドラッグ中の pointermove / pointerup を document で監視
  useEffect(() => {
    if (!draggingKey) return;

    const slotKeyAtPoint = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const slot = el?.closest('[data-slot]');
      return slot?.getAttribute('data-slot') ?? null;
    };

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      const key = slotKeyAtPoint(e.clientX, e.clientY);
      overRef.current = key;
      setOverKey(key);
    };
    const handleUp = () => finish();

    document.addEventListener('pointermove', handleMove, { passive: false });
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingKey, finish]);

  const bind = useCallback(
    (key: string) => ({
      'data-slot': key,
      onPointerDown: (e: ReactPointerEvent) => {
        // 左クリック / タッチ / ペンのみ
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        draggingRef.current = key;
        overRef.current = key;
        setDraggingKey(key);
        setOverKey(key);
      },
      style: { touchAction: 'none' as const },
    }),
    [],
  );

  return { draggingKey, overKey, bind };
}
