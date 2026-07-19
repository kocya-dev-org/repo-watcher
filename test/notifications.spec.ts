import { describe, expect, it } from 'vitest';

import {
  calculateUnreadCount,
  getNotificationKinds,
  markNotificationAsRead,
  mergeStoredNotifications,
  pruneReadNotifications,
  toggleNotificationRead,
  type NotificationKind,
  type StoredNotification,
} from '../src/shared/notifications';

function createStoredNotification(overrides: Partial<StoredNotification> = {}): StoredNotification {
  return {
    id: 'ISSUE_1',
    kinds: ['new'],
    sourceNodeId: 'ISSUE_1',
    isPullRequest: false,
    owner: 'octo',
    repo: 'repo',
    number: 1,
    title: 'Issue 1',
    url: 'https://github.com/octo/repo/issues/1',
    detectedAt: '2026-03-21T10:00:00.000Z',
    isPresentInLatestResult: true,
    ...overrides,
  };
}

describe('toggleNotificationRead', () => {
  it('未既読 ID を渡すと既読一覧へ追加する', () => {
    expect(toggleNotificationRead([], 'ISSUE_1')).toEqual(['ISSUE_1']);
    expect(toggleNotificationRead(['ISSUE_2'], 'ISSUE_1')).toEqual(['ISSUE_2', 'ISSUE_1']);
  });

  it('既読 ID を渡すと既読一覧から除去する', () => {
    expect(toggleNotificationRead(['ISSUE_1'], 'ISSUE_1')).toEqual([]);
    expect(toggleNotificationRead(['ISSUE_1', 'ISSUE_2'], 'ISSUE_1')).toEqual(['ISSUE_2']);
  });

  it('同じ ID を続けて渡すと状態が反転する', () => {
    const added = toggleNotificationRead([], 'ISSUE_1');
    const removed = toggleNotificationRead(added, 'ISSUE_1');

    expect(added).toEqual(['ISSUE_1']);
    expect(removed).toEqual([]);
  });
});

describe('pruneReadNotifications', () => {
  const notifications: StoredNotification[] = [
    createStoredNotification({ id: 'ISSUE_1' }),
    createStoredNotification({ id: 'ISSUE_2' }),
    createStoredNotification({ id: 'ISSUE_3' }),
  ];

  it('既読 ID に該当する通知を除外し readNotificationIds を空へリセットする', () => {
    const result = pruneReadNotifications(notifications, ['ISSUE_2']);

    expect(result.notifications.map((notification) => notification.id)).toEqual(['ISSUE_1', 'ISSUE_3']);
    expect(result.readNotificationIds).toEqual([]);
    expect(result.badgeCount).toBe(2);
  });

  it('badgeCount は未読件数と一致する', () => {
    const result = pruneReadNotifications(notifications, ['ISSUE_1', 'ISSUE_3']);

    expect(result.notifications.map((notification) => notification.id)).toEqual(['ISSUE_2']);
    expect(result.badgeCount).toBe(1);
  });

  it('空配列入力では空の結果と badgeCount 0 を返す', () => {
    const result = pruneReadNotifications([], []);

    expect(result.notifications).toEqual([]);
    expect(result.readNotificationIds).toEqual([]);
    expect(result.badgeCount).toBe(0);
  });

  it('全件既読では通知が全て除外され badgeCount 0 になる', () => {
    const result = pruneReadNotifications(notifications, ['ISSUE_1', 'ISSUE_2', 'ISSUE_3']);

    expect(result.notifications).toEqual([]);
    expect(result.badgeCount).toBe(0);
  });

  it('該当既読なしでは全件が残り badgeCount が総数と一致する', () => {
    const result = pruneReadNotifications(notifications, ['UNKNOWN_ID']);

    expect(result.notifications.map((notification) => notification.id)).toEqual(['ISSUE_1', 'ISSUE_2', 'ISSUE_3']);
    expect(result.badgeCount).toBe(3);
  });
});

