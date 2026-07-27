/** debug ビルド時のみログ出力を有効にする。 */
const DEBUG_LOG_ENABLED = import.meta.env.MODE === 'debug';

/**
 * デバッグビルド向けのログを統一フォーマットで出力する。
 * @param message ログメッセージ
 * @param payload 追加の詳細情報
 */
export function debugLog(message: string, payload?: unknown) {
  if (!DEBUG_LOG_ENABLED) {
    return;
  }

  if (payload === undefined) {
    console.info('[github-notify-ext]', message);
    return;
  }

  console.info('[github-notify-ext]', message, payload);
}
