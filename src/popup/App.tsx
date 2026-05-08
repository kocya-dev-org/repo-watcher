import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateUnreadCount,
  pruneReadNotifications,
  toggleNotificationRead,
  type NotificationKind,
  type StoredNotification,
} from '../shared/notifications';
import {
  REFRESH_WATCH_CYCLE_MESSAGE,
  type RefreshWatchCycleResponse,
} from '../shared/runtimeMessages';

type GroupedNotifications = {
  prs: StoredNotification[];
  issues: StoredNotification[];
};

type NotificationTab = 'pull_request' | 'issue';

type PopupSettings = {
  enableNewItems: boolean;
  enableMentions: boolean;
  enableMentionThreads: boolean;
  enableAssigneeComments: boolean;
};

type PopupLocalState = {
  notifications: StoredNotification[];
  readNotificationIds: string[];
};

/**
 * 通知一覧を PR と Issue に振り分け、検出日時の降順で整列する。
 * @param items 通知一覧
 * @returns PR と Issue に分割された通知一覧
 */
function groupByType(items: StoredNotification[]): GroupedNotifications {
  const prs: StoredNotification[] = [];
  const issues: StoredNotification[] = [];

  for (const n of items) {
    if (n.isPullRequest) {
      prs.push(n);
    } else {
      issues.push(n);
    }
  }

  const byDetectedDesc = (a: StoredNotification, b: StoredNotification) =>
    new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();

  prs.sort(byDetectedDesc);
  issues.sort(byDetectedDesc);

  return { prs, issues };
}

/**
 * 通知種別をポップアップ表示用の日本語ラベルに変換する。
 * @param kind 通知種別
 * @returns 日本語ラベル
 */
function formatKind(kind: NotificationKind): string {
  switch (kind) {
    case 'new':
      return '新規';
    case 'mention':
      return 'メンション';
    case 'thread':
      return 'スレッド';
    case 'assignee':
      return '担当';
    default:
      return kind;
  }
}

function loadPopupLocalState(): Promise<PopupLocalState> {
  return new Promise((resolve) => {
    chrome.storage.local.get({ notifications: [], readNotificationIds: [] }, (items) => {
      resolve({
        notifications: Array.isArray(items.notifications)
          ? (items.notifications as StoredNotification[])
          : [],
        readNotificationIds: Array.isArray(items.readNotificationIds)
          ? (items.readNotificationIds as string[])
          : [],
      });
    });
  });
}

function loadPopupSettings(): Promise<PopupSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        enableNewItems: true,
        enableMentions: true,
        enableMentionThreads: true,
        enableAssigneeComments: true,
      },
      (items) => {
        resolve({
          enableNewItems: Boolean(items.enableNewItems),
          enableMentions: Boolean(items.enableMentions),
          enableMentionThreads: Boolean(items.enableMentionThreads),
          enableAssigneeComments: Boolean(items.enableAssigneeComments),
        });
      },
    );
  });
}

function requestWatchCycleRefresh(): Promise<RefreshWatchCycleResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: REFRESH_WATCH_CYCLE_MESSAGE }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('background から応答がありませんでした。'));
        return;
      }

      resolve(response as RefreshWatchCycleResponse);
    });
  });
}

/**
 * ポップアップのルートコンポーネント。
 *
 * - local storage から通知一覧と既読 ID を読み込む
 * - sync storage から通知の有効/無効設定を読み込む
 * - クリックした通知を既読にする
 */
