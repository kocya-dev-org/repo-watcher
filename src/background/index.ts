import { graphql } from '@octokit/graphql';

import {
  buildRepoQuery,
  getUpdatedPullRequestIds,
  hasAssigneeCommentNotification,
  hasMentionNotification,
  hasMentionThreadNotification,
  isNewNotificationCandidate,
  toStoredNotification,
  type IssueOrPullRequestNode,
  type PullRequestReviewThreadsNode,
  type WatchSearchTarget,
} from './watchLogic';
import { buildPatCacheKey, sanitizeError } from './security';
import { loadDecryptedPat, rotateEncryptedPatForStartup } from '../shared/patStorage';
import {
  calculateUnreadCount,
  getStoredNotificationNodeId,
  reconcileNotificationState,
  type StoredNotification,
} from '../shared/notifications';
import {
  isRefreshWatchCycleRequest,
  type RefreshWatchCycleResponse,
} from '../shared/runtimeMessages';

export type WatchTargetRepo = {
  owner: string;
  name: string;
};

type SyncSettings = {
  repos: WatchTargetRepo[];
  intervalMinutes: number;
  enableNewItems: boolean;
  enableMentions: boolean;
  enableMentionThreads: boolean;
  enableAssigneeComments: boolean;
  isWatchPaused: boolean;
};

type Settings = SyncSettings & {
  pat: string;
};

type RuntimeState = {
  viewerLogin: string | null;
  viewerLoginPatKey: string | null;
  lastCheckedAt: string | null;
};

type WatchCycleResult =
  | {
      status: 'completed';
    }
  | {
      status: 'paused';
    }
  | {
      status: 'skipped';
      errorMessage: string;
    };

type NotificationStatusNode = {
  __typename?: 'Issue' | 'PullRequest';
  id?: string | null;
  closed?: boolean | null;
};

const DEFAULT_INTERVAL_MINUTES = 5;
const DEBUG_LOG_ENABLED = import.meta.env.MODE === 'debug';

let runtimeState: RuntimeState = {
  viewerLogin: null,
  viewerLoginPatKey: null,
  lastCheckedAt: null,
};
let runningWatchCycle: Promise<WatchCycleResult> | null = null;

type LocalRuntimeStorage = {
  lastCheckedAt: string | null;
  viewerLogin: string | null;
  viewerLoginPatKey: string | null;
  notifications: StoredNotification[];
  readNotificationIds: string[];
  badgeCount: number;
  notificationClickTargets: Record<string, string>;
};

const WATCH_ALARM_NAME = 'github-notify-watch';
const NOTIFICATION_ID_PREFIX = 'github-notify:';
const NOTIFICATION_ICON_DATA_URL =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230969da'/%3E%3Cpath d='M20 18h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H30l-8 8v-8h-2a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z' fill='white'/%3E%3Ccircle cx='25' cy='30' r='3' fill='%230969da'/%3E%3Ccircle cx='32' cy='30' r='3' fill='%230969da'/%3E%3Ccircle cx='39' cy='30' r='3' fill='%230969da'/%3E%3C/svg%3E";
const WATCH_ISSUES_AND_PRS_QUERY = `
  query WatchIssuesAndPRs(
    $repoQuery: String!
  ) {
    search(query: $repoQuery, type: ISSUE, first: 50) {
      issueCount
      nodes {
        __typename
        ... on Issue {
          id
          number
          title
          url
          createdAt
          updatedAt
          repository {
            name
            owner { login }
          }
          author { login }
          assignees(first: 10) {
            nodes { login }
          }
          body
          comments(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              body
              author { login }
              createdAt
              updatedAt
            }
          }
        }
        ... on PullRequest {
          id
          number
          title
          url
          createdAt
          updatedAt
          repository {
            name
            owner { login }
          }
          author { login }
          assignees(first: 10) {
            nodes { login }
          }
          body
          comments(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              body
              author { login }
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
`;
const WATCH_NOTIFICATION_STATUS_QUERY = `
  query WatchNotificationStatuses(
    $nodeIds: [ID!]!
  ) {
    nodes(ids: $nodeIds) {
      __typename
      ... on Issue {
        id
        closed
      }
      ... on PullRequest {
        id
        closed
      }
    }
  }
`;

