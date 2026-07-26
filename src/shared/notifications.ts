export type NotificationKind = 'new' | 'updated' | 'mention' | 'thread' | 'assignee';

const NOTIFICATION_KIND_ORDER: NotificationKind[] = ['new', 'updated', 'mention', 'thread', 'assignee'];

export type StoredNotification = {
  id: string;
  kinds?: NotificationKind[];
  sourceNodeId: string;
  isPullRequest: boolean;
  isDraft?: boolean;
  isApproved?: boolean;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  detectedAt: string;
  isPresentInLatestResult?: boolean;
};

/**
 * 未読件数から拡張機能バッジの表示テキストを生成する。
 *
 * 0 件のときは空文字を返してバッジを非表示にする。
 * @param count 未読通知数
 * @returns バッジ表示用テキスト
 */
export function formatBadgeText(count: number): string {
  return count > 0 ? String(count) : '';
}

/**
 * 通知種別を i18n 翻訳キーへ変換する。
 * @param kind 通知種別
 * @returns i18n 翻訳キー
 */
export function formatNotificationKindLabel(kind: NotificationKind): string {
  switch (kind) {
    case 'new':
      return 'notificationKind.new';
    case 'updated':
      return 'notificationKind.updated';
    case 'mention':
      return 'notificationKind.mention';
    case 'thread':
      return 'notificationKind.thread';
    case 'assignee':
      return 'notificationKind.assignee';
    default:
      return kind;
  }
}

/**
 * 保存済み通知から kind 一覧を正規化して返す。
 * @param notification 通知データ
 * @returns 重複を除いた通知種別一覧
 */
export function getNotificationKinds(notification: StoredNotification): NotificationKind[] {
  return notification.kinds?.filter((kind): kind is NotificationKind => NOTIFICATION_KIND_ORDER.includes(kind)) ?? [];
}

/**
 * 2 つの通知データの kind 集合が異なるかを判定する。
 * @param current 既存の通知データ
 * @param merged 統合後の通知データ
 * @returns kind の内容が変化していれば true
 */
function hasNotificationKindsChanged(current: StoredNotification, merged: StoredNotification): boolean {
  const currentKinds = getNotificationKinds(current);
  const mergedKinds = getNotificationKinds(merged);

  if (currentKinds.length !== mergedKinds.length) {
    return true;
  }

  const currentKindSet = new Set(currentKinds);

  return mergedKinds.some((kind) => !currentKindSet.has(kind));
}

/**
 * 2 つの通知データを item 単位で統合する。
 * @param current 既存の通知データ
 * @param incoming 新たに検知した通知データ
 * @returns kind を統合した通知データ
 */
export function mergeStoredNotifications(
  current: StoredNotification,
  incoming: StoredNotification,
): StoredNotification {
  const mergedKinds = NOTIFICATION_KIND_ORDER.filter((kind) =>
    [...getNotificationKinds(current), ...getNotificationKinds(incoming)].includes(kind),
  );

  const finalKinds = mergedKinds.includes('updated') ? mergedKinds.filter((kind) => kind !== 'new') : mergedKinds;

  return {
    ...current,
    ...incoming,
    id: current.id,
    sourceNodeId: current.sourceNodeId,
    kinds: finalKinds,
    detectedAt:
      new Date(incoming.detectedAt).getTime() >= new Date(current.detectedAt).getTime()
        ? incoming.detectedAt
        : current.detectedAt,
    isPresentInLatestResult: incoming.isPresentInLatestResult ?? current.isPresentInLatestResult,
    isDraft: incoming.isDraft ?? current.isDraft,
  };
}

/**
 * ドラフト PR 通知の表示設定に応じて通知一覧を絞り込む。
 * @param notifications 通知一覧
 * @param notifyDraftPr ドラフト PR を通知対象にする設定
 * @returns 設定に応じた通知一覧
 */