describe('mergeStoredNotifications', () => {
  it('detectedAt は incoming >= current なら incoming を採用する', () => {
    const current = createStoredNotification({ detectedAt: '2026-03-21T10:00:00.000Z' });
    const incoming = createStoredNotification({ detectedAt: '2026-03-21T10:05:00.000Z' });

    expect(mergeStoredNotifications(current, incoming).detectedAt).toBe('2026-03-21T10:05:00.000Z');
  });

  it('detectedAt が同時刻の場合も incoming を採用する', () => {
    const current = createStoredNotification({ detectedAt: '2026-03-21T10:00:00.000Z' });
    const incoming = createStoredNotification({ detectedAt: '2026-03-21T10:00:00.000Z' });

    expect(mergeStoredNotifications(current, incoming).detectedAt).toBe(incoming.detectedAt);
  });

  it('detectedAt は incoming が古い場合は current を維持する', () => {
    const current = createStoredNotification({ detectedAt: '2026-03-21T10:05:00.000Z' });
    const incoming = createStoredNotification({ detectedAt: '2026-03-21T10:00:00.000Z' });

    expect(mergeStoredNotifications(current, incoming).detectedAt).toBe('2026-03-21T10:05:00.000Z');
  });

  it('isPresentInLatestResult は incoming ?? current で引き継がれる', () => {
    const current = createStoredNotification({ isPresentInLatestResult: true });
    const incomingUndefined = createStoredNotification({ isPresentInLatestResult: undefined });
    const incomingFalse = createStoredNotification({ isPresentInLatestResult: false });

    expect(mergeStoredNotifications(current, incomingUndefined).isPresentInLatestResult).toBe(true);
    expect(mergeStoredNotifications(current, incomingFalse).isPresentInLatestResult).toBe(false);
  });

  it('kinds は NOTIFICATION_KIND_ORDER 順にマージし重複を排除する', () => {
    const current = createStoredNotification({ kinds: ['mention', 'new'] });
    const incoming = createStoredNotification({ kinds: ['assignee', 'mention'] });

    expect(mergeStoredNotifications(current, incoming).kinds).toEqual(['new', 'mention', 'assignee']);
  });

  it('id と sourceNodeId は current 側で固定される', () => {
    const current = createStoredNotification({ id: 'CURRENT_ID', sourceNodeId: 'CURRENT_NODE' });
    const incoming = createStoredNotification({ id: 'INCOMING_ID', sourceNodeId: 'INCOMING_NODE' });

    const merged = mergeStoredNotifications(current, incoming);

    expect(merged.id).toBe('CURRENT_ID');
    expect(merged.sourceNodeId).toBe('CURRENT_NODE');
  });
});

describe('getNotificationKinds', () => {
  it('NOTIFICATION_KIND_ORDER に含まれない不正な kind を除去する', () => {
    const notification = createStoredNotification({
      kinds: ['new', 'invalid' as NotificationKind, 'mention'],
    });

    expect(getNotificationKinds(notification)).toEqual(['new', 'mention']);
  });

  it('kinds が undefined の場合は空配列を返す', () => {
    const notification = createStoredNotification({ kinds: undefined });

    expect(getNotificationKinds(notification)).toEqual([]);
  });
});

describe('calculateUnreadCount', () => {
  const notifications: StoredNotification[] = [
    createStoredNotification({ id: 'ISSUE_1' }),
    createStoredNotification({ id: 'ISSUE_2' }),
  ];

  it('空配列では 0 を返す', () => {
    expect(calculateUnreadCount([], [])).toBe(0);
    expect(calculateUnreadCount([], ['ISSUE_1'])).toBe(0);
  });

  it('全件既読では 0 を返す', () => {
    expect(calculateUnreadCount(notifications, ['ISSUE_1', 'ISSUE_2'])).toBe(0);
  });

  it('該当既読なしでは総数を返す', () => {
    expect(calculateUnreadCount(notifications, ['UNKNOWN_ID'])).toBe(2);
  });
});

describe('markNotificationAsRead', () => {
  it('未登録 ID を追加する', () => {
    expect(markNotificationAsRead([], 'ISSUE_1')).toEqual(['ISSUE_1']);
    expect(markNotificationAsRead(['ISSUE_1'], 'ISSUE_2')).toEqual(['ISSUE_1', 'ISSUE_2']);
  });

  it('既登録 ID の重複追加を抑止し同一参照を返す', () => {
    const readNotificationIds = ['ISSUE_1'];

    expect(markNotificationAsRead(readNotificationIds, 'ISSUE_1')).toBe(readNotificationIds);
  });
});