const LOCAL_RUNTIME_DEFAULTS: LocalRuntimeStorage = {
  lastCheckedAt: null,
  viewerLogin: null,
  viewerLoginPatKey: null,
  notifications: [],
  readNotificationIds: [],
  badgeCount: 0,
  notificationClickTargets: {},
};
/**
 * GitHub GraphQL クライアントを生成する。
 *
 * 設定で保存された PAT を Authorization ヘッダーに設定して返す。
 * @param pat GitHub Personal Access Token
 * @returns GraphQL クライアント
 */
function createGithubClient(pat: string) {
  return graphql.defaults({
    headers: {
      authorization: `bearer ${pat}`,
    },
  });
}

/**
 * search(type: ISSUE) を実行し、PR / Issue ノード一覧を取得する。
 * @param client GraphQL クライアント
 * @param repoQuery search API 用クエリ
 * @param target 検索対象の種別
 * @returns 取得したノード一覧
 */
async function searchIssuesAndPullRequests(
  client: any,
  repoQuery: string,
  target: WatchSearchTarget,
): Promise<IssueOrPullRequestNode[]> {
  const searchResult = await client(WATCH_ISSUES_AND_PRS_QUERY, {
    repoQuery,
  });
  debugLog('WatchIssuesAndPRs result', {
    target,
    repoQuery,
    issueCount: searchResult.search?.issueCount ?? 0,
    nodeCount: Array.isArray(searchResult.search?.nodes) ? searchResult.search.nodes.length : 0,
  });

  return (searchResult.search?.nodes ?? []) as IssueOrPullRequestNode[];
}

/**
 * デバッグビルド向けのログを統一フォーマットで出力する。
 * @param message ログメッセージ
 * @param payload 追加の詳細情報
 */
function debugLog(message: string, payload?: unknown) {
  /*
  if (!DEBUG_LOG_ENABLED) {
    return;
  }
    */
  console.info(!DEBUG_LOG_ENABLED);

  if (payload === undefined) {
    console.info('[github-notify-ext]', message);
    return;
  }

  console.info('[github-notify-ext]', message, payload);
}

/**
 * 外部例外をユーザー向けの短いエラーメッセージへ変換する。
 * @param error 捕捉した例外
 * @returns 表示用エラーメッセージ
 */
function toErrorMessage(error: unknown): string {
  const sanitized = sanitizeError(error);
  if (
    sanitized &&
    typeof sanitized === 'object' &&
    'message' in sanitized &&
    typeof sanitized.message === 'string'
  ) {
    return sanitized.message;
  }

  return '更新に失敗しました。';
}

/**
 * local storage からランタイム用の永続データを読み込む。
 * @returns ローカルストレージ上のランタイムデータ
 */
function loadLocalRuntimeStorage(): Promise<LocalRuntimeStorage> {
  return new Promise((resolve) => {
    chrome.storage.local.get(LOCAL_RUNTIME_DEFAULTS, (items) => {
      resolve({
        lastCheckedAt: typeof items.lastCheckedAt === 'string' ? items.lastCheckedAt : null,
        viewerLogin: typeof items.viewerLogin === 'string' ? items.viewerLogin : null,
        viewerLoginPatKey:
          typeof items.viewerLoginPatKey === 'string' ? items.viewerLoginPatKey : null,
        notifications: Array.isArray(items.notifications)
          ? (items.notifications as StoredNotification[])
          : [],
        readNotificationIds: Array.isArray(items.readNotificationIds)
          ? (items.readNotificationIds as string[])
          : [],
        badgeCount: Number(items.badgeCount ?? 0),
        notificationClickTargets:
          items.notificationClickTargets &&
          typeof items.notificationClickTargets === 'object' &&
          !Array.isArray(items.notificationClickTargets)
            ? (items.notificationClickTargets as Record<string, string>)
            : {},
      });
    });
  });
}

/**
 * local storage にランタイム用のデータを書き込む。
 * @param items 保存する項目
 */
