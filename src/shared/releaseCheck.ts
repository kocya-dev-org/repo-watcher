/**
 * 拡張機能の最新リリース確認に関する共有ロジック。
 *
 * 最新バージョンの取得は background service worker が読み込み時に一度だけ行い、
 * 結果を `chrome.storage.local` に保存する。popup は保存済みの値を読むだけで
 * GitHub API を直接呼ばない。
 */

/** 最新リリース情報を取得する GitHub REST API エンドポイント (PAT 不要)。 */
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/kocya-dev-org/repo-watcher/releases/latest';

/** local storage 上の最新リリース確認結果。 */
export type LatestReleaseCheck = {
  /** 取得済みの最新バージョン文字列 (先頭の v は除去済み)。未取得または確認失敗時は null。 */
  latestReleaseVersion: string | null;
  /** 最後に確認した時刻 (ISO 8601)。 */
  latestReleaseCheckedAt: string | null;
};

/** local storage 読み込み時に使用する既定値。 */
const LATEST_RELEASE_DEFAULTS: LatestReleaseCheck = {
  latestReleaseVersion: null,
  latestReleaseCheckedAt: null,
};

/**
 * GitHub REST API から最新リリースのバージョン文字列を取得する。
 *
 * ネットワークエラーや 404、レート制限 (403) などは握りつぶし、
 * 「新バージョンなし」として null を返す (例外を投げない)。
 * @returns 先頭の v を除去したバージョン文字列。取得失敗時は null
 */
export async function fetchLatestReleaseVersion(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { tag_name?: unknown };
    const tagName = typeof data.tag_name === 'string' ? data.tag_name : null;
    if (!tagName) {
      return null;
    }

    return tagName.replace(/^v/i, '');
  } catch {
    return null;
  }
}

/**
 * `major.minor.patch` を数値で比較し、latest が current より新しいかを返す。
 *
 * プレリリースやビルドメタデータなどのサフィックスは無視する。
 * @param latest 比較対象の最新バージョン
 * @param current 現在のバージョン
 * @returns latest > current のとき true
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parseParts = (version: string): number[] =>
    version
      .replace(/^v/i, '')
      .split(/[-+]/, 1)[0]
      .split('.')
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      });

  const latestParts = parseParts(latest);
  const currentParts = parseParts(current);

  for (let index = 0; index < 3; index += 1) {
    const diff = (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }

  return false;
}

/**
 * local storage から最新リリース確認結果を読み込む。
 * @returns 保存済みの確認結果。未保存時は既定値
 */
export function loadLatestReleaseCheck(): Promise<LatestReleaseCheck> {
  return new Promise((resolve) => {
    chrome.storage.local.get(LATEST_RELEASE_DEFAULTS, (items) => {
      resolve({
        latestReleaseVersion:
          typeof items.latestReleaseVersion === 'string' && items.latestReleaseVersion.length > 0
            ? items.latestReleaseVersion
            : null,
        latestReleaseCheckedAt: typeof items.latestReleaseCheckedAt === 'string' ? items.latestReleaseCheckedAt : null,
      });
    });
  });
}

/**
 * local storage に最新リリース確認結果を書き込む。
 * @param latestReleaseVersion 最新バージョン文字列。未取得時は null
 * @param latestReleaseCheckedAt 確認時刻 (ISO 8601)
 */
export function saveLatestReleaseCheck(
  latestReleaseVersion: string | null,
  latestReleaseCheckedAt: string,
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ latestReleaseVersion, latestReleaseCheckedAt }, () => resolve());
  });
}
