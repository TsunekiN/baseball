import type { Player } from './types';
import type { PlayerCareer, SeasonStatLine, AbilitySnapshot } from './gameState';
import type { SeasonBatting, SeasonPitching } from '../match/matchStats';
import { emptyBatting, emptyPitching } from '../match/matchStats';

/** 疑似乱数ヘルパー（選手IDと年度で決定論的に生成し、リロードごとに値が変わらないようにする） */
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    return ((h += h << 5) >>> 0) / 4294967296;
  };
}

/**
 * 過去年度の成績（1年分）をシミュレート生成する
 */
function generatePastSeasonStats(
  player: Player,
  year: number,
  proYear: number,
  currentYear: number,
  teamId: string,
  teamName: string,
  rng: () => number,
): SeasonStatLine {
  const isPitcher = player.type === 'PITCHER';
  // 対象年度における実年齢（現在年度からの経過年数を差し引く）
  const yearsAgo = Math.max(0, currentYear - year);
  const ageAtYear = Math.max(18, player.age - yearsAgo);

  // 若手時代は能力が発展途上、全盛期（25〜30歳）は高め
  const primeFactor = Math.max(0.65, Math.min(1.0, 0.75 + (ageAtYear - 18) * 0.035));

  // 能力スナップショット
  const abilities: AbilitySnapshot = {
    age: ageAtYear,
    contact: Math.round(player.contact * primeFactor),
    power: Math.round(player.power * primeFactor),
    speed: Math.round(player.speed * Math.min(1.1, 1.15 - (ageAtYear - 18) * 0.012)),
    defense: Math.round(player.defense * primeFactor),
    velocity: Math.max(120, Math.round(player.velocity - yearsAgo * 0.4)),
    breaking: Math.round(player.breaking * primeFactor),
    control: Math.round(player.control * primeFactor),
    stamina: Math.round(player.stamina * primeFactor),
  };

  const batting: SeasonBatting = emptyBatting();
  const pitching: SeasonPitching = emptyPitching();

  if (isPitcher) {
    // 投手: 主力度に応じた起用
    const ovr = (player.velocity - 130) + player.control + player.breaking;
    const isStarter = player.stamina >= 50;

    // 出場機会（若手1年目は少なめ）
    const oppFactor = proYear === 1 ? 0.3 + rng() * 0.4 : Math.min(1.0, 0.5 + rng() * 0.5 + (ovr - 50) * 0.01);
    const inFirstTeam = rng() < oppFactor;

    if (inFirstTeam) {
      if (isStarter) {
        // 先発投手
        const games = Math.round(10 + rng() * 15);
        const outsPerGame = 16 + Math.round(rng() * 4); // 約5〜7回
        const totalOuts = games * outsPerGame;
        const eraTarget = Math.max(1.8, 5.0 - (player.control + player.breaking) * 0.03 + (rng() - 0.5));
        const runs = Math.round((eraTarget * (totalOuts / 3)) / 9);
        const winProb = Math.min(0.75, Math.max(0.3, 0.5 + (4.0 - eraTarget) * 0.08));
        const wins = Math.round(games * winProb * (0.6 + rng() * 0.3));
        const losses = Math.round(games * (1 - winProb) * (0.6 + rng() * 0.3));

        pitching.games = games;
        pitching.outs = totalOuts;
        pitching.runs = runs;
        pitching.wins = wins;
        pitching.losses = losses;
        pitching.saves = 0;
        pitching.holds = Math.round(rng() * 2);
        pitching.hits = Math.round(totalOuts * (0.25 + rng() * 0.05));
        pitching.hr = Math.round(games * (0.6 + (100 - player.breaking) * 0.01));
        pitching.bb = Math.round(games * (2.0 + (100 - player.control) * 0.02));
        pitching.hbp = Math.round(games * 0.3);
        pitching.so = Math.round(totalOuts * (0.2 + (player.breaking + (player.velocity - 140)) * 0.002));
      } else {
        // リリーフ投手
        const games = Math.round(25 + rng() * 35);
        const totalOuts = games * (3 + Math.round(rng() * 1.5)); // 1〜1.5回
        const eraTarget = Math.max(1.5, 4.5 - (player.control + player.breaking) * 0.03 + (rng() - 0.5));
        const runs = Math.round((eraTarget * (totalOuts / 3)) / 9);

        // 抑えかセットアッパーか中継ぎか
        const isCloser = player.breaking >= 65 && player.control >= 60 && rng() < 0.3;
        const isSetup = !isCloser && player.breaking >= 60 && rng() < 0.4;

        pitching.games = games;
        pitching.outs = totalOuts;
        pitching.runs = runs;
        pitching.wins = Math.round(games * 0.06);
        pitching.losses = Math.round(games * 0.05);
        pitching.saves = isCloser ? Math.round(15 + rng() * 20) : Math.round(rng() * 2);
        pitching.holds = isSetup ? Math.round(15 + rng() * 20) : Math.round(2 + rng() * 8);
        pitching.hits = Math.round(totalOuts * (0.22 + rng() * 0.05));
        pitching.hr = Math.round(games * 0.3);
        pitching.bb = Math.round(games * 0.9);
        pitching.hbp = Math.round(games * 0.15);
        pitching.so = Math.round(totalOuts * (0.25 + player.breaking * 0.002));
      }
    }
  } else {
    // 野手
    const ovr = player.contact + player.power + player.speed + player.defense;
    const oppFactor = proYear === 1 ? 0.25 + rng() * 0.3 : Math.min(1.0, 0.4 + rng() * 0.4 + (ovr - 200) * 0.005);
    const isStarter = rng() < oppFactor;

    const games = isStarter ? Math.round(100 + rng() * 43) : Math.round(15 + rng() * 50);
    const paPerGame = isStarter ? 3.8 + rng() * 0.5 : 1.2 + rng() * 1.0;
    const pa = Math.round(games * paPerGame);

    if (pa > 0) {
      const avgTarget = Math.min(0.34, Math.max(0.19, 0.22 + (player.contact - 50) * 0.002 + (rng() - 0.5) * 0.03));
      const bbRate = 0.06 + rng() * 0.06;
      const bb = Math.round(pa * bbRate);
      const hbp = Math.round(pa * 0.01);
      const sac = isStarter ? Math.round(rng() * 8) : Math.round(rng() * 3);
      const sf = isStarter ? Math.round(rng() * 5) : Math.round(rng() * 2);
      const ab = Math.max(1, pa - bb - hbp - sac - sf);

      const hits = Math.round(ab * avgTarget);
      const hrRate = Math.min(0.12, Math.max(0.005, 0.01 + (player.power - 40) * 0.0012 + (rng() - 0.5) * 0.01));
      const hr = Math.min(hits, Math.round(ab * hrRate));
      const doubles = Math.min(hits - hr, Math.round(hits * (0.15 + rng() * 0.08)));
      const triples = Math.min(hits - hr - doubles, Math.round(hits * (0.01 + (player.speed > 60 ? 0.02 : 0))));

      const rbi = Math.round(hr * (1.6 + rng() * 0.5) + (hits - hr) * (0.25 + rng() * 0.15));
      const runs = Math.round(hits * 0.4 + hr * 0.6);
      const sb = Math.round((player.speed - 45) * 0.3 * (isStarter ? 1 : 0.4) * (0.6 + rng() * 0.8));
      const so = Math.round(ab * (0.18 + (100 - player.contact) * 0.001));

      batting.games = games;
      batting.ab = ab;
      batting.hits = hits;
      batting.doubles = Math.max(0, doubles);
      batting.triples = Math.max(0, triples);
      batting.hr = hr;
      batting.rbi = rbi;
      batting.runs = runs;
      batting.bb = bb;
      batting.hbp = hbp;
      batting.so = so;
      batting.sac = sac;
      batting.sf = sf;
      batting.sb = Math.max(0, sb);
      batting.errors = Math.round(games * 0.04);
    }
  }

  return {
    year,
    teamId,
    teamName,
    stats: {
      batting: isPitcher ? undefined : batting,
      pitching: isPitcher ? pitching : undefined,
    },
    abilities,
  };
}