function saveLocalRuntimeStorage(items: Partial<LocalRuntimeStorage>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

/**
 * 永続化されているランタイム状態をメモリへ読み戻す。
 */
async function hydrateRuntimeState() {
  if (runtimeState.lastCheckedAt && runtimeState.viewerLogin) {
    return;
  }

  const localState = await loadLocalRuntimeStorage();
  runtimeState.lastCheckedAt ??= localState.lastCheckedAt;
  runtimeState.viewerLogin ??= localState.viewerLogin;
  runtimeState.viewerLoginPatKey ??= localState.viewerLoginPatKey;
}

/**
 * sync storage から監視対象リポジトリと各種フラグを読み込む。
 * @returns sync storage 上の監視設定
 */
async function loadSyncSettings(): Promise<SyncSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        repos: [],
        intervalMinutes: DEFAULT_INTERVAL_MINUTES,
        enableNewItems: true,
        enableMentions: true,
        enableMentionThreads: true,
        enableAssigneeComments: true,
        isWatchPaused: false,
      },
      (items: any) => {
        const settings: SyncSettings = {
          repos: items.repos,
          intervalMinutes: Number(items.intervalMinutes) || DEFAULT_INTERVAL_MINUTES,
          enableNewItems: Boolean(items.enableNewItems),
          enableMentions: Boolean(items.enableMentions),
          enableMentionThreads: Boolean(items.enableMentionThreads),
          enableAssigneeComments: Boolean(items.enableAssigneeComments),
          isWatchPaused: Boolean(items.isWatchPaused),
        };

        resolve(settings);
      },
    );
  });
}

/**
 * 不足している設定項目をユーザー向けエラーメッセージへ整形する。
 * @param syncSettings sync storage から読んだ設定
 * @param pat 復号済み PAT
 * @returns 不足理由をつないだエラーメッセージ
 */
function getIncompleteSettingsError(syncSettings: SyncSettings, pat: string | null): string {
  const reasons: string[] = [];

  if (!pat) {
    reasons.push('PAT が未設定か読み出せません。');
  }
  if (!Array.isArray(syncSettings.repos) || syncSettings.repos.length === 0) {
    reasons.push('監視対象リポジトリが未設定です。');
  }

  return reasons.join(' ');
}

/**
 * sync 設定と復号済み PAT をまとめて読み込み、監視実行用の設定へ整形する。
 * @returns 監視設定または不足理由
 */
async function loadSettings(): Promise<{ settings: Settings | null; errorMessage: string | null }> {
  const syncSettings = await loadSyncSettings();
  const pat = await loadDecryptedPat();

  if (!pat || !Array.isArray(syncSettings.repos) || syncSettings.repos.length === 0) {
    const errorMessage = getIncompleteSettingsError(syncSettings, pat);
    debugLog('load settings failed: incomplete settings', {
      pat: !!pat,
      reposCount: Array.isArray(syncSettings.repos) ? syncSettings.repos.length : 'invalid',
      errorMessage,
    });
    return {
      settings: null,
      errorMessage,
    };
  }

  return {
    settings: {
      ...syncSettings,
      pat,
    },
    errorMessage: null,
  };
}

/**
 * 定期監視が一時停止中かどうかを返す。
 * @returns 一時停止中なら true
 */
async function isScheduledWatchPaused(): Promise<boolean> {
  const syncSettings = await loadSyncSettings();
  return syncSettings.isWatchPaused;
}

/**
 * 直近の監視実行時刻 (ISO8601) をストレージとランタイム状態に保存する。
 * @param iso ISO8601 形式の日時文字列
 */
async function saveLastCheckedAt(iso: string) {
  runtimeState.lastCheckedAt = iso;
  await saveLocalRuntimeStorage({ lastCheckedAt: iso });
}

/**
 * 拡張機能アイコン上のバッジ表示を更新する。
 *
 * 0 件のときはバッジ文字列を空にして非表示にする。
 * @param count バッジに表示する未読通知数
 */
function setBadge(count: number) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  }
}

/**
 * GitHub API から `viewer.login` を取得する。
 *
 * 一度取得した値は runtimeState にキャッシュし、以降はキャッシュを返す。
 * @param client GraphQL クライアント
 * @returns ログイン中ユーザーのログイン ID
 */
async function ensureViewerLogin(client: any, pat: string): Promise<string> {
  const patCacheKey = await buildPatCacheKey(pat);
  if (runtimeState.viewerLogin && runtimeState.viewerLoginPatKey === patCacheKey) {
    return runtimeState.viewerLogin as string;
  }

  const localState = await loadLocalRuntimeStorage();
  if (localState.viewerLogin && localState.viewerLoginPatKey === patCacheKey) {
    runtimeState.viewerLogin = localState.viewerLogin;
    runtimeState.viewerLoginPatKey = localState.viewerLoginPatKey;
    return localState.viewerLogin;
  }

  const result = await client(`query GetViewer { viewer { login } }`);
  runtimeState.viewerLogin = (result as any).viewer.login;
  runtimeState.viewerLoginPatKey = patCacheKey;
  await saveLocalRuntimeStorage({
    viewerLogin: runtimeState.viewerLogin,
    viewerLoginPatKey: runtimeState.viewerLoginPatKey,
  });
  return runtimeState.viewerLogin as string;
}

