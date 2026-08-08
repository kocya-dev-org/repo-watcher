import type { StoredNotification } from '../shared/notifications';

/**
 * chrome.storage.local に保持するランタイム状態のスキーマ。
 */
export type LocalRuntimeStorage = {
  lastCheckedAt: string | null;
  viewerLogin: string | null;
  viewerLoginPatKey: string | null;
  notifications: StoredNotification[];
  readNotificationIds: string[];
  badgeCount: number;
};

/** local storage 読み込み時に使用する既定値。 */
export const LOCAL_RUNTIME_DEFAULTS: LocalRuntimeStorage = {
  lastCheckedAt: null,
  viewerLogin: null,
  viewerLoginPatKey: null,
  notifications: [],
  readNotificationIds: [],
  badgeCount: 0,
};

/**
 * local storage からランタイム用の永続データを読み込む。
 * @returns ローカルストレージ上のランタイムデータ
 */
export function loadLocalRuntimeStorage(): Promise<LocalRuntimeStorage> {
  return new Promise((resolve) => {
    chrome.storage.local.get(LOCAL_RUNTIME_DEFAULTS, (items) => {
      resolve({
        lastCheckedAt: typeof items.lastCheckedAt === 'string' ? items.lastCheckedAt : null,
        viewerLogin: typeof items.viewerLogin === 'string' ? items.viewerLogin : null,
        viewerLoginPatKey: typeof items.viewerLoginPatKey === 'string' ? items.viewerLoginPatKey : null,
        notifications: Array.isArray(items.notifications) ? (items.notifications as StoredNotification[]) : [],
        readNotificationIds: Array.isArray(items.readNotificationIds) ? (items.readNotificationIds as string[]) : [],
        badgeCount: Number(items.badgeCount ?? 0),
      });
    });
  });
}

/**
 * local storage にランタイム用のデータを書き込む。
 * @param items 保存する項目
 */
export function saveLocalRuntimeStorage(items: Partial<LocalRuntimeStorage>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}
