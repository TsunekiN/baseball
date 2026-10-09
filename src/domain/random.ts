// 乱数ユーティリティ

/** min以上max以下の整数を返す */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 配列からランダムに1要素を返す */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * おおよそ正規分布（平均mean, おおよその標準偏差sd）に従う値を返す。
 * 中心極限定理を使った簡易版。min/maxでクランプする。
 */
export function gaussian(mean: number, sd: number, min: number, max: number): number {
  // 4つの一様乱数を平均すると近似的に正規分布になる
  const u = (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
  // uは平均0.5, おおよそsd 0.144。標準化して指定sdへスケール
  const z = (u - 0.5) / 0.144;
  const value = mean + z * sd;
  return Math.round(Math.max(min, Math.min(max, value)));
}
