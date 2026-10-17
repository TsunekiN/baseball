import { useState } from 'react';
import type { Player, Position, Team } from '../domain/types';
import type { ForeignScoutState } from '../domain/gameState';
import { rankColor, rankFromValue, rankFromVelocity, displayAbility } from '../domain/rank';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  scout: ForeignScoutState;
  myTeam: Team;
  /** 現在の年度（終了確認モーダルの表示用） */
  year: number;
  /** ドラフトで指名したマイチームの選手数（まだ players に未反映のため別途加算） */
  draftPickCount: number;
  canSign: boolean;
  onOffer: (position: Position) => void;
  onSign: (prospectId: string) => void;
  onFinish: () => void;
}

const POSITIONS: { pos: Position; label: string }[] = [
  { pos: 'P', label: '投手' },
  { pos: 'C', label: '捕手' },
  { pos: '1B', label: '一塁' },
  { pos: '2B', label: '二塁' },
  { pos: '3B', label: '三塁' },
  { pos: 'SS', label: '遊撃' },
  { pos: 'OF', label: '外野' },
];

const COUNTRY_LABEL: Record<string, string> = {
  USA: 'アメリカ', CUB: 'キューバ', DOM: 'ドミニカ', VEN: 'ベネズエラ', JPN: '日本',
};

export function ForeignScoutScreen({ scout, myTeam, year, draftPickCount, canSign, onOffer, onSign, onFinish }: Props) {
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const foreignCount = myTeam.players.filter((p) => p.is_foreign).length + scout.signed.length;
  // 保有数はドラフト指名選手（players 未反映）も加算
  const total = myTeam.players.length + draftPickCount + scout.signed.length;

  return (
    <div className="scout-screen">
      <div className="scout-head">
        <h2 className="offseason-title">🌎 新外国人スカウト</h2>
        <div className="scout-usage">
          外国人 {foreignCount}/5 ・ 保有 {total}/50
        </div>
      </div>

      {/* 獲得済み */}
      {scout.signed.length > 0 && (
        <div className="scout-signed">
          <div className="scout-sub">獲得した選手</div>
          {scout.signed.map((p) => (
            <div key={p.id} className="off-line">
              <span className="off-name">{p.name}（{p.position}）</span>
              <span className="off-note">{COUNTRY_LABEL[p.country] ?? p.country}</span>
            </div>
          ))}
        </div>
      )}

      {/* ポジション選択 */}
      <div className="scout-sub">補強ポジションを選択</div>
      <div className="scout-pos-btns">
        {POSITIONS.map((pp) => (
          <button
            key={pp.pos}
            className={`scout-pos-btn${scout.position === pp.pos ? ' active' : ''}`}
            onClick={() => onOffer(pp.pos)}
            disabled={!canSign}
          >
            {pp.label}
          </button>
        ))}
      </div>

      {!canSign && (
        <p className="dummy-note">外国人枠（5名）または保有枠（50名）が上限です。</p>
      )}

      {/* 提示中の候補（表形式） */}
      {scout.offered.length > 0 && (
        <div className="scout-offers">
          <div className="scout-sub">スカウト報告（{scout.offered.length}名）</div>
          <ProspectTable prospects={scout.offered} canSign={canSign} onSign={onSign} />
        </div>
      )}

      <button className="primary-btn full" style={{ marginTop: 16 }} onClick={() => setShowFinishConfirm(true)}>
        新外国人スカウトを終了する
      </button>

      {showFinishConfirm && (
        <ConfirmModal
          title="シーズン終了の確認"
          message={`${year}年シーズンを終了します`}
          confirmLabel="終了する"
          onConfirm={() => {
            setShowFinishConfirm(false);
            onFinish();
          }}
          onCancel={() => setShowFinishConfirm(false)}
        />
      )}
    </div>
  );
}

/** 数値＋ランク（色付き）の能力セル */
function AbVal({ value, isVelocity }: { value: number; isVelocity?: boolean }) {
  const rank = isVelocity ? rankFromVelocity(value) : rankFromValue(value);
  const c = rankColor(rank);
  return (
    <span className="scout-td-ab">
      {displayAbility(value)}
      <span style={{ color: c.border }}>{rank}</span>
    </span>
  );
}

/** スカウト候補の表。名前・年齢・出身国・主要4能力・健康・獲得ボタン */
function ProspectTable({
  prospects,
  canSign,
  onSign,
}: {
  prospects: Player[];
  canSign: boolean;
  onSign: (id: string) => void;
}) {
  // 先頭候補のタイプで能力ラベルを決める（同一ポジション提示＝同一タイプ）
  const isPitcher = prospects[0]?.type === 'PITCHER';
  const abLabels = isPitcher ? ['球', '制', '変', 'ス'] : ['ミ', 'パ', '走', '守'];
  return (
    <div className="scout-table-wrap">
      <table className="scout-table">
        <thead>
          <tr>
            <th className="left">名前</th>
            <th>年齢</th>
            <th>出身</th>
            {abLabels.map((l) => (
              <th key={l}>{l}</th>
            ))}
            <th>健</th>
            <th>才</th>
            <th>適</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => {
            const pitcher = p.type === 'PITCHER';
            const abs = pitcher
              ? [
                  { value: p.velocity, isVelocity: true },
                  { value: p.control },
                  { value: p.breaking },
                  { value: p.stamina },
                ]
              : [
                  { value: p.contact },
                  { value: p.power },
                  { value: p.speed },
                  { value: p.defense },
                ];
            return (
              <tr key={p.id}>
                <td className="left scout-td-name">{p.name}</td>
                <td>{p.age}</td>
                <td>{COUNTRY_LABEL[p.country] ?? p.country}</td>
                {abs.map((a, i) => (
                  <td key={i}>
                    <AbVal value={a.value} isVelocity={a.isVelocity} />
                  </td>
                ))}
                <td>
                  <AbVal value={p.health} />
                </td>
                <td>
                  <AbVal value={p.talent} />
                </td>
                <td>
                  <AbVal value={p.adaptability} />
                </td>
                <td className="right">
                  <button className="primary-btn xs scout-sign-btn" onClick={() => onSign(p.id)} disabled={!canSign}>
                    獲得
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
