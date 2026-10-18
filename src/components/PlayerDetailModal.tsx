import { useMemo, useState } from 'react';
import type { Player } from '../domain/types';
import type { AbilitySnapshot, PlayerCareer, SeasonStatLine } from '../domain/gameState';
import type { PlayerSeasonStats, SeasonBatting, SeasonPitching } from '../match/matchStats';
import {
  battingAvg, battingObp, battingSlg, battingOps, pitchingEra, pitchingWhip,
} from '../match/matchStats';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';
import { TITLE_DEFS, type TitleCounts } from '../domain/stats';
import { careerTotals } from '../domain/offseason';
import { BatterYearTable, PitcherYearTable, AbilityTrend } from './PlayerYearRecords';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  player: Player;
  stats?: PlayerSeasonStats; // 当年成績（レギュラーシーズン）
  postseasonStats?: PlayerSeasonStats; // 当年ポストシーズン成績（レギュラーとは独立）
  career?: PlayerCareer; // 過去の年度別成績
  titles?: TitleCounts; // タイトル獲得回数
  /** 今シーズン開幕時点の能力スナップショット（今年度の成長値＝増減分の表示用） */
  startAbilities?: AbilitySnapshot;
  year: number; // 現在の年度
  /** 殿堂入りモード（在籍年度表示・今年度成績タブ非表示） */
  hof?: { joinYear: number; leaveYear: number };
  /** 自由契約（戦力外）操作。オフシーズン中のみ渡される */
  onRelease?: (playerId: string) => void;
  onClose: () => void;
}

type Tab = 'basic' | 'season' | 'postseason' | 'career' | 'byYear' | 'trend';

const avg3 = (v: number) => v.toFixed(3).replace(/^0/, '');
const dec2 = (v: number) => v.toFixed(2);
const batsLabel = (b: Player['bats']) => (b === 'S' ? '両打' : b === 'L' ? '左打' : '右打');
const throwsLabel = (t: Player['throws']) => (t === 'L' ? '左投' : '右投');

