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
  filterNotificationsByDraftSetting,
  formatBadgeText,
  pruneReadNotifications,
  toggleNotificationRead,
  type StoredNotification,
} from '../shared/notifications';
import { REFRESH_WATCH_CYCLE_MESSAGE, type RefreshWatchCycleResponse } from '../shared/runtimeMessages';
import { DEFAULT_REPO_COLOR, isValidRepo, type WatchTargetRepo } from '../shared/repositories';
import { COLORS } from '../shared/colors';
import NotificationItem from './NotificationItem';

type GroupedNotifications = {
  prs: StoredNotification[];
  issues: StoredNotification[];
};

type NotificationTab = 'pull_request' | 'issue';

type PopupSettings = {
  repos: WatchTargetRepo[];
  isWatchPaused: boolean;
  notifyDraftPr: boolean;
};

type PopupLocalState = {
  notifications: StoredNotification[];
  readNotificationIds: string[];
};

type NotificationRepositoryOption = {
  value: string;
  label: string;
};

type NotificationRepositoryGroup = {
  value: string;
  notifications: StoredNotification[];
};

type BulkReadState = 'all_read' | 'all_unread' | 'partial';

/** ヘッダーの枠付きアイコンボタン共通 sx */
const headerIconButtonSx = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: '6px',
  color: COLORS.fgDefault,
  padding: '4px',
};

/** メニュー内のテキストボタン共通スタイル (padding などは呼び出し側で追加する) */
const menuButtonBaseStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: '12px',
  color: COLORS.fgDefault,
};

const menuPopoverStyle = `
  #menu-popover {
    position-anchor: --menu-anchor;
    inset: auto;
    top: anchor(bottom);
    right: anchor(right);
    margin: 0;
  }

  .menu-anchor-button {
    anchor-name: --menu-anchor;
  }
`;

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
 * 通知に対応するリポジトリ識別子を返す。
 * @param notification 通知データ
 * @returns owner/repo 形式の識別子
 */
function getNotificationRepositoryValue(notification: StoredNotification): string {
  return `${notification.owner}/${notification.repo}`;
}

/**
 * 通知一覧をリポジトリごとにまとめ、リポジトリ名順に整列する。
 * @param items 検出日時降順に整列済みの通知一覧
 * @returns リポジトリごとの通知グループ
 */
function groupByRepository(items: StoredNotification[]): NotificationRepositoryGroup[] {
  const groups = new Map<string, StoredNotification[]>();

  for (const item of items) {
    const repositoryValue = getNotificationRepositoryValue(item);
    const group = groups.get(repositoryValue);
    if (group) {
      group.push(item);
    } else {
      groups.set(repositoryValue, [item]);
    }
  }

  return Array.from(groups, ([value, notifications]) => ({ value, notifications })).sort((left, right) =>
    left.value.localeCompare(right.value),
  );
}

/**
 * 設定済みリポジトリ一覧から `owner/repo` をキーとする表示色マップを生成する。
 * @param repos 設定済みリポジトリ一覧
 * @returns `owner/repo` から表示色 (HEX) への対応表
 */
