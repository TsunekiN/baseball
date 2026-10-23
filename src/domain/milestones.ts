import type { PlayerCareer } from './gameState';
import type { PlayerSeasonStats } from '../match/matchStats';
import type { Team } from './types';
import { careerTotals } from './offseason';

export interface MilestoneNoticeParams {
  teams: Team[];
  playerCareers?: Record<string, PlayerCareer>;
  beforeStats?: Record<string, PlayerSeasonStats>;
  afterStats: Record<string, PlayerSeasonStats>;
  /** 指定された場合、そのチームの選手のみを対象にマイルストーンを検出する（マイチーム限定通知用） */
  targetTeamId?: string | null;
}

/**
 * before から after に増えたときに、start から step 刻みの節目 (start, start+step, start+2*step, ...)
 * を跨いだかどうか判定し、跨いだ節目の数値を返す。
 */
export function findMilestones(before: number, after: number, start: number, step: number): number[] {
  if (after < start || after <= before) return [];
  const milestones: number[] = [];
  let target = start;
  if (before >= start) {
    target = start + Math.floor((before - start) / step + 1) * step;
  }
  while (target <= after) {
    milestones.push(target);
    target += step;
  }
  return milestones;
}

/**
 * 試合進行前後で以下の通算記録マイルストーンを達成した選手を検出し、お知らせメッセージを生成する。
 * （targetTeamId が指定された場合はそのチーム所属の選手のみを対象とする）
 * - 投手の100勝、150勝、200勝、以降50勝するたび
 * - 投手の100セーブ、150セーブ、200セーブ、以降50セーブするたび
 * - 野手の200ホームラン、300ホームラン、以降100ホームランするたび
 * - 野手の1000安打、1500安打、以降500安打するたび
 */
export function detectMilestoneNotices({
  teams,
  playerCareers = {},
  beforeStats = {},
  afterStats,
  targetTeamId,
}: MilestoneNoticeParams): string[] {
  const notices: string[] = [];
  const targetTeams = targetTeamId ? teams.filter((t) => t.id === targetTeamId) : teams;

  for (const team of targetTeams) {
    for (const player of team.players) {
      const bStat = beforeStats[player.id];
      const aStat = afterStats[player.id];
      if (!aStat) continue;

      if (player.type === 'PITCHER') {
        const pAfter = aStat.pitching;
        if (!pAfter) continue;
        const pBefore = bStat?.pitching;

        const winsDelta = pAfter.wins - (pBefore?.wins ?? 0);
        const savesDelta = pAfter.saves - (pBefore?.saves ?? 0);
        if (winsDelta <= 0 && savesDelta <= 0) continue;

        // 過去年度の通算を合算
        const past = careerTotals(playerCareers[player.id]?.seasons ?? []);
        const pastWins = past.pitching?.wins ?? 0;
        const pastSaves = past.pitching?.saves ?? 0;

        // 勝利数マイルストーン (100, 150, 200, 以降50ごと)
        if (winsDelta > 0) {
          const beforeWins = pastWins + (pBefore?.wins ?? 0);
          const afterWins = pastWins + pAfter.wins;
          const targets = findMilestones(beforeWins, afterWins, 100, 50);
          for (const t of targets) {
            notices.push(`${team.nickName}・${player.name}選手が通算${t}勝を達成！`);
          }
        }

        // セーブ数マイルストーン (100, 150, 200, 以降50ごと)
        if (savesDelta > 0) {
          const beforeSaves = pastSaves + (pBefore?.saves ?? 0);
          const afterSaves = pastSaves + pAfter.saves;
          const targets = findMilestones(beforeSaves, afterSaves, 100, 50);
          for (const t of targets) {
            notices.push(`${team.nickName}・${player.name}選手が通算${t}セーブを達成！`);
          }
        }
      } else {
        // 野手
        const bAfter = aStat.batting;
        if (!bAfter) continue;
        const bBefore = bStat?.batting;

        const hrDelta = bAfter.hr - (bBefore?.hr ?? 0);
        const hitsDelta = bAfter.hits - (bBefore?.hits ?? 0);
        if (hrDelta <= 0 && hitsDelta <= 0) continue;

        // 過去年度の通算を合算
        const past = careerTotals(playerCareers[player.id]?.seasons ?? []);
        const pastHr = past.batting?.hr ?? 0;
        const pastHits = past.batting?.hits ?? 0;

        // 本塁打マイルストーン (200, 300, 以降100ごと)
        if (hrDelta > 0) {
          const beforeHr = pastHr + (bBefore?.hr ?? 0);
          const afterHr = pastHr + bAfter.hr;
          const targets = findMilestones(beforeHr, afterHr, 200, 100);
          for (const t of targets) {
            notices.push(`${team.nickName}・${player.name}選手が通算${t}本塁打を達成！`);
          }
        }

        // 安打数マイルストーン (1000, 1500, 以降500ごと)
        if (hitsDelta > 0) {
          const beforeHits = pastHits + (bBefore?.hits ?? 0);
          const afterHits = pastHits + bAfter.hits;
          const targets = findMilestones(beforeHits, afterHits, 1000, 500);
          for (const t of targets) {
            notices.push(`${team.nickName}・${player.name}選手が通算${t}安打を達成！`);
          }
        }
      }
    }
  }

  return notices;
}