const App: React.FC = () => {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<PopupSettings | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<NotificationTab>('pull_request');
  const notificationsRef = useRef<StoredNotification[]>([]);
  const readIdsRef = useRef<Set<string>>(new Set());

  const manifestVersion = chrome.runtime.getManifest().version;

  const reloadPopupState = useCallback(async () => {
    const [localState, popupSettings] = await Promise.all([
      loadPopupLocalState(),
      loadPopupSettings(),
    ]);
    const finalizedLocalState = pruneReadNotifications(
      localState.notifications,
      localState.readNotificationIds,
    );

    if (
      finalizedLocalState.readNotificationIds.length !== localState.readNotificationIds.length ||
      finalizedLocalState.notifications.length !== localState.notifications.length
    ) {
      chrome.storage.local.set(finalizedLocalState);
      chrome.action.setBadgeText({
        text: finalizedLocalState.badgeCount > 0 ? String(finalizedLocalState.badgeCount) : '',
      });
    }

    notificationsRef.current = finalizedLocalState.notifications;
    readIdsRef.current = new Set(finalizedLocalState.readNotificationIds);
    setNotifications(finalizedLocalState.notifications);
    setReadIds(new Set(readIdsRef.current));
    setSettings(popupSettings);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (isActive) {
        void reloadPopupState();
      }
    });

    return () => {
      isActive = false;
    };
  }, [reloadPopupState]);

  useEffect(
    () => () => {
      const finalized = pruneReadNotifications(
        notificationsRef.current,
        Array.from(readIdsRef.current),
      );

      chrome.storage.local.set(finalized);
      chrome.action.setBadgeText({ text: finalized.badgeCount > 0 ? String(finalized.badgeCount) : '' });
    },
    [],
  );

  /**
   * 通知の既読/未読を切り替え、readNotificationIds とバッジを更新する。
   * @param id 切り替える通知 ID
   */
  const toggleReadAndUpdate = (id: string) => {
    const nextReadIds = toggleNotificationRead(Array.from(readIdsRef.current), id);
    const newBadgeCount = calculateUnreadCount(notificationsRef.current, nextReadIds);

    readIdsRef.current = new Set(nextReadIds);
    setReadIds(new Set(readIdsRef.current));

    chrome.storage.local.set(
      {
        readNotificationIds: nextReadIds,
        badgeCount: newBadgeCount,
      },
      () => {
        chrome.action.setBadgeText({ text: newBadgeCount > 0 ? String(newBadgeCount) : '' });
      },
    );
  };

  /**
   * 通知の情報表示欄をクリックした際に GitHub 上の該当 PR/Issue を新しいタブで開く。
   * @param n クリックされた通知
   */
  const handleOpen = (n: StoredNotification) => {
    if (n.url) {
      chrome.tabs.create({ url: n.url });
    }
  };

  /**
   * 通知種別ごとの ON/OFF 設定に基づき、
   * 該当の通知種別が表示対象かどうかを判定する。
   * @param kind 通知種別
   * @returns true: 表示する / false: 非表示にする
   */
  const isKindEnabled = (kind: NotificationKind): boolean => {
    if (!settings) return true;
    switch (kind) {
      case 'new':
        return settings.enableNewItems;
      case 'mention':
        return settings.enableMentions;
      case 'thread':
        return settings.enableMentionThreads;
      case 'assignee':
        return settings.enableAssigneeComments;
      default:
        return true;
    }
  };

  const visibleNotifications = notifications.filter((n) => isKindEnabled(n.kind));
  const { prs, issues } = groupByType(visibleNotifications);
  const activeNotifications = selectedTab === 'pull_request' ? prs : issues;

  const renderNotificationItem = (n: StoredNotification) => (
    <li
      key={n.id}
      style={{
        padding: '4px 0',
        borderBottom: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        onClick={() => toggleReadAndUpdate(n.id)}
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '1px solid #ccc',
          marginRight: 6,
          backgroundColor: readIds.has(n.id) ? '#fff' : '#2da44e',
          padding: 0,
          cursor: 'pointer',
          flexShrink: 0,
        }}
        title={readIds.has(n.id) ? '既読' : '未読'}
        aria-label={readIds.has(n.id) ? '既読' : '未読'}
      />
      <button
        type="button"
        onClick={() => handleOpen(n)}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          border: 'none',
          background: 'transparent',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '2px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: '#555',
            }}
          >
            {n.owner}/{n.repo} #{n.number}
          </span>
          <span
            style={{
              fontSize: '10px',
              color: '#fff',
              backgroundColor: '#0969da',
              borderRadius: '10px',
              padding: '1px 6px',
            }}
          >
            {formatKind(n.kind)}
          </span>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#24292f',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {n.title}
        </div>
      </button>
    </li>
  );

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
    setIsMenuOpen(false);
  };

  const handleRefresh = async () => {
    setRefreshError(null);
    setIsRefreshing(true);

    try {
      const response = await requestWatchCycleRefresh();
      if (!response.ok) {
        setRefreshError(response.errorMessage);
        return;
      }

      await reloadPopupState();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '更新に失敗しました。');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      style={{
        width: '360px',
        padding: '10px',
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: '12px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
          position: 'relative',
        }}
      >
        <h1 style={{ fontSize: '14px', margin: 0 }}>GitHub Notify</h1>
        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          style={{
            border: '1px solid #d0d7de',
            background: '#fff',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          メニュー
        </button>
        {isMenuOpen && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
              right: 0,
              width: '180px',
              backgroundColor: '#fff',
              border: '1px solid #d0d7de',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(140,149,159,0.2)',
              padding: '8px',
              zIndex: 10,
            }}
          >
            <button
              type="button"
              onClick={() => {
                void handleRefresh();
              }}
              disabled={isRefreshing}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                padding: '6px 4px',
                cursor: isRefreshing ? 'default' : 'pointer',
                fontSize: '12px',
                color: isRefreshing ? '#57606a' : '#24292f',
              }}
            >
              {isRefreshing ? '更新中...' : '更新'}
            </button>
            <button
              type="button"
              onClick={openOptions}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                padding: '6px 4px',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#24292f',
              }}
            >
              設定を開く
            </button>
            <div
              style={{
                marginTop: '6px',
                paddingTop: '6px',
                borderTop: '1px solid #d8dee4',
                fontSize: '11px',
                color: '#57606a',
              }}
            >
              バージョン: {manifestVersion}
            </div>
          </div>
        )}
      </header>

      {refreshError && (
        <p style={{ margin: '0 0 8px', color: '#d1242f' }}>{refreshError}</p>
      )}

      {isLoading ? (
        <p style={{ margin: 0 }}>読み込み中...</p>
      ) : visibleNotifications.length === 0 ? (
        <p style={{ margin: 0 }}>現在表示できる通知はありません。</p>
      ) : (
        <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
          <div
            role="tablist"
            aria-label="通知種別タブ"
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '10px',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedTab === 'pull_request'}
              onClick={() => setSelectedTab('pull_request')}
              style={{
                flex: 1,
                border: '1px solid #d0d7de',
                background: selectedTab === 'pull_request' ? '#0969da' : '#fff',
                color: selectedTab === 'pull_request' ? '#fff' : '#24292f',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Pull Request
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedTab === 'issue'}
              onClick={() => setSelectedTab('issue')}
              style={{
                flex: 1,
                border: '1px solid #d0d7de',
                background: selectedTab === 'issue' ? '#0969da' : '#fff',
                color: selectedTab === 'issue' ? '#fff' : '#24292f',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Issue
            </button>
          </div>

          {activeNotifications.length === 0 ? (
            <p style={{ margin: 0 }}>このタブに表示できる通知はありません。</p>
          ) : (
            <section>
              <h2
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  margin: '4px 0',
                  borderBottom: '1px solid #ddd',
                  paddingBottom: '2px',
                }}
              >
                {selectedTab === 'pull_request' ? 'Pull Request' : 'Issue'}
              </h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {activeNotifications.map(renderNotificationItem)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