function buildRepositoryColorMap(repos: WatchTargetRepo[]): Map<string, string> {
  const colorMap = new Map<string, string>();

  for (const repo of repos) {
    if (isValidRepo(repo) && typeof repo.color === 'string' && repo.color.length > 0) {
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
function getNotificationColor(notification: StoredNotification, colorMap: Map<string, string>): string {
  return colorMap.get(getNotificationRepositoryValue(notification)) ?? DEFAULT_REPO_COLOR;
}

/**
 * 設定済みリポジトリ一覧からリポジトリ選択肢を生成する。
 * @param repos 設定済みリポジトリ一覧
 * @returns Select 表示用のリポジトリ選択肢
 */
function listRepositoryOptions(repos: WatchTargetRepo[]): NotificationRepositoryOption[] {
  const repositoryValues = new Set(repos.filter(isValidRepo).map((repo) => `${repo.owner}/${repo.name}`));

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
        notifications: Array.isArray(items.notifications) ? (items.notifications as StoredNotification[]) : [],
        readNotificationIds: Array.isArray(items.readNotificationIds) ? (items.readNotificationIds as string[]) : [],
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
        notifyDraftPr: true,
      },
      (items) => {
        const repos = Array.isArray(items.repos) ? items.repos.filter(isValidRepo) : [];

        resolve({
          repos,
          isWatchPaused: Boolean(items.isWatchPaused),
          notifyDraftPr: items.notifyDraftPr === undefined ? true : Boolean(items.notifyDraftPr),
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
  const [isRepositoryMenuOpen, setIsRepositoryMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<NotificationTab>('pull_request');
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
  const [collapsedRepositories, setCollapsedRepositories] = useState<Set<string>>(new Set());
  const notificationsRef = useRef<StoredNotification[]>([]);
  const readIdsRef = useRef<Set<string>>(new Set());
  const notifyDraftPrRef = useRef(true);
  const menuPopoverRef = useRef<HTMLDivElement>(null);

  const manifestVersion = chrome.runtime.getManifest().version;

  useEffect(() => {
    const menuPopover = menuPopoverRef.current;
    if (!menuPopover) {
      return;
    }

    const handlePopoverToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') {
        setIsRepositoryMenuOpen(false);
      }
    };

    menuPopover.addEventListener('toggle', handlePopoverToggle);
    return () => {
      menuPopover.removeEventListener('toggle', handlePopoverToggle);
    };
  }, []);

  const reloadPopupState = useCallback(async () => {
    const [localState, popupSettings] = await Promise.all([loadPopupLocalState(), loadPopupSettings()]);
    notifyDraftPrRef.current = popupSettings.notifyDraftPr;
    const finalizedLocalState = pruneReadNotifications(localState.notifications, localState.readNotificationIds);
    const badgeNotifications = filterNotificationsByDraftSetting(
      finalizedLocalState.notifications,
      popupSettings.notifyDraftPr,
    );
    const badgeCount = calculateUnreadCount(badgeNotifications, finalizedLocalState.readNotificationIds);

    if (
      finalizedLocalState.readNotificationIds.length !== localState.readNotificationIds.length ||
      finalizedLocalState.notifications.length !== localState.notifications.length
    ) {
      chrome.storage.local.set({ ...finalizedLocalState, badgeCount });
      chrome.action.setBadgeText({ text: formatBadgeText(badgeCount) });
    } else if (finalizedLocalState.badgeCount !== badgeCount) {
      chrome.storage.local.set({ badgeCount });
      chrome.action.setBadgeText({ text: formatBadgeText(badgeCount) });
    }

    const availableRepositoryValues = new Set(listRepositoryOptions(popupSettings.repos).map((option) => option.value));

    notificationsRef.current = finalizedLocalState.notifications;
    readIdsRef.current = new Set(finalizedLocalState.readNotificationIds);
    setNotifications(finalizedLocalState.notifications);
    setReadIds(new Set(readIdsRef.current));
    setSettings(popupSettings);
    setSelectedRepositories((current) => current.filter((value) => availableRepositoryValues.has(value)));
    if (availableRepositoryValues.size === 0) {
      setIsRepositoryMenuOpen(false);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleStorageChanged = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'sync') {
        void reloadPopupState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChanged);
    return () => {
      chrome.storage.onChanged.removeListener?.(handleStorageChanged);
    };
  }, [reloadPopupState]);

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
      const finalized = pruneReadNotifications(notificationsRef.current, Array.from(readIdsRef.current));
      const badgeNotifications = filterNotificationsByDraftSetting(finalized.notifications, notifyDraftPrRef.current);
      const badgeCount = calculateUnreadCount(badgeNotifications, finalized.readNotificationIds);

      chrome.storage.local.set({ ...finalized, badgeCount });
      chrome.action.setBadgeText({ text: formatBadgeText(badgeCount) });
    },
    [],
  );

  /**
   * 既読 ID 一覧を state / storage / badge に反映する。
   * @param nextReadIds 更新後の既読通知 ID 一覧
   */
  const applyReadIds = (nextReadIds: string[]) => {
    const badgeNotifications = filterNotificationsByDraftSetting(notificationsRef.current, notifyDraftPrRef.current);
    const newBadgeCount = calculateUnreadCount(badgeNotifications, nextReadIds);

    readIdsRef.current = new Set(nextReadIds);
    setReadIds(new Set(readIdsRef.current));

    chrome.storage.local.set(
      {
        readNotificationIds: nextReadIds,
        badgeCount: newBadgeCount,
      },
      () => {
        chrome.action.setBadgeText({ text: formatBadgeText(newBadgeCount) });
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
  const repositoryColorMap = settings ? buildRepositoryColorMap(settings.repos) : new Map<string, string>();
  const draftFilteredNotifications = filterNotificationsByDraftSetting(notifications, settings?.notifyDraftPr ?? true);
  const filteredNotifications = filterNotificationsByRepositories(draftFilteredNotifications, selectedRepositories);
  const { prs, issues } = groupByType(filteredNotifications);
  const activeNotifications = selectedTab === 'pull_request' ? prs : issues;
  const notificationGroups = groupByRepository(activeNotifications);
  const bulkReadState = getBulkReadState(activeNotifications, readIds);
  const isRepositoryExpanded = (repositoryValue: string) => !collapsedRepositories.has(repositoryValue);

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
    document.getElementById('menu-popover')?.hidePopover();
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
  const watchPauseButtonLabel = settings?.isWatchPaused ? 'Resume scheduled watch' : 'Pause scheduled watch';
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
        width: '440px',
        minHeight: '360px',
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
        <h1 style={{ fontSize: '14px', margin: 0 }}>GH Centry</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconButton
            aria-label={watchPauseButtonLabel}
            title={watchPauseButtonLabel}
            onClick={toggleScheduledWatchPause}
            size="small"
            disabled={!settings}
            sx={{ ...headerIconButtonSx, color: settings?.isWatchPaused ? COLORS.success : COLORS.fgDefault }}
          >
            {settings?.isWatchPaused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
          </IconButton>
          <IconButton
            aria-label={refreshButtonLabel}
            title={refreshButtonLabel}
            onClick={() => {
              void handleRefresh();
            }}
            size="small"
            disabled={isRefreshing}
            sx={headerIconButtonSx}
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
            sx={headerIconButtonSx}
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
            popoverTarget="menu-popover"
            size="small"
            sx={headerIconButtonSx}
            className="menu-anchor-button"
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        </div>
        <style>{menuPopoverStyle}</style>
        <div
          ref={menuPopoverRef}
          id="menu-popover"
          popover="auto"
          style={{
            width: '320px',
            backgroundColor: COLORS.bgDefault,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(140,149,159,0.2)',
            padding: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setIsRepositoryMenuOpen((current) => !current)}
            aria-label="Repository"
            style={{
              ...menuButtonBaseStyle,
              padding: '6px 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Repository</span>
            <span style={{ fontSize: '10px', color: COLORS.fgMuted }}>{isRepositoryMenuOpen ? '▲' : '▼'}</span>
          </button>
          {isRepositoryMenuOpen && (
            <div
              style={{
                marginTop: '2px',
                marginBottom: '4px',
                marginLeft: '8px',
                paddingLeft: '8px',
                borderLeft: `1px solid ${COLORS.borderMuted}`,
              }}
            >
              {repositoryOptions.length === 0 ? (
                <div style={{ padding: '6px 4px', fontSize: '11px', color: COLORS.fgMuted }}>
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
                      ...menuButtonBaseStyle,
                      padding: '3px 4px',
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
          <button type="button" onClick={openOptions} style={{ ...menuButtonBaseStyle, padding: '6px 4px' }}>
            Open Settings
          </button>
          <div
            style={{
              marginTop: '6px',
              paddingTop: '6px',
              borderTop: `1px solid ${COLORS.borderMuted}`,
              fontSize: '11px',
              color: COLORS.fgMuted,
            }}
          >
            Version: {manifestVersion}
          </div>
        </div>
      </header>

      {refreshError && <p style={{ margin: '0 0 8px', color: COLORS.dangerAlt }}>{refreshError}</p>}

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
                  backgroundColor: COLORS.accent,
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
                {notificationGroups.map((group) => (
                  <li key={group.value} style={{ listStyle: 'none' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsedRepositories((current) => {
                          const next = new Set(current);
                          if (next.has(group.value)) {
                            next.delete(group.value);
                          } else {
                            next.add(group.value);
                          }
                          return next;
                        });
                      }}
                      aria-expanded={isRepositoryExpanded(group.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: 'none',
                        borderBottom: `1px solid ${COLORS.borderSubtle}`,
                        background: COLORS.bgSubtle,
                        color: COLORS.fgDefault,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        fontWeight: 600,
                        textAlign: 'left',
                      }}
                    >
                      <span>{group.value}</span>
                      <span style={{ fontSize: '10px', color: COLORS.fgMuted }}>
                        {isRepositoryExpanded(group.value) ? '▲' : '▼'}
                      </span>
                    </button>
                    {isRepositoryExpanded(group.value) && (
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {group.notifications.map((n) => (
                          <NotificationItem
                            key={n.id}
                            notification={n}
                            isRead={readIds.has(n.id)}
                            repositoryColor={getNotificationColor(n, repositoryColorMap)}
                            onToggleRead={toggleReadAndUpdate}
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