/**
 * 通知クリック時に遷移する URL の対応表を保存する。
 * @param pairs 通知 ID と URL の組
 */
async function saveNotificationClickTargets(pairs: Record<string, string>) {
  if (Object.keys(pairs).length === 0) {
    return;
  }

  const localState = await loadLocalRuntimeStorage();
  await saveLocalRuntimeStorage({
    notificationClickTargets: {
      ...localState.notificationClickTargets,
      ...pairs,
    },
  });
}

/**
 * 新規通知に対して OS 通知を発行する。
 * @param notifications 新規追加された通知一覧
 */
async function showOSNotifications(notifications: StoredNotification[]) {
  const clickTargets: Record<string, string> = {};

  for (const notification of notifications) {
    const notificationId = `${NOTIFICATION_ID_PREFIX}${notification.id}:${notification.detectedAt}`;
    clickTargets[notificationId] = notification.url;

    await new Promise<void>((resolve) => {
      chrome.notifications.create(
        notificationId,
        {
          type: 'basic',
          iconUrl: NOTIFICATION_ICON_DATA_URL,
          title: `${notification.owner}/${notification.repo} #${notification.number}`,
          message: `[${notification.kind}] ${notification.title}`,
        },
        () => resolve(),
      );
    });
  }

  await saveNotificationClickTargets(clickTargets);
}

/**
 * 現在の API 結果で open 扱いの通知元 node ID 一覧を取得する。
 * @param client GraphQL クライアント
 * @param notifications 状態確認したい通知一覧
 * @returns 最新 API 結果に残っている node ID 集合
 */
async function fetchLatestOpenNotificationNodeIds(
  client: any,
  notifications: StoredNotification[],
): Promise<Set<string>> {
  const nodeIds = Array.from(
    new Set(
      notifications
        .map((notification) => getStoredNotificationNodeId(notification))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    ),
  );

  if (nodeIds.length === 0) {
    return new Set<string>();
  }

  const openNodeIds = new Set<string>();

  for (let index = 0; index < nodeIds.length; index += 50) {
    const chunk = nodeIds.slice(index, index + 50);
    const result = await client(WATCH_NOTIFICATION_STATUS_QUERY, {
      nodeIds: chunk,
    });

    for (const node of ((result as { nodes?: NotificationStatusNode[] }).nodes ??
      []) as NotificationStatusNode[]) {
      if (
        (node.__typename === 'Issue' || node.__typename === 'PullRequest') &&
        typeof node.id === 'string' &&
        node.id.length > 0 &&
        node.closed === false
      ) {
        openNodeIds.add(node.id);
      }
    }
  }

  return openNodeIds;
}

/**
 * 最新 API 結果に基づき、通知ごとの表示状態を更新する。
 * @param notifications 保存済み通知一覧
 * @param latestOpenNodeIds 最新 API 結果に残っている open の node ID 集合
 * @returns 表示状態を反映した通知一覧
 */
function applyLatestResultStatus(
  notifications: StoredNotification[],
  latestOpenNodeIds: Set<string>,
): StoredNotification[] {
  return notifications.map((notification) => {
    const sourceNodeId = getStoredNotificationNodeId(notification);
    if (!sourceNodeId) {
      return notification;
    }

    return {
      ...notification,
      sourceNodeId,
      isPresentInLatestResult: latestOpenNodeIds.has(sourceNodeId),
    };
  });
}

/**
 * 監視サイクル本体。
 *
 * 1. 設定読み込み
 * 2. PR / Issue の検索
 * 3. 新規作成 / メンション / Assignee コメント / レビュースレッドコメントの検知
 * 4. 通知ストアとバッジの更新
 * 5. `lastCheckedAt` の更新
 */
