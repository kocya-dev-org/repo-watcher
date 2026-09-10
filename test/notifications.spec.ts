import { describe, expect, it } from 'vitest';

import {
  calculateUnreadCount,
  filterNotificationsByIssueSettings,
  formatBadgeText,
  formatNotificationKindLabel,
  getNotificationKinds,
  markNotificationAsRead,
  mergeStoredNotifications,
  pruneReadNotifications,
  reconcileNotificationState,
  removeExpiredNotifications,
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

describe('filterNotificationsByIssueSettings', () => {
  const assignedIssue = createStoredNotification({ id: 'ISSUE_A', sourceNodeId: 'ISSUE_A', isViewerAssignee: true });
  const otherIssue = createStoredNotification({ id: 'ISSUE_B', sourceNodeId: 'ISSUE_B', isViewerAssignee: false });
  const legacyIssue = createStoredNotification({ id: 'ISSUE_C', sourceNodeId: 'ISSUE_C' });
  const pullRequest = createStoredNotification({
    id: 'PR_1',
    sourceNodeId: 'PR_1',
    isPullRequest: true,
    isDraft: true,
  });
  const all = [assignedIssue, otherIssue, legacyIssue, pullRequest];

  it('notifyIssues が ON で assignedOnly が OFF ならすべて残す', () => {
    expect(filterNotificationsByIssueSettings(all, true, false)).toEqual(all);
  });

  it('notifyIssues が OFF なら Issue をすべて除外し PR だけ残す', () => {
    expect(filterNotificationsByIssueSettings(all, false, false)).toEqual([pullRequest]);
    expect(filterNotificationsByIssueSettings(all, false, true)).toEqual([pullRequest]);
  });

  it('assignedOnly が ON なら viewer が assignee の Issue と PR だけ残す', () => {
    expect(filterNotificationsByIssueSettings(all, true, true)).toEqual([assignedIssue, pullRequest]);
  });
});

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

  it('isApproved は incoming の値をそのまま採用し承認取り消しを反映する', () => {
    const current = createStoredNotification({ isPullRequest: true, isApproved: true });
    const incoming = createStoredNotification({ isPullRequest: true, isApproved: false });

    expect(mergeStoredNotifications(current, incoming).isApproved).toBe(false);
  });

  it('isApproved は false から true への変化も反映する', () => {
    const current = createStoredNotification({ isPullRequest: true, isApproved: false });
    const incoming = createStoredNotification({ isPullRequest: true, isApproved: true });

    expect(mergeStoredNotifications(current, incoming).isApproved).toBe(true);
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

  it('commentCount は incoming の値を優先し、未定義なら current を保持する', () => {
    const current = createStoredNotification({ commentCount: 3 });
    const incoming = createStoredNotification({ commentCount: 9 });
    const incomingUndefined = createStoredNotification({ commentCount: undefined });

    expect(mergeStoredNotifications(current, incoming).commentCount).toBe(9);
    expect(mergeStoredNotifications(current, incomingUndefined).commentCount).toBe(3);
  });
});

describe('removeExpiredNotifications', () => {
  const now = new Date('2026-05-31T10:00:00.000Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it('保持日数を超えた通知だけを削除する', () => {
    const expired = createStoredNotification({ id: 'OLD', detectedAt: daysAgo(31) });
    const fresh = createStoredNotification({ id: 'FRESH', detectedAt: daysAgo(10) });

    expect(removeExpiredNotifications([expired, fresh], now, 30).map((notification) => notification.id)).toEqual([
      'FRESH',
    ]);
  });

  it('ちょうど保持日数に達した通知は削除しない', () => {
    const boundary = createStoredNotification({ id: 'BOUNDARY', detectedAt: daysAgo(30) });

    expect(removeExpiredNotifications([boundary], now, 30)).toEqual([boundary]);
  });

  it('retentionDays が 0 以下または NaN のときは何も削除しない', () => {
    const expired = createStoredNotification({ id: 'OLD', detectedAt: daysAgo(365) });

    expect(removeExpiredNotifications([expired], now, 0)).toEqual([expired]);
    expect(removeExpiredNotifications([expired], now, -5)).toEqual([expired]);
    expect(removeExpiredNotifications([expired], now, NaN)).toEqual([expired]);
  });

  it('detectedAt が不正な日付の通知は削除しない', () => {
    const invalid = createStoredNotification({ id: 'INVALID', detectedAt: 'not-a-date' });

    expect(removeExpiredNotifications([invalid], now, 30)).toEqual([invalid]);
  });

  it('空配列では空配列を返す', () => {
    expect(removeExpiredNotifications([], now, 30)).toEqual([]);
  });
});

describe('reconcileNotificationState の isApproved 反映', () => {
  it('再検知した PR の未承認→承認を isApproved へ反映する', () => {
    const existing = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: false,
    });
    const incoming = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: true,
      detectedAt: '2026-03-21T10:05:00.000Z',
    });

    const reconciled = reconcileNotificationState([existing], [], [incoming]);

    expect(reconciled.notifications[0]?.isApproved).toBe(true);
  });

  it('再検知した PR の承認→取り消しを isApproved へ反映する', () => {
    const existing = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: true,
    });
    const incoming = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: false,
      detectedAt: '2026-03-21T10:05:00.000Z',
    });

    const reconciled = reconcileNotificationState([existing], [], [incoming]);

    expect(reconciled.notifications[0]?.isApproved).toBe(false);
  });

  it('再検知した PR の承認→変更要求を isChangesRequested へ反映する', () => {
    const existing = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: true,
      isChangesRequested: false,
    });
    const incoming = createStoredNotification({
      id: 'PR_1',
      sourceNodeId: 'PR_1',
      isPullRequest: true,
      isApproved: false,
      isChangesRequested: true,
      detectedAt: '2026-03-21T10:05:00.000Z',
    });

    const reconciled = reconcileNotificationState([existing], [], [incoming]);

    expect(reconciled.notifications[0]?.isChangesRequested).toBe(true);
    expect(reconciled.notifications[0]?.isApproved).toBe(false);
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

describe('formatNotificationKindLabel', () => {
  it('各通知種別を i18n 翻訳キーへ変換する', () => {
    expect(formatNotificationKindLabel('new')).toBe('notificationKind.new');
    expect(formatNotificationKindLabel('updated')).toBe('notificationKind.updated');
    expect(formatNotificationKindLabel('mention')).toBe('notificationKind.mention');
    expect(formatNotificationKindLabel('thread')).toBe('notificationKind.thread');
    expect(formatNotificationKindLabel('assignee')).toBe('notificationKind.assignee');
  });

  it('未知の種別はそのままキーとして返す', () => {
    expect(formatNotificationKindLabel('unknown' as NotificationKind)).toBe('unknown');
  });
});

describe('formatBadgeText', () => {
  it('1 以上ならカウント文字列を返す', () => {
    expect(formatBadgeText(1)).toBe('1');
    expect(formatBadgeText(42)).toBe('42');
  });

  it('0 以下なら空文字を返す', () => {
    expect(formatBadgeText(0)).toBe('');
    expect(formatBadgeText(-1)).toBe('');
  });
});