/** 能力セル。delta は今年度の成長値（増減分）。無指定/0なら非表示 */
function AbCell({ label, value, isVelocity, delta }: { label: string; value: number; isVelocity?: boolean; delta?: number }) {
  const rank = isVelocity ? rankFromVelocity(value) : rankFromValue(value);
  const c = rankColor(rank);
  const d = delta != null ? Math.round(delta) : 0;
  return (
    <span className="md-ab">
      <span className="md-ab-label">{label}</span>
      <span className="md-ab-val">
        {displayAbility(value)}
        <span style={{ color: c.border }}>{rank}</span>
      </span>
      {delta != null && d !== 0 && (
        <span className={`md-ab-delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? `+${d}` : d}</span>
      )}
    </span>
  );
}

export function PlayerDetailModal({ player, stats, postseasonStats, career, titles, startAbilities, year, hof, onRelease, onClose }: Props) {
  const isPitcher = player.type === 'PITCHER';
  const [tab, setTab] = useState<Tab>('basic');
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const proYear = year - player.debutYear + 1;
  const showHidden = proYear >= 3; // 隠しパラメータは入団3年目以降に公開

  // 年度別成績・能力推移（確定した過去の年度別成績 + 進行中の今年度）
  const seasons: SeasonStatLine[] = useMemo(() => {
    const past = career?.seasons ?? [];
    const list: SeasonStatLine[] = [...past];

    // 今年度がまだ past に未収録の場合、現在進行中の今年度を最新行として追加
    if (!hof && !past.some((s) => s.year === year)) {
      const currentAbilities: AbilitySnapshot = {
        age: player.age,
        contact: player.contact,
        power: player.power,
        speed: player.speed,
        defense: player.defense,
        velocity: player.velocity,
        breaking: player.breaking,
        control: player.control,
        stamina: player.stamina,
      };
      list.push({
        year,
        teamId: '',
        teamName: '今季',
        stats: stats ?? {},
        abilities: currentAbilities,
      });
    }

    return list.sort((a, b) => b.year - a.year);
  }, [career, stats, player, year, hof]);

  // 通算成績（過去 + 今年度の合算）
  const totals = useMemo(() => {
    const past = career?.seasons ?? [];
    const list: { stats: { batting?: SeasonBatting; pitching?: SeasonPitching } }[] = [...past];
    if (!hof && stats && (stats.batting || stats.pitching)) {
      list.push({ stats });
    }
    return careerTotals(list);
  }, [career, stats, hof]);

  const titleList = useMemo(() => {
    if (!titles) return [];
    return TITLE_DEFS.filter((d) => titles[d.key] > 0).map((d) => {
      const n = titles[d.key];
      return n > 1 ? `${d.label}×${n}` : d.label;
    });
  }, [titles]);

  // ポストシーズンに出場記録があるか（打席 or 登板）
  const hasPostseason =
    !hof && !!postseasonStats && (
      (postseasonStats.batting?.games ?? 0) > 0 || (postseasonStats.pitching?.games ?? 0) > 0
    );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'basic', label: '基本' },
    ...(hof ? [] : [{ id: 'season' as Tab, label: '今年度' }]),
    ...(hasPostseason ? [{ id: 'postseason' as Tab, label: 'PS' }] : []),
    { id: 'career', label: '通算' },
    { id: 'byYear', label: '年度別' },
    { id: 'trend', label: '能力推移' },
  ];

  // 今年度の成長値（開幕時スナップショットとの差分）。殿堂入りモードや開幕前は表示しない。
  const sa = hof ? undefined : startAbilities;
  const delta = (key: keyof AbilitySnapshot, cur: number): number | undefined =>
    sa ? cur - (sa[key] as number) : undefined;
  const abilities = isPitcher
    ? [
        { label: '球', value: player.velocity, isVelocity: true, delta: delta('velocity', player.velocity) },
        { label: '制', value: player.control, delta: delta('control', player.control) },
        { label: '変', value: player.breaking, delta: delta('breaking', player.breaking) },
        { label: 'ス', value: player.stamina, delta: delta('stamina', player.stamina) },
      ]
    : [
        { label: 'ミ', value: player.contact, delta: delta('contact', player.contact) },
        { label: 'パ', value: player.power, delta: delta('power', player.power) },
        { label: '走', value: player.speed, delta: delta('speed', player.speed) },
        { label: '守', value: player.defense, delta: delta('defense', player.defense) },
      ];

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel dense" onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="md-head">
          <span className="md-name">{player.name}</span>
          <span className="md-meta">
            {player.position} ・ {hof ? `在籍 ${hof.joinYear}〜${hof.leaveYear}` : `${player.age}歳（${proYear}年目）`}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        {/* タブ */}
        <div className="roster-tabs" style={{ marginTop: 6 }}>
          {tabs.map((t) => (
            <button key={t.id} className={`roster-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 8 }}>
          {tab === 'basic' && (
            <div>
              {/* 能力 */}
              <div className="md-row md-abilities">
                {abilities.map((a) => (
                  <AbCell key={a.label} label={a.label} value={a.value} isVelocity={a.isVelocity} delta={a.delta} />
                ))}
                <span className="md-divider" />
                <AbCell label="健" value={player.health} />
                {showHidden ? (
                  <>
                    <AbCell label="才" value={player.talent} />
                    {player.is_foreign ? (
                      <AbCell label="適" value={player.adaptability} />
                    ) : (
                      <AbCell label="努" value={player.effort} />
                    )}
                  </>
                ) : (
                  <>
                    <span className="md-ab"><span className="md-ab-label">才</span><span className="md-ab-val">？</span></span>
                    <span className="md-ab"><span className="md-ab-label">{player.is_foreign ? '適' : '努'}</span><span className="md-ab-val">？</span></span>
                  </>
                )}
              </div>
              {/* プロフィール */}
              <div className="md-profile">
                <div><span className="md-pf-label">出身</span>{player.hometown}</div>
                <div><span className="md-pf-label">投打</span>{throwsLabel(player.throws)}{batsLabel(player.bats)}</div>
              </div>
              {/* タイトル */}
              <div className="md-profile">
                <div><span className="md-pf-label">タイトル</span>{titleList.length > 0 ? titleList.join('・') : 'なし'}</div>
              </div>
              {onRelease && !hof && (
                <button
                  className="ghost-btn"
                  style={{ marginTop: 10, color: '#e23b3b', borderColor: '#e23b3b' }}
                  onClick={() => setShowReleaseConfirm(true)}
                >
                  自由契約にする
                </button>
              )}
            </div>
          )}

          {tab === 'season' && (
            isPitcher
              ? (stats?.pitching ? <PitchingDetail s={stats.pitching} /> : <div className="md-empty">今年度の登板記録はありません</div>)
              : (stats?.batting ? <BattingDetail s={stats.batting} /> : <div className="md-empty">今年度の出場記録はありません</div>)
          )}

          {tab === 'postseason' && (
            isPitcher
              ? (postseasonStats?.pitching ? <PitchingDetail s={postseasonStats.pitching} /> : <div className="md-empty">ポストシーズンの登板記録はありません</div>)
              : (postseasonStats?.batting ? <BattingDetail s={postseasonStats.batting} /> : <div className="md-empty">ポストシーズンの出場記録はありません</div>)
          )}

          {tab === 'career' && (
            isPitcher
              ? (totals.pitching ? <PitchingDetail s={totals.pitching} /> : <div className="md-empty">記録なし</div>)
              : (totals.batting ? <BattingDetail s={totals.batting} /> : <div className="md-empty">記録なし</div>)
          )}

          {tab === 'byYear' && (
            isPitcher ? <PitcherYearTable seasons={seasons} /> : <BatterYearTable seasons={seasons} />
          )}

          {tab === 'trend' && <AbilityTrend seasons={seasons} isPitcher={isPitcher} />}
        </div>
      </div>
    </div>
    {onRelease && showReleaseConfirm && (
      <ConfirmModal
        title="自由契約の確認"
        message={`${player.name} を自由契約（戦力外）にしますか？`}
        confirmLabel="自由契約にする"
        danger
        onConfirm={() => {
          setShowReleaseConfirm(false);
          onRelease(player.id);
          onClose();
        }}
        onCancel={() => setShowReleaseConfirm(false)}
      />
    )}
    </>
  );
}

/** 打者の詳細成績（今年度/通算共通） */
function BattingDetail({ s }: { s: SeasonBatting }) {
  const singles = s.hits - s.doubles - s.triples - s.hr;
  const rows: [string, string][] = [
    ['試合', String(s.games)],
    ['打率', avg3(battingAvg(s))],
    ['安打', String(s.hits)],
    ['単打', String(singles)],
    ['二塁打', String(s.doubles)],
    ['三塁打', String(s.triples)],
    ['本塁打', String(s.hr)],
    ['打点', String(s.rbi)],
    ['得点', String(s.runs)],
    ['盗塁', String(s.sb)],
    ['四球', String(s.bb)],
    ['死球', String(s.hbp)],
    ['犠打', String(s.sac)],
    ['犠飛', String(s.sf)],
    ['三振', String(s.so)],
    ['出塁率', avg3(battingObp(s))],
    ['長打率', avg3(battingSlg(s))],
    ['OPS', battingOps(s).toFixed(3)],
    ['失策', String(s.errors)],
  ];
  return <StatGrid rows={rows} />;
}

/** 投手の詳細成績（今年度/通算共通） */
function PitchingDetail({ s }: { s: SeasonPitching }) {
  const ip = s.outs / 3;
  const k9 = ip > 0 ? (s.so * 9) / ip : 0;
  const kbb = s.bb > 0 ? s.so / s.bb : s.so;
  const earned = Math.max(0, s.runs - s.unearnedRuns);
  // 投球回は野球慣例の「N回1/3」表記（outs ベース）
  const ipWhole = Math.floor(s.outs / 3);
  const ipFrac = s.outs % 3;
  const ipText = ipFrac === 0 ? `${ipWhole}` : `${ipWhole} ${ipFrac}/3`;
  const rows: [string, string][] = [
    ['防御率', dec2(pitchingEra(s))],
    ['登板', String(s.games)],
    ['勝利', String(s.wins)],
    ['敗戦', String(s.losses)],
    ['セーブ', String(s.saves)],
    ['ホールド', String(s.holds)],
    ['投球回', ipText],
    ['奪三振', String(s.so)],
    ['奪三振率', dec2(k9)],
    ['与四球', String(s.bb)],
    ['与死球', String(s.hbp)],
    ['被本塁打', String(s.hr)],
    ['自責点', String(earned)],
    ['K/BB', dec2(kbb)],
    ['WHIP', dec2(pitchingWhip(s))],
    ['失策', String(s.errors)],
  ];
  return <StatGrid rows={rows} />;
}

function StatGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="md-stat-grid">
      {rows.map(([label, val]) => (
        <div key={label} className="md-stat-cell">
          <span className="md-stat-label">{label}</span>
          <span className="md-stat-val">{val}</span>
        </div>
      ))}
    </div>
  );
}