async function runWatchCycle(): Promise<WatchCycleResult> {
  const { settings, errorMessage } = await loadSettings();
  if (!settings || !settings.pat || settings.repos.length === 0) {
    debugLog('watch cycle skipped: settings are incomplete');
    return {
      status: 'skipped',
      errorMessage: errorMessage ?? '設定が不足しているため更新できません。',
    };
  }

  await hydrateRuntimeState();
  const client = createGithubClient(settings.pat);

  const nowIso = new Date().toISOString();
  const lastCheckedAt = runtimeState.lastCheckedAt ?? new Date(0).toISOString();
  const viewerLogin = await ensureViewerLogin(client as any, settings.pat);
  const pullRequestQuery = buildRepoQuery(settings.repos, lastCheckedAt, 'pull_request');
  const issueQuery = buildRepoQuery(settings.repos, lastCheckedAt, 'issue');
  debugLog('watch cycle started', {
    repoCount: settings.repos.length,
    lastCheckedAt,
    viewerLogin,
    pullRequestQuery,
    issueQuery,
  });
  const [pullRequests, issues] = await Promise.all([
    searchIssuesAndPullRequests(client as any, pullRequestQuery, 'pull_request'),
    searchIssuesAndPullRequests(client as any, issueQuery, 'issue'),
  ]);
  const issuesAndPrs = [...pullRequests, ...issues];

  // 各種イベントごとに一時配列へ振り分ける
  const newItems: IssueOrPullRequestNode[] = [];
  const mentionItems: IssueOrPullRequestNode[] = [];
  const assigneeCommentItems: IssueOrPullRequestNode[] = [];

  for (const node of issuesAndPrs) {
    if (settings.enableNewItems && isNewNotificationCandidate(node, lastCheckedAt)) {
      newItems.push(node);
    }

    if (settings.enableMentions && hasMentionNotification(node, lastCheckedAt, viewerLogin)) {
      mentionItems.push(node);
    }

    if (
      settings.enableAssigneeComments &&
      hasAssigneeCommentNotification(node, lastCheckedAt, viewerLogin)
    ) {
      assigneeCommentItems.push(node);
    }
  }

  // 自分のメンションを含む未解決レビュー スレッドへの新規コメント検知
  const mentionThreadItems: PullRequestReviewThreadsNode[] = [];
  const updatedPrIds = getUpdatedPullRequestIds(issuesAndPrs, lastCheckedAt);
  if (settings.enableMentionThreads && updatedPrIds.length > 0) {
    const reviewResult = await (client as any)(
      `
      query WatchReviewThreads(
        $prIds: [ID!]!
      ) {
        nodes(ids: $prIds) {
          __typename
          ... on PullRequest {
            id
            number
            url
            title
            repository {
              name
              owner { login }
            }
            reviewThreads(first: 20) {
              nodes {
                id
                isResolved
                comments(first: 20, orderBy: { field: CREATED_AT, direction: ASC }) {
                  nodes {
                    id
                    body
                    author { login }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
      `,
      {
        prIds: updatedPrIds,
      },
    );
    debugLog('WatchReviewThreads result', reviewResult);

    for (const pr of (reviewResult.nodes ?? []) as PullRequestReviewThreadsNode[]) {
      if (hasMentionThreadNotification(pr, lastCheckedAt, viewerLogin)) {
        mentionThreadItems.push(pr);
      }
    }
  }

  // 通知一覧ストアへ反映（重複排除しつつ追加）
  const detectedAt = nowIso;
  const collected: StoredNotification[] = [];

  for (const n of newItems) {
    const s = toStoredNotification(n, 'new', detectedAt);
    if (s) collected.push(s);
  }
  for (const n of mentionItems) {
    const s = toStoredNotification(n, 'mention', detectedAt);
    if (s) collected.push(s);
  }
  for (const n of assigneeCommentItems) {
    const s = toStoredNotification(n, 'assignee', detectedAt);
    if (s) collected.push(s);
  }
  for (const pr of mentionThreadItems) {
    const s = toStoredNotification(pr, 'thread', detectedAt);
    if (s) collected.push(s);
  }

  const localState = await loadLocalRuntimeStorage();
  const reconciled = reconcileNotificationState(
    localState.notifications,
    localState.readNotificationIds,
    collected,
  );
  const latestOpenNodeIds = await fetchLatestOpenNotificationNodeIds(
    client as any,
    reconciled.notifications,
  );
  const notificationsWithLatestStatus = applyLatestResultStatus(
    reconciled.notifications,
    latestOpenNodeIds,
  );
  debugLog('watch cycle notification summary', {
    newItems: newItems.length,
    mentionItems: mentionItems.length,
    assigneeCommentItems: assigneeCommentItems.length,
    mentionThreadItems: mentionThreadItems.length,
    addedNotifications: reconciled.addedNotifications.length,
    badgeCount: reconciled.badgeCount,
    activeNotifications: latestOpenNodeIds.size,
  });

  await saveLocalRuntimeStorage({
    notifications: notificationsWithLatestStatus,
    readNotificationIds: reconciled.readNotificationIds,
    badgeCount: reconciled.badgeCount,
  });
  setBadge(reconciled.badgeCount);

  if (reconciled.addedNotifications.length > 0) {
    await showOSNotifications(reconciled.addedNotifications);
  }

  await saveLastCheckedAt(nowIso);
  debugLog('watch cycle completed', { nowIso });
  return {
    status: 'completed',
  };
}

