import React, { useCallback, useEffect, useRef, useState } from 'react';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox';
import MenuIcon from '@mui/icons-material/Menu';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import {
  calculateUnreadCount,
  getNotificationKinds,
  pruneReadNotifications,
  toggleNotificationRead,
  type NotificationKind,
  type StoredNotification,
} from '../shared/notifications';
import {
  REFRESH_WATCH_CYCLE_MESSAGE,
  type RefreshWatchCycleResponse,
} from '../shared/runtimeMessages';
import { DEFAULT_REPO_COLOR, type WatchTargetRepo } from '../shared/repositories';

type GroupedNotifications = {
  prs: StoredNotification[];
  issues: StoredNotification[];
};

type NotificationTab = 'pull_request' | 'issue';

type PopupSettings = {
  repos: WatchTargetRepo[];
  isWatchPaused: boolean;
};

type PopupLocalState = {
  notifications: StoredNotification[];
  readNotificationIds: string[];
};

type NotificationRepositoryOption = {
  value: string;
  label: string;
};

type BulkReadState = 'all_read' | 'all_unread' | 'partial';

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
    case 'updated':
      return '更新';
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

/**
 * 通知種別一覧をポップアップ表示用の日本語ラベル配列に変換する。
 * @param notification 通知データ
 * @returns 日本語ラベル一覧
 */
function formatKinds(notification: StoredNotification): string[] {
  return getNotificationKinds(notification).map((kind) => formatKind(kind));
}

/**
 * 通知に対応するリポジトリ識別子を返す。
 * @param notification 通知データ
 * @returns owner/repo 形式の識別子
 */
function getNotificationRepositoryValue(notification: StoredNotification): string {
  return `${notification.owner}/${notification.repo}`;
}

/**
 * 設定済みリポジトリ一覧から `owner/repo` をキーとする表示色マップを生成する。
 * @param repos 設定済みリポジトリ一覧
 * @returns `owner/repo` から表示色 (HEX) への対応表
 */
function buildRepositoryColorMap(repos: WatchTargetRepo[]): Map<string, string> {
  const colorMap = new Map<string, string>();

  for (const repo of repos) {
    if (
      repo &&
      typeof repo.owner === 'string' &&
      repo.owner.length > 0 &&
      typeof repo.name === 'string' &&
      repo.name.length > 0 &&
      typeof repo.color === 'string' &&
      repo.color.length > 0
    ) {
      colorMap.set(`${repo.owner}/${repo.name}`, repo.color);
    }
  }

  return colorMap;
}

/**
 * 通知に対応するリポジトリの表示色を返す。
 * @param notification 通知データ
 * @param colorMap `owner/repo` から表示色への対応表
 * @returns 該当リポジトリの表示色。未設定時はデフォルト色
 */
function getNotificationColor(
  notification: StoredNotification,
  colorMap: Map<string, string>,
): string {
  return colorMap.get(getNotificationRepositoryValue(notification)) ?? DEFAULT_REPO_COLOR;
}

/**
 * 設定済みリポジトリ一覧からリポジトリ選択肢を生成する。
 * @param repos 設定済みリポジトリ一覧
 * @returns Select 表示用のリポジトリ選択肢
 */
function listRepositoryOptions(repos: WatchTargetRepo[]): NotificationRepositoryOption[] {
  const repositoryValues = new Set(
    repos
      .filter(
        (repo) =>
          repo &&
          typeof repo.owner === 'string' &&
          repo.owner.length > 0 &&
          typeof repo.name === 'string' &&
          repo.name.length > 0,
      )
      .map((repo) => `${repo.owner}/${repo.name}`),
  );

  return Array.from(repositoryValues)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      value,
      label: value,
    }));
}

/**
 * 選択されたリポジトリだけに通知一覧を絞り込む。
 * @param items 通知一覧
 * @param selectedRepositoryValues 選択中のリポジトリ識別子
 * @returns 絞り込み後の通知一覧
 */
