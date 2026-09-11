import { fetchLatestReleaseVersion, loadLatestReleaseCheck, saveLatestReleaseCheck } from '../shared/releaseCheck';
import { debugLog } from './logging';
import { sanitizeError } from './security';

/**
 * 拡張機能の読み込み時に一度だけ最新リリースを確認する。
 *
 * `chrome.storage.local` に確認結果 (`latestReleaseVersion` / `latestReleaseCheckedAt`)
 * が残っている場合は再取得せず、そのまま終了する。値が無い場合のみ GitHub REST API を
 * 呼び出して結果を保存する。これにより service worker が再起動しても再取得は走らず、
 * 実質ブラウザセッションで一度きりになる。
 */
export async function checkLatestReleaseOnce(): Promise<void> {
  try {
    const stored = await loadLatestReleaseCheck();
    if (stored.latestReleaseVersion !== null || stored.latestReleaseCheckedAt !== null) {
      return;
    }

    const latestReleaseVersion = await fetchLatestReleaseVersion();
    await saveLatestReleaseCheck(latestReleaseVersion, new Date().toISOString());
    debugLog('latest release checked', { latestReleaseVersion });
  } catch (err) {
    debugLog('latest release check failed', sanitizeError(err));
  }
}