export function filterNotificationsByDraftSetting(
  notifications: StoredNotification[],
  notifyDraftPr: boolean,
): StoredNotification[] {
  if (notifyDraftPr) {
    return notifications;
  }

  return notifications.filter((notification) => !(notification.isPullRequest && notification.isDraft));
}

/**
 * 通知一覧と既読 ID から未読件数を数える。
 * @param notifications 通知一覧
 * @param readNotificationIds 既読通知 ID 一覧
 * @returns 未読件数
 */
export function calculateUnreadCount(notifications: StoredNotification[], readNotificationIds: string[]): number {
  const readSet = new Set(readNotificationIds);
  return notifications.filter((notification) => !readSet.has(notification.id)).length;
}

/**
 * 指定した通知 ID を既読一覧へ追加する。
 * @param readNotificationIds 既読通知 ID 一覧
 * @param notificationId 追加する通知 ID
 * @returns 更新後の既読通知 ID 一覧
 */
export function markNotificationAsRead(readNotificationIds: string[], notificationId: string): string[] {
  if (readNotificationIds.includes(notificationId)) {
    return readNotificationIds;
  }

  return [...readNotificationIds, notificationId];
}

/**
 * 指定した通知 ID の既読状態を反転する。
 * @param readNotificationIds 既読通知 ID 一覧
 * @param notificationId 切り替える通知 ID
 * @returns 更新後の既読通知 ID 一覧
 */
export function toggleNotificationRead(readNotificationIds: string[], notificationId: string): string[] {
  if (readNotificationIds.includes(notificationId)) {
    return readNotificationIds.filter((id) => id !== notificationId);
  }

  return [...readNotificationIds, notificationId];
}

/**
 * 既読済み通知を通知一覧から取り除き、未読だけの状態へ整理する。
 * @param notifications 通知一覧
 * @param readNotificationIds 既読通知 ID 一覧
 * @returns 整理後の通知一覧と badge 情報
 */
export function pruneReadNotifications(
  notifications: StoredNotification[],
  readNotificationIds: string[],
): {
  notifications: StoredNotification[];
  readNotificationIds: string[];
  badgeCount: number;
} {
  const readSet = new Set(readNotificationIds);
  const unreadNotifications = notifications.filter((notification) => !readSet.has(notification.id));

  return {
    notifications: unreadNotifications,
    readNotificationIds: [],
    badgeCount: unreadNotifications.length,
  };
}

/**
 * 新規検知分を既存通知へマージし、重複排除と badge 再計算を行う。
 * @param existingNotifications 既存通知一覧
 * @param readNotificationIds 既読通知 ID 一覧
 * @param detectedNotifications 今回検知した通知一覧
 * @returns 保存用に整えた通知状態
 */
export function reconcileNotificationState(
  existingNotifications: StoredNotification[],
  readNotificationIds: string[],
  detectedNotifications: StoredNotification[],
): {
  notifications: StoredNotification[];
  readNotificationIds: string[];
  badgeCount: number;
  addedNotifications: StoredNotification[];
} {
  const readSet = new Set(readNotificationIds);
  const unreadExistingNotifications = pruneReadNotifications(existingNotifications, readNotificationIds).notifications;
  const existingNotificationsById = new Map(
    unreadExistingNotifications.map((notification) => [notification.id, notification]),
  );
  const addedNotifications: StoredNotification[] = [];

  for (const notification of detectedNotifications) {
    if (readSet.has(notification.id)) {
      continue;
    }

    const existingNotification = existingNotificationsById.get(notification.id);
    if (existingNotification) {
      const mergedNotification = mergeStoredNotifications(existingNotification, notification);
      existingNotificationsById.set(mergedNotification.id, mergedNotification);

      if (hasNotificationKindsChanged(existingNotification, mergedNotification)) {
        addedNotifications.push(mergedNotification);
      }

      continue;
    }

    existingNotificationsById.set(notification.id, notification);
    addedNotifications.push(notification);
  }

  const mergedNotifications = Array.from(existingNotificationsById.values());

  return {
    ...pruneReadNotifications(mergedNotifications, []),
    addedNotifications,
  };
}