function filterNotificationsByRepositories(
  items: StoredNotification[],
  selectedRepositoryValues: string[],
): StoredNotification[] {
  if (selectedRepositoryValues.length === 0) {
    return items;
  }

  const selectedSet = new Set(selectedRepositoryValues);
  return items.filter((item) => selectedSet.has(getNotificationRepositoryValue(item)));
}

/**
 * 現在表示中の一覧全体が既読か未読かを集計する。
 * @param items 表示中の通知一覧
 * @param readIds 既読通知 ID 一覧
 * @returns 一覧全体の既読状態
 */
function getBulkReadState(items: StoredNotification[], readIds: Set<string>): BulkReadState {
  if (items.length === 0) {
    return 'all_unread';
  }

  const readCount = items.filter((item) => readIds.has(item.id)).length;

  if (readCount === 0) {
    return 'all_unread';
  }

  if (readCount === items.length) {
    return 'all_read';
  }

  return 'partial';
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
        repos: [],
        isWatchPaused: false,
      },
      (items) => {
        const repos = Array.isArray(items.repos)
          ? (items.repos as WatchTargetRepo[]).filter(
              (repo) =>
                repo &&
                typeof repo.owner === 'string' &&
                repo.owner.length > 0 &&
                typeof repo.name === 'string' &&
                repo.name.length > 0,
            )
          : [];

        resolve({
          repos,
          isWatchPaused: Boolean(items.isWatchPaused),
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
 * - sync storage からリポジトリ設定と一時停止状態を読み込む
 * - クリックした通知を既読にする
 */
const App: React.FC = () => {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<PopupSettings | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRepositoryMenuOpen, setIsRepositoryMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<NotificationTab>('pull_request');
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
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

    const availableRepositoryValues = new Set(
      listRepositoryOptions(popupSettings.repos).map((option) => option.value),
    );

    notificationsRef.current = finalizedLocalState.notifications;
    readIdsRef.current = new Set(finalizedLocalState.readNotificationIds);
    setNotifications(finalizedLocalState.notifications);
    setReadIds(new Set(readIdsRef.current));
    setSettings(popupSettings);
    setSelectedRepositories((current) =>
      current.filter((value) => availableRepositoryValues.has(value)),
    );
    if (availableRepositoryValues.size === 0) {
      setIsRepositoryMenuOpen(false);
    }
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
      chrome.action.setBadgeText({
        text: finalized.badgeCount > 0 ? String(finalized.badgeCount) : '',
      });
    },
    [],
  );

  /**
   * 既読 ID 一覧を state / storage / badge に反映する。
   * @param nextReadIds 更新後の既読通知 ID 一覧
   */
  const applyReadIds = (nextReadIds: string[]) => {
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
   * 通知の既読/未読を切り替え、readNotificationIds とバッジを更新する。
   * @param id 切り替える通知 ID
   */
  const toggleReadAndUpdate = (id: string) => {
    const nextReadIds = toggleNotificationRead(Array.from(readIdsRef.current), id);
    applyReadIds(nextReadIds);
  };

  const repositoryOptions = settings ? listRepositoryOptions(settings.repos) : [];
  const repositoryColorMap = settings
    ? buildRepositoryColorMap(settings.repos)
    : new Map<string, string>();
  const filteredNotifications = filterNotificationsByRepositories(
    notifications,
    selectedRepositories,
  );
  const { prs, issues } = groupByType(filteredNotifications);
  const activeNotifications = selectedTab === 'pull_request' ? prs : issues;
  const bulkReadState = getBulkReadState(activeNotifications, readIds);

  const renderNotificationItem = (n: StoredNotification) => {
    const isMissingFromLatestResult = n.isPresentInLatestResult === false;
    const repositoryColor = getNotificationColor(n, repositoryColorMap);

    return (
      <li
        key={n.id}
        aria-label={`リポジトリ色:${repositoryColor}`}
        style={{
          padding: '6px 8px 6px 5px',
          borderLeft: `3px solid ${repositoryColor}`,
          borderBottom: '1px solid #eee',
          display: 'flex',
          alignItems: 'center',
          backgroundColor: isMissingFromLatestResult ? '#f6f8fa' : 'transparent',
          borderRadius: '6px',
        }}
      >
        <IconButton
          onClick={() => toggleReadAndUpdate(n.id)}
          size="small"
          sx={{
            marginRight: '6px',
            padding: 0,
            color: readIds.has(n.id) ? '#57606a' : '#2da44e',
            flexShrink: 0,
          }}
          title={readIds.has(n.id) ? '既読' : '未読'}
          aria-label={readIds.has(n.id) ? '既読' : '未読'}
        >
          {readIds.has(n.id) ? (
            <CheckBoxIcon fontSize="small" />
          ) : (
            <CheckBoxOutlineBlankIcon fontSize="small" />
          )}
        </IconButton>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: '2px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                color: isMissingFromLatestResult ? '#6e7781' : '#555',
              }}
            >
              {n.owner}/{n.repo} #{n.number}
            </span>
            <span
              style={{
                display: 'flex',
                gap: '4px',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {formatKinds(n).map((label) => (
                <span
                  key={`${n.id}:${label}`}
                  style={{
                    fontSize: '10px',
                    color: '#fff',
                    backgroundColor: '#0969da',
                    borderRadius: '10px',
                    padding: '1px 6px',
                  }}
                >
                  {label}
                </span>
              ))}
            </span>
          </div>
          <div
            style={{
              fontSize: '12px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: isMissingFromLatestResult ? '#57606a' : '#0969da',
                textDecoration: 'underline',
              }}
            >
              {n.title}
            </a>
          </div>
        </div>
      </li>
    );
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
    setIsMenuOpen(false);
    setIsRepositoryMenuOpen(false);
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

  const handleTabChange = (_event: React.SyntheticEvent, nextTab: string) => {
    if (nextTab === 'pull_request' || nextTab === 'issue') {
      setSelectedTab(nextTab);
    }
  };

  /**
   * リポジトリ選択状態を反転する。
   * @param repositoryValue owner/repo 形式の識別子
   */
  const toggleRepositorySelection = (repositoryValue: string) => {
    setSelectedRepositories((current) =>
      current.includes(repositoryValue)
        ? current.filter((value) => value !== repositoryValue)
        : [...current, repositoryValue],
    );
  };

  /**
   * 現在表示している一覧を一括で既読または未読へ切り替える。
   */
  const toggleBulkReadState = () => {
    const nextReadIds = new Set(readIdsRef.current);

    if (bulkReadState === 'all_read') {
      for (const notification of activeNotifications) {
        nextReadIds.delete(notification.id);
      }
    } else {
      for (const notification of activeNotifications) {
        nextReadIds.add(notification.id);
      }
    }

    applyReadIds(Array.from(nextReadIds));
  };

  const bulkReadButtonLabel =
    bulkReadState === 'all_read'
      ? 'Mark all as unread'
      : bulkReadState === 'partial'
        ? 'Mark visible list as read'
        : 'Mark all as read';
  const watchPauseButtonLabel = settings?.isWatchPaused
    ? 'Resume scheduled watch'
    : 'Pause scheduled watch';
  const refreshButtonLabel = isRefreshing ? 'Updating...' : 'Update';

  /**
   * 定期監視の一時停止状態を反転して保存する。
   */
  const toggleScheduledWatchPause = () => {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      const nextIsWatchPaused = !current.isWatchPaused;
      chrome.storage.sync.set({ isWatchPaused: nextIsWatchPaused });
      return {
        ...current,
        isWatchPaused: nextIsWatchPaused,
      };
    });
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconButton
            aria-label={watchPauseButtonLabel}
            title={watchPauseButtonLabel}
            onClick={toggleScheduledWatchPause}
            size="small"
            disabled={!settings}
            sx={{
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              color: settings?.isWatchPaused ? '#1a7f37' : '#24292f',
              padding: '4px',
            }}
          >
            {settings?.isWatchPaused ? (
              <PlayArrowIcon fontSize="small" />
            ) : (
              <PauseIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton
            aria-label={refreshButtonLabel}
            title={refreshButtonLabel}
            onClick={() => {
              void handleRefresh();
            }}
            size="small"
            disabled={isRefreshing}
            sx={{
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              color: '#24292f',
              padding: '4px',
            }}
          >
            <RefreshIcon
              fontSize="small"
              sx={
                isRefreshing
                  ? {
                      animation: 'spin 1s linear infinite',
                      '@keyframes spin': {
                        from: { transform: 'rotate(0deg)' },
                        to: { transform: 'rotate(360deg)' },
                      },
                    }
                  : undefined
              }
            />
          </IconButton>
          <IconButton
            aria-label={bulkReadButtonLabel}
            title={bulkReadButtonLabel}
            onClick={toggleBulkReadState}
            size="small"
            disabled={activeNotifications.length === 0}
            sx={{
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              color: '#24292f',
              padding: '4px',
            }}
          >
            {bulkReadState === 'all_read' ? (
              <CheckBoxIcon fontSize="small" />
            ) : bulkReadState === 'partial' ? (
              <IndeterminateCheckBoxIcon fontSize="small" />
            ) : (
              <CheckBoxOutlineBlankIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton
            aria-label="Menu"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            size="small"
            sx={{
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              color: '#24292f',
              padding: '4px',
            }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        </div>
        {isMenuOpen && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
              right: 0,
              width: '300px',
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
              onClick={() => setIsRepositoryMenuOpen((current) => !current)}
              aria-label="Repository"
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                padding: '6px 4px',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#24292f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Repository</span>
              <span style={{ fontSize: '10px', color: '#57606a' }}>
                {isRepositoryMenuOpen ? '▲' : '▼'}
              </span>
            </button>
            {isRepositoryMenuOpen && (
              <div
                style={{
                  marginTop: '2px',
                  marginBottom: '4px',
                  marginLeft: '8px',
                  paddingLeft: '8px',
                  borderLeft: '1px solid #d8dee4',
                }}
              >
                {repositoryOptions.length === 0 ? (
                  <div style={{ padding: '6px 4px', fontSize: '11px', color: '#57606a' }}>
                    No configured repositories
                  </div>
                ) : (
                  repositoryOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleRepositorySelection(option.value)}
                      aria-label={`Repository:${option.value}`}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: 'transparent',
                        padding: '3px 4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        color: '#24292f',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        minHeight: '24px',
                      }}
                    >
                      <Checkbox
                        checked={selectedRepositories.includes(option.value)}
                        size="small"
                        sx={{
                          padding: 0,
                          marginRight: '2px',
                        }}
                      />
                      <span>{option.label}</span>
                    </button>
                  ))
                )}
              </div>
            )}
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
              Open Settings
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
              Version: {manifestVersion}
            </div>
          </div>
        )}
      </header>

      {refreshError && <p style={{ margin: '0 0 8px', color: '#d1242f' }}>{refreshError}</p>}

      {isLoading ? (
        <p style={{ margin: 0 }}>Loading...</p>
      ) : notifications.length === 0 ? (
        <p style={{ margin: 0 }}>No notifications available.</p>
      ) : (
        <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
          <Box sx={{ mb: 1.25, borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={selectedTab}
              onChange={handleTabChange}
              aria-label="Notification Type Tabs"
              variant="fullWidth"
              sx={{
                minHeight: 0,
                '& .MuiTabs-indicator': {
                  backgroundColor: '#0969da',
                  height: 3,
                },
              }}
            >
              <Tab
                label="Pull Request"
                value="pull_request"
                sx={{
                  minHeight: 0,
                  py: 0.75,
                  px: 1,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'none',
                }}
              />
              <Tab
                label="Issue"
                value="issue"
                sx={{
                  minHeight: 0,
                  py: 0.75,
                  px: 1,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'none',
                }}
              />
            </Tabs>
          </Box>

          {activeNotifications.length === 0 ? (
            <p style={{ margin: 0 }}>No notifications available for this tab.</p>
          ) : (
            <section>
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