/**
 * 同時実行を避けながら監視サイクルを 1 回だけ走らせる。
 * @returns 実行中または完了した監視サイクルの Promise
 */
function runWatchCycleOnce(): Promise<WatchCycleResult> {
  if (!runningWatchCycle) {
    runningWatchCycle = runWatchCycle().finally(() => {
      runningWatchCycle = null;
    });
  }

  return runningWatchCycle;
}

/**
 * 設定された監視間隔でアラームを再設定する。
 *
 * sync storage の設定を読み込み、`chrome.alarms` に周期アラームを登録し直す。
 */
function setupAlarms() {
  loadSyncSettings().then((settings) => {
    const intervalMinutes = settings?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;

    chrome.alarms.clear(WATCH_ALARM_NAME, () => {
      chrome.alarms.create(WATCH_ALARM_NAME, {
        periodInMinutes: intervalMinutes,
      });
    });
  });
}

/**
 * 起動時にストレージ上のバッジ数を復元する。
 */
async function restoreBadge() {
  const localState = await loadLocalRuntimeStorage();
  const badgeCount = calculateUnreadCount(localState.notifications, localState.readNotificationIds);
  if (badgeCount !== localState.badgeCount) {
    await saveLocalRuntimeStorage({ badgeCount });
  }
  setBadge(badgeCount);
}

// 拡張機能インストール時にアラームを初期化
chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

// ブラウザ起動時に PAT を前回起動時刻で複号し、今回起動時刻で再暗号化する
chrome.runtime.onStartup.addListener(() => {
  void rotateEncryptedPatForStartup().catch((err) => {
    console.error('pat rotation failed', sanitizeError(err));
  });
});

// 設定変更時にアラームや viewer キャッシュを再評価する
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  if (
    changes.intervalMinutes ||
    changes.repos ||
    changes.enableNewItems ||
    changes.enableMentions ||
    changes.enableMentionThreads ||
    changes.enableAssigneeComments ||
    changes.isWatchPaused
  ) {
    setupAlarms();
  }
});

// アラーム発火時に監視サイクルを実行する
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCH_ALARM_NAME) {
    void isScheduledWatchPaused()
      .then((paused) => {
        if (paused) {
          debugLog('watch cycle skipped: scheduled watch is paused');
          return;
        }

        return runWatchCycleOnce();
      })
      .catch((err) => {
        console.error('watch cycle failed', JSON.stringify(sanitizeError(err), null, 2));
      });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRefreshWatchCycleRequest(message)) {
    return;
  }

  debugLog('manual watch cycle requested');
  void runWatchCycleOnce()
    .then((result) => {
      const response: RefreshWatchCycleResponse =
        result.status === 'completed' || result.status === 'paused'
          ? { ok: true }
          : {
              ok: false,
              errorMessage: result.errorMessage,
            };
      sendResponse(response);
    })
    .catch((err) => {
      console.error('manual watch cycle failed', sanitizeError(err));
      const response: RefreshWatchCycleResponse = {
        ok: false,
        errorMessage: toErrorMessage(err),
      };
      sendResponse(response);
    });

  return true;
});

// OS 通知クリック時に対象の PR / Issue を開く
chrome.notifications.onClicked.addListener((notificationId) => {
  void (async () => {
    const localState = await loadLocalRuntimeStorage();
    const url = localState.notificationClickTargets[notificationId];
    if (url) {
      chrome.tabs.create({ url });
    }

    const nextTargets = { ...localState.notificationClickTargets };
    delete nextTargets[notificationId];
    await saveLocalRuntimeStorage({ notificationClickTargets: nextTargets });
    chrome.notifications.clear(notificationId);
  })();
});

void restoreBadge();
