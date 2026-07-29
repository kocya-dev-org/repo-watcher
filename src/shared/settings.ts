/**
 * options / background で共有する設定関連の定数。
 *
 * 監視間隔は API 呼び出し回数の異常増加を防ぐため、下限を設けて扱う。
 */

/** 監視間隔の既定値 (分)。 */
export const DEFAULT_INTERVAL_MINUTES = 15;

/**
 * 監視間隔の最低値 (分)。
 *
 * 既定値と同値だが、下限クランプの意図を明確化するため別定数として定義する。
 */
export const MIN_INTERVAL_MINUTES = 15;
