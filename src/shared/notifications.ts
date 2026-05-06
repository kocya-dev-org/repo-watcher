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

export function calculateUnreadCount(
  notifications: StoredNotification[],
  readNotificationIds: string[],
): number {
  const readSet = new Set(readNotificationIds);
  return notifications.filter((notification) => !readSet.has(notification.id)).length;
}

export function markNotificationAsRead(
  readNotificationIds: string[],
  notificationId: string,
): string[] {
  if (readNotificationIds.includes(notificationId)) {
    return readNotificationIds;
  }

  return [...readNotificationIds, notificationId];
}

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
  const unreadExistingNotifications = existingNotifications.filter(
    (notification) => !readSet.has(notification.id),
  );
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
    notifications: unreadExistingNotifications,
    readNotificationIds: [],
    badgeCount: unreadExistingNotifications.length,
    addedNotifications,
  };
}
