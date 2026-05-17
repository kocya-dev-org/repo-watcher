export type NotificationKind = 'new' | 'updated' | 'mention' | 'thread' | 'assignee';

const NOTIFICATION_KIND_ORDER: NotificationKind[] = [
  'new',
  'updated',
  'mention',
  'thread',
  'assignee',
];

export type StoredNotification = {
  id: string;
  kinds?: NotificationKind[];
  sourceNodeId?: string;
  isPullRequest: boolean;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  detectedAt: string;
  isPresentInLatestResult?: boolean;
};

/**
 * 旧形式の通知 ID から通知種別を復元する。
 * @param notificationId 通知 ID
 * @returns 旧形式から復元した通知種別。判定できない場合は null
 */
function getLegacyNotificationKind(notificationId: string): NotificationKind | null {
  const separatorIndex = notificationId.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const kind = notificationId.slice(0, separatorIndex);
  return NOTIFICATION_KIND_ORDER.includes(kind as NotificationKind)
    ? (kind as NotificationKind)
    : null;
}

/**
 * 保存済み通知から kind 一覧を正規化して返す。
 * @param notification 通知データ
 * @returns 重複を除いた通知種別一覧
 */
export function getNotificationKinds(notification: StoredNotification): NotificationKind[] {
  const mergedKinds = new Set<NotificationKind>(
    [
      ...(Array.isArray(notification.kinds) ? notification.kinds : []),
      ...(getLegacyNotificationKind(notification.id)
        ? [getLegacyNotificationKind(notification.id) as NotificationKind]
        : []),
    ].filter((kind): kind is NotificationKind => NOTIFICATION_KIND_ORDER.includes(kind)),
  );

  return NOTIFICATION_KIND_ORDER.filter((kind) => mergedKinds.has(kind));
}

/**
 * 通知 ID を item 単位の canonical な ID に正規化する。
 * @param notificationId 通知 ID
 * @returns 正規化後の通知 ID
 */
export function normalizeNotificationId(notificationId: string): string {
  const separatorIndex = notificationId.indexOf(':');
  if (separatorIndex < 0 || separatorIndex === notificationId.length - 1) {
    return notificationId;
  }

  return notificationId.slice(separatorIndex + 1);
}

/**
 * 保存済み通知を現在の storage 形式へ正規化する。
 * @param notification 通知データ
 * @returns 正規化済み通知データ
 */
export function normalizeStoredNotification(notification: StoredNotification): StoredNotification {
  const normalizedId =
    (typeof notification.sourceNodeId === 'string' && notification.sourceNodeId.length > 0
      ? notification.sourceNodeId
      : normalizeNotificationId(notification.id)) || notification.id;
  const kinds = getNotificationKinds(notification);

  return {
    ...notification,
    id: normalizedId,
    kinds,
    sourceNodeId: normalizedId,
  };
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
  const normalizedCurrent = normalizeStoredNotification(current);
  const normalizedIncoming = normalizeStoredNotification(incoming);
  const mergedKinds = NOTIFICATION_KIND_ORDER.filter((kind) =>
    [
      ...getNotificationKinds(normalizedCurrent),
      ...getNotificationKinds(normalizedIncoming),
    ].includes(kind),
  );

  return {
    ...normalizedCurrent,
    ...normalizedIncoming,
    id: normalizedCurrent.id,
    sourceNodeId: normalizedCurrent.sourceNodeId,
    kinds: mergedKinds,
    detectedAt:
      new Date(normalizedIncoming.detectedAt).getTime() >=
      new Date(normalizedCurrent.detectedAt).getTime()
        ? normalizedIncoming.detectedAt
        : normalizedCurrent.detectedAt,
    isPresentInLatestResult:
      normalizedIncoming.isPresentInLatestResult ?? normalizedCurrent.isPresentInLatestResult,
  };
}

