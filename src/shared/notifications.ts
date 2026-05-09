export type NotificationKind = 'new' | 'mention' | 'thread' | 'assignee';

export type StoredNotification = {
  id: string;
  kind: NotificationKind;
  isPullRequest: boolean;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  detectedAt: string;
};

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
  const readSet = new Set(readNotificationIds);
  return notifications.filter((notification) => !readSet.has(notification.id)).length;
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
export function toggleNotificationRead(
  readNotificationIds: string[],
  notificationId: string,
): string[] {
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
  const unreadExistingNotifications = pruneReadNotifications(
    existingNotifications,
    readNotificationIds,
  ).notifications;
  const existingIds = new Set(unreadExistingNotifications.map((notification) => notification.id));
  const addedNotifications: StoredNotification[] = [];

  for (const notification of detectedNotifications) {
    if (readSet.has(notification.id) || existingIds.has(notification.id)) {
      continue;
    }

    unreadExistingNotifications.push(notification);
    existingIds.add(notification.id);
    addedNotifications.push(notification);
  }

  return {
    ...pruneReadNotifications(unreadExistingNotifications, []),
    addedNotifications,
  };
}
