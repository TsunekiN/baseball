import type { FieldPosition, PitcherRole } from './types';

/** 守備位置の日本語ラベル */
export function fieldPositionLabel(pos: FieldPosition): string {
  const map: Record<FieldPosition, string> = {
    C: '捕',
    '1B': '一',
    '2B': '二',
    '3B': '三',
    SS: '遊',
    LF: '左',
    CF: '中',
    RF: '右',
    DH: 'DH',
  };
  return map[pos];
}

/** 投手役割の日本語ラベル */
export function pitcherRoleLabel(role: PitcherRole): string {
  const map: Record<PitcherRole, string> = {
    STARTER: '先発',
    SETUP: '8回',
    CLOSER: '抑え',
    MIDDLE: '中継ぎ',
  };
  return map[role];
}

/** 投手役割の表示順・想定人数 */
export const PITCHER_ROLE_GROUPS: { role: PitcherRole; capacity: number }[] = [
  { role: 'STARTER', capacity: 6 },
  { role: 'SETUP', capacity: 1 },
  { role: 'CLOSER', capacity: 1 },
  { role: 'MIDDLE', capacity: 6 },
];