/**
 * 過去年度の成績を全自動生成する（入団年 debutYear から currentYear - 1 まで）
 */
export function generatePlayerPastCareer(
  player: Player,
  currentYear: number,
  teamId: string,
  teamName: string,
): PlayerCareer {
  const debutYear = player.debutYear;
  const seasons: SeasonStatLine[] = [];

  // debutYear から currentYear - 1 まで年度を生成
  for (let y = debutYear; y < currentYear; y++) {
    const proYear = y - debutYear + 1;
    const rng = seededRandom(`${player.id}_${y}`);
    const line = generatePastSeasonStats(player, y, proYear, currentYear, teamId, teamName, rng);
    seasons.push(line);
  }

  return {
    playerId: player.id,
    seasons,
  };
}

/**
 * 全チームの選手について、未設定の過去キャリアを一括バックフィル（補完）する。
 * 既存のセーブデータに年度別記録がまだない場合にも適用可能。
 */
export function backfillMissingCareers(
  teams: { id: string; nickName: string; players: Player[] }[],
  existingCareers: Record<string, PlayerCareer>,
  currentYear: number,
): Record<string, PlayerCareer> {
  const careers: Record<string, PlayerCareer> = { ...existingCareers };

  for (const team of teams) {
    for (const player of team.players) {
      // 既に過去の成績が存在する場合はスキップ
      const prev = careers[player.id];
      if (prev && Array.isArray(prev.seasons) && prev.seasons.length > 0) {
        continue;
      }

      // 入団年が今年より前（プロ2年目以上）の選手のみ過去成績を生成
      if (player.debutYear < currentYear) {
        careers[player.id] = generatePlayerPastCareer(player, currentYear, team.id, team.nickName);
      } else {
        // ルーキー（今年入団）は空配列で初期化
        careers[player.id] = {
          playerId: player.id,
          seasons: [],
        };
      }
    }
  }

  return careers;
}

