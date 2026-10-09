import type { Player } from '../domain/types';
import type { AbilitySnapshot } from '../domain/gameState';
import type { PlayerSeasonStats } from '../match/matchStats';
import { battingAvg, pitchingEra } from '../match/matchStats';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';
import { fieldPositionLabel } from '../domain/orderLabels';

interface Props {
  player: Player;
  stats?: PlayerSeasonStats;
  /** 今シーズン開幕時の能力スナップショット（今季増減の基準） */
  startAbilities?: AbilitySnapshot;
  /** 現在の年度（隠しパラメータ公開判定に使用） */
  year: number;
  /** マイチームのテーマカラー（枠色） */
  color: string;
  /** 守備位置ラベル（オーダー画面で割り当て中の位置。無ければ選手の既定ポジション） */
  positionLabel?: string;
}

/** 能力セル（ラベル＋数値＋ランク色）。球速は km/h 基準でランク判定 */
function AbCell({ label, value, isVelocity }: { label: string; value: number; isVelocity?: boolean }) {
  const rank = isVelocity ? rankFromVelocity(value) : rankFromValue(value);
  const c = rankColor(rank);
  return (
    <span className="ph-ab">
      <span className="ph-ab-label">{label}</span>
      <span className="ph-ab-val">
        {displayAbility(value)}
        <span style={{ color: c.border }}>{rank}</span>
      </span>
    </span>
  );
}

/**
 * オーダー/編成画面のヘッダーに表示する選手情報カード。
 * 1行目: 名前・年齢・POS・今年度成績（打者=打率/打点/HR/盗塁、投手=勝/負/S/防御率）
 * 2行目: 基本4能力 + 健 + 才 + 努(外国人は適) + 今季の合計能力増減
 */
export function PlayerHeroCard({ player, stats, startAbilities, year, color, positionLabel }: Props) {
  const isPitcher = player.type === 'PITCHER';
  const proYear = year - player.debutYear + 1;
  const showHidden = proYear >= 3; // 隠しパラメータは入団3年目以降に公開

  const pos = positionLabel ?? (isPitcher ? '投' : fieldPositionLabel(defaultFieldPos(player)));
  // 投打（例: 右投右打）
  const throwsBats = `${player.throws === 'L' ? '左投' : '右投'}${player.bats === 'S' ? '両打' : player.bats === 'L' ? '左打' : '右打'}`;

  // 今年度成績
  const b = stats?.batting;
  const p = stats?.pitching;
  const statText = isPitcher
    ? `${p?.wins ?? 0}勝 ${p?.losses ?? 0}敗 ${p?.saves ?? 0}S 防${p ? pitchingEra(p).toFixed(2) : '0.00'}`
    : `打率${b ? battingAvg(b).toFixed(3).replace(/^0/, '') : '.000'} ${b?.rbi ?? 0}打点 ${b?.hr ?? 0}本 ${b?.sb ?? 0}盗`;

  // 基本4能力（打者=ミ/パ/走/守、投手=球/制/変/ス）
  const basics = isPitcher
    ? [
        { label: '球', value: player.velocity, isVelocity: true },
        { label: '制', value: player.control },
        { label: '変', value: player.breaking },
        { label: 'ス', value: player.stamina },
      ]
    : [
        { label: 'ミ', value: player.contact },
        { label: 'パ', value: player.power },
        { label: '走', value: player.speed },
        { label: '守', value: player.defense },
      ];

  // 今季の合計能力増減（基本4能力の現在値合計 − 開幕時合計。球速も含む）
  const currentSum = isPitcher
    ? player.velocity + player.breaking + player.control + player.stamina
    : player.contact + player.power + player.speed + player.defense;
  const startSum = startAbilities
    ? isPitcher
      ? startAbilities.velocity + startAbilities.breaking + startAbilities.control + startAbilities.stamina
      : startAbilities.contact + startAbilities.power + startAbilities.speed + startAbilities.defense
    : currentSum;
  const delta = Math.round(currentSum - startSum);
  const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
  const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  const hiddenLabel = player.is_foreign ? '適' : '努';
  const hiddenValue = player.is_foreign ? player.adaptability : player.effort;

  return (
    <div className="player-hero" style={{ borderColor: color }}>
      {/* 1行目: 名前・年齢・POS・今年度成績 */}
      <div className="ph-row1">
        <span className="ph-name">{player.name}</span>
        <span className="ph-meta">{player.age}歳 ・ {pos} ・ {throwsBats}</span>
        <span className="ph-stat">{statText}</span>
      </div>
      {/* 2行目: 基本4能力 + 健 + 才 + 努(適) + 今季増減 */}
      <div className="ph-row2">
        {basics.map((a) => (
          <AbCell key={a.label} label={a.label} value={a.value} isVelocity={a.isVelocity} />
        ))}
        <span className="ph-divider" />
        <AbCell label="健" value={player.health} />
        {showHidden ? (
          <>
            <AbCell label="才" value={player.talent} />
            <AbCell label={hiddenLabel} value={hiddenValue} />
          </>
        ) : (
          <>
            <span className="ph-ab"><span className="ph-ab-label">才</span><span className="ph-ab-val">？</span></span>
            <span className="ph-ab"><span className="ph-ab-label">{hiddenLabel}</span><span className="ph-ab-val">？</span></span>
          </>
        )}
        <span className="ph-divider" />
        <span className="ph-delta" title="今季の能力成長（基本4能力の合計）">
          <span className="ph-ab-label">成長</span>
          <span className={`ph-delta-val ${deltaClass}`}>{deltaText}</span>
        </span>
      </div>
    </div>
  );
}

/** Player.position(P/C/1B/2B/3B/SS/OF) を FieldPosition へ寄せる（表示用） */
function defaultFieldPos(player: Player) {
  // OF は LF/CF/RF の総称。守備位置ラベルは外野を includes しないため CF 相当で表示
  if (player.position === 'OF') return 'CF' as const;
  return player.position as 'C' | '1B' | '2B' | '3B' | 'SS';
}