/**
 * 通知が参照している Issue / Pull Request の node ID を返す。
 * @param notification 通知データ
 * @returns node ID。取得できない場合は null
 */
export function getStoredNotificationNodeId(notification: StoredNotification): string | null {
  if (typeof notification.sourceNodeId === 'string' && notification.sourceNodeId.length > 0) {
    return notification.sourceNodeId;
  }

  return notification.id.length > 0 ? normalizeNotificationId(notification.id) : null;
}

/**
 * 通知一覧と既読 ID から未読件数を数える。
 * @param notifications 通知一覧
 * @param readNotificationIds 既読通知 ID 一覧
 * @returns 未読件数
 */
export function calculateUnreadCount(
  notifications: StoredNotification[],
  readNotificationIds: string[],
): number {
  const normalizedNotifications = notifications.map(normalizeStoredNotification);
  const readSet = new Set(readNotificationIds.map(normalizeNotificationId));
  return normalizedNotifications.filter((notification) => !readSet.has(notification.id)).length;
}

/**
 * 指定した通知 ID を既読一覧へ追加する。
 * @param readNotificationIds 既読通知 ID 一覧
 * @param notificationId 追加する通知 ID
 * @returns 更新後の既読通知 ID 一覧
 */
export function markNotificationAsRead(
  readNotificationIds: string[],
  notificationId: string,
): string[] {
  const normalizedId = normalizeNotificationId(notificationId);
  const normalizedReadIds = readNotificationIds.map(normalizeNotificationId);

  if (normalizedReadIds.includes(normalizedId)) {
    return normalizedReadIds;
  }

  return [...normalizedReadIds, normalizedId];
}

/**
 * 指定した通知 ID の既読状態を反転する。
 * @param readNotificationIds 既読通知 ID 一覧
 * @param notificationId 切り替える通知 ID
 * @returns 更新後の既読通知 ID 一覧
 */
export function toggleNotificationRead(
  readNotificationIds: string[],
  notificationId: string,
): string[] {
  const normalizedId = normalizeNotificationId(notificationId);
  const normalizedReadIds = readNotificationIds.map(normalizeNotificationId);

  if (normalizedReadIds.includes(normalizedId)) {
    return normalizedReadIds.filter((id) => id !== normalizedId);
  }

  return [...normalizedReadIds, normalizedId];
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
  const normalizedNotifications = notifications.map(normalizeStoredNotification);
  const readSet = new Set(readNotificationIds.map(normalizeNotificationId));
  const unreadNotifications = normalizedNotifications.filter(
    (notification) => !readSet.has(notification.id),
  );

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
  const readSet = new Set(readNotificationIds.map(normalizeNotificationId));
  const unreadExistingNotifications = pruneReadNotifications(
    existingNotifications,
    readNotificationIds,
  ).notifications;
  const existingNotificationsById = new Map(
    unreadExistingNotifications.map((notification) => [notification.id, notification]),
  );
  const addedNotifications: StoredNotification[] = [];

  for (const notification of detectedNotifications) {
    const normalizedNotification = normalizeStoredNotification(notification);
    if (readSet.has(normalizedNotification.id)) {
      continue;
    }

    const existingNotification = existingNotificationsById.get(normalizedNotification.id);
    if (existingNotification) {
      const mergedNotification = mergeStoredNotifications(
        existingNotification,
        normalizedNotification,
      );
      existingNotificationsById.set(mergedNotification.id, mergedNotification);

      if (
        getNotificationKinds(mergedNotification).length !==
        getNotificationKinds(existingNotification).length
      ) {
        addedNotifications.push(mergedNotification);
      }

      continue;
    }

    existingNotificationsById.set(normalizedNotification.id, normalizedNotification);
    addedNotifications.push(normalizedNotification);
  }

  const mergedNotifications = Array.from(existingNotificationsById.values());

  return {
    ...pruneReadNotifications(mergedNotifications, []),
    addedNotifications,
  };
}