/**
 * 過去の年度別能力推移や年度別成績に破損データ（異常な年齢・球速・他選手データの混入など）があれば修復する。
 */
export function sanitizePlayerCareers(
  teams: { id: string; nickName: string; players: Player[] }[],
  careers: Record<string, PlayerCareer>,
  currentYear: number,
): Record<string, PlayerCareer> {
  const next: Record<string, PlayerCareer> = { ...careers };
  const playerMap = new Map<string, { player: Player; teamId: string; teamName: string }>();
  for (const t of teams) {
    for (const p of t.players) {
      playerMap.set(p.id, { player: p, teamId: t.id, teamName: t.nickName });
    }
  }

  for (const [pid, career] of Object.entries(next)) {
    if (!career || !Array.isArray(career.seasons)) continue;
    const info = playerMap.get(pid);
    const p = info?.player;
    const cleanedSeasons: SeasonStatLine[] = [];
    const seenYears = new Set<number>();

    for (const s of career.seasons) {
      if (!s || typeof s.year !== 'number') continue;
      if (seenYears.has(s.year)) continue;
      seenYears.add(s.year);

      const ab = { ...(s.abilities ?? {}) } as AbilitySnapshot;
      const yearsAgo = Math.max(0, currentYear - s.year);

      if (p) {
        // 年齢の破損チェック（15歳未満または80歳超、または実年齢からの乖離があれば再計算）
        if (ab.age == null || ab.age < 15 || ab.age > 80 || Math.abs(ab.age - (p.age - yearsAgo)) > 2) {
          ab.age = Math.max(18, p.age - yearsAgo);
        }

        if (p.type === 'PITCHER') {
          // 投手の球速破損チェック（120km/h未満または175km/h超、または現在値から大きく乖離なら再計算）
          if (ab.velocity == null || ab.velocity < 120 || ab.velocity > 175 || Math.abs(ab.velocity - p.velocity) > 25) {
            ab.velocity = Math.max(120, Math.round(p.velocity - yearsAgo * 0.4));
          }
          // 他野手データで上書きされた可能性がある場合、制球・変化・スタミナの極端な低下を修復
          if (ab.control == null || (ab.control < 25 && p.control >= 40)) {
            ab.control = Math.round(p.control * Math.max(0.7, 1 - yearsAgo * 0.03));
          }
          if (ab.breaking == null || (ab.breaking < 25 && p.breaking >= 40)) {
            ab.breaking = Math.round(p.breaking * Math.max(0.7, 1 - yearsAgo * 0.03));
          }
          if (ab.stamina == null || (ab.stamina < 25 && p.stamina >= 40)) {
            ab.stamina = Math.round(p.stamina * Math.max(0.7, 1 - yearsAgo * 0.03));
          }
        } else {
          // 野手
          if (ab.contact == null || (ab.contact < 25 && p.contact >= 40)) {
            ab.contact = Math.round(p.contact * Math.max(0.7, 1 - yearsAgo * 0.03));
          }
          if (ab.power == null || (ab.power < 25 && p.power >= 40)) {
            ab.power = Math.round(p.power * Math.max(0.7, 1 - yearsAgo * 0.03));
          }
        }
      }

      // 成績データの混入チェック（投手に打者成績、または打者に投手成績が混入している場合）
      let stats = s.stats;
      if (p && info) {
        if (p.type === 'PITCHER' && stats.batting && !stats.pitching) {
          const proYear = Math.max(1, s.year - p.debutYear + 1);
          const regenerated = generatePastSeasonStats(
            p,
            s.year,
            proYear,
            currentYear,
            s.teamId || info.teamId,
            s.teamName || info.teamName,
            seededRandom(`${p.id}_${s.year}`)
          );
          stats = regenerated.stats;
        } else if (p.type === 'BATTER' && stats.pitching && !stats.batting) {
          const proYear = Math.max(1, s.year - p.debutYear + 1);
          const regenerated = generatePastSeasonStats(
            p,
            s.year,
            proYear,
            currentYear,
            s.teamId || info.teamId,
            s.teamName || info.teamName,
            seededRandom(`${p.id}_${s.year}`)
          );
          stats = regenerated.stats;
        }
      }

      cleanedSeasons.push({ ...s, stats, abilities: ab });
    }

    cleanedSeasons.sort((a, b) => a.year - b.year);
    next[pid] = { ...career, playerId: pid, seasons: cleanedSeasons };
  }

  return next;
}


