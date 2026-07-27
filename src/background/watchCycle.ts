import { graphql } from '@octokit/graphql';

import {
  applyLatestResultStatus,
  applyThreadNotificationKinds,
  buildRepoQuery,
  collectNotifications,
  getUpdatedPullRequestIds,
  computeCommentCount,
  removeClosedNotifications,
  type IssueOrPullRequestNode,
  type LatestNotificationStatus,
  type PullRequestReviewThreadsNode,
  type WatchSearchTarget,
} from './watchLogic';
import { buildPatCacheKey, sanitizeError } from './security';
import { loadDecryptedPat } from '../shared/patStorage';
import {
  calculateUnreadCount,
  formatBadgeText,
  formatNotificationKindLabel,
  filterNotificationsByDraftSetting,
  getNotificationKinds,
  reconcileNotificationState,
  type StoredNotification,
} from '../shared/notifications';
import i18n from '../shared/i18n';
import type { WatchTargetRepo } from '../shared/repositories';
import {
  GET_VIEWER_QUERY,
  WATCH_ISSUES_AND_PRS_QUERY,
  WATCH_NOTIFICATION_STATUS_QUERY,
  WATCH_REVIEW_THREADS_QUERY,
} from './queries';
import { loadLocalRuntimeStorage, saveLocalRuntimeStorage, type LocalRuntimeStorage } from './runtimeStorage';
import { debugLog } from './logging';

/** PAT を設定済みの GitHub GraphQL クライアント。 */
type GithubGraphqlClient = ReturnType<typeof graphql.defaults>;

type SyncSettings = {
  repos: WatchTargetRepo[];
  intervalMinutes: number;
  isWatchPaused: boolean;
  notifyDraftPr: boolean;
  autoRemoveClosed: boolean;
};

/** 1 件以上の要素を持つことが型で保証されたリポジトリ一覧。 */
type NonEmptyRepos = [WatchTargetRepo, ...WatchTargetRepo[]];

/**
 * 監視サイクルを実行できる状態まで検証済みの設定。
 *
 * この型を得られた時点で PAT と監視対象リポジトリが揃っていることが保証される。
 */
type WatchSettings = SyncSettings & {
  /** 空文字ではない PAT。 */
  pat: string;
  repos: NonEmptyRepos;
};

type RuntimeState = {
  viewerLogin: string | null;
  viewerLoginPatKey: string | null;
  lastCheckedAt: string | null;
};

export type WatchCycleResult =
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
  isDraft?: boolean | null;
  reviewDecision?: string | null;
  comments?: { totalCount?: number | null } | null;
  reviewThreads?: {
    nodes?: { comments?: { totalCount?: number | null } | null }[];
  } | null;
};

export const DEFAULT_INTERVAL_MINUTES = 5;
export const WATCH_ALARM_NAME = 'github-notify-watch';

/** 通知元 node の状態をまとめて問い合わせるときの 1 リクエストあたり件数。 */
const NOTIFICATION_STATUS_CHUNK_SIZE = 50;
/** 未読件数バッジの背景色。 */
const BADGE_BACKGROUND_COLOR = '#d93025';
const NOTIFICATION_ID_PREFIX = 'github-notify:';
const NOTIFICATION_ICON_DATA_URL =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230969da'/%3E%3Cpath d='M20 18h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H30l-8 8v-8h-2a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z' fill='white'/%3E%3Ccircle cx='25' cy='30' r='3' fill='%230969da'/%3E%3Ccircle cx='32' cy='30' r='3' fill='%230969da'/%3E%3Ccircle cx='39' cy='30' r='3' fill='%230969da'/%3E%3C/svg%3E";

const INITIAL_RUNTIME_STATE: RuntimeState = {
  viewerLogin: null,
  viewerLoginPatKey: null,
  lastCheckedAt: null,
};

/**
 * モジュール内で共有するランタイム状態。
 *
 * 直接参照せず、必ず {@link getRuntimeState} / {@link updateRuntimeState} 経由で読み書きする。
 */
let runtimeState: RuntimeState = { ...INITIAL_RUNTIME_STATE };

/**
 * 現在のランタイム状態を読み取り専用で返す。
 * @returns ランタイム状態
 */
function getRuntimeState(): Readonly<RuntimeState> {
  return runtimeState;
}

/**
 * ランタイム状態を部分更新する。
 * @param patch 更新したい項目のみを持つオブジェクト
 */
function updateRuntimeState(patch: Partial<RuntimeState>) {
  runtimeState = { ...runtimeState, ...patch };
}

/**
 * ランタイム状態を初期値へ戻す。
 *
 * テスト間で状態が持ち越されるのを防ぐために利用する。
 */
export function resetRuntimeState() {
  runtimeState = { ...INITIAL_RUNTIME_STATE };
}

/**
 * GitHub GraphQL クライアントを生成する。
 *
 * 設定で保存された PAT を Authorization ヘッダーに設定して返す。
 * @param pat GitHub Personal Access Token
 * @returns GraphQL クライアント
 */
function createGithubClient(pat: string): GithubGraphqlClient {
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
  client: GithubGraphqlClient,
  repoQuery: string,
  target: WatchSearchTarget,
): Promise<IssueOrPullRequestNode[]> {
  const searchResult = await client<{
    search?: { issueCount?: number; nodes?: IssueOrPullRequestNode[] };
  }>(WATCH_ISSUES_AND_PRS_QUERY, {
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
 * 外部例外をユーザー向けの短いエラーメッセージへ変換する。
 * @param error 捕捉した例外
 * @returns 表示用エラーメッセージ
 */
export function toErrorMessage(error: unknown): string {
  const sanitized = sanitizeError(error);
  if (sanitized && typeof sanitized === 'object' && 'message' in sanitized && typeof sanitized.message === 'string') {
    return sanitized.message;
  }

  return '更新に失敗しました。';
}

/**
 * 永続化されているランタイム状態をメモリへ読み戻す。
 * @param localState 監視サイクル冒頭で読み込んだ local storage の内容
 */
function hydrateRuntimeState(localState: LocalRuntimeStorage) {
  updateRuntimeState({
    lastCheckedAt: localState.lastCheckedAt,
    viewerLogin: localState.viewerLogin,
    viewerLoginPatKey: localState.viewerLoginPatKey,
  });
}

/**
 * sync storage から監視対象リポジトリと監視設定を読み込む。
 * @returns sync storage 上の監視設定
 */
export async function loadSyncSettings(): Promise<SyncSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        repos: [],
        intervalMinutes: DEFAULT_INTERVAL_MINUTES,
        isWatchPaused: false,
        notifyDraftPr: true,
        autoRemoveClosed: true,
      },
      (items: {
        repos?: unknown;
        intervalMinutes?: unknown;
        isWatchPaused?: unknown;
        notifyDraftPr?: unknown;
        autoRemoveClosed?: unknown;
      }) => {
        const settings: SyncSettings = {
          repos: items.repos as WatchTargetRepo[],
          intervalMinutes: Number(items.intervalMinutes) || DEFAULT_INTERVAL_MINUTES,
          isWatchPaused: Boolean(items.isWatchPaused),
          notifyDraftPr: items.notifyDraftPr === undefined ? true : Boolean(items.notifyDraftPr),
          autoRemoveClosed: items.autoRemoveClosed === undefined ? true : Boolean(items.autoRemoveClosed),
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
 *
 * PAT と監視対象リポジトリの検証はこの関数に集約しており、`settings` が非 null なら
 * 呼び出し側は追加の検証をせずにそのまま利用できる。
 * @returns 検証済みの監視設定、または不足理由
 */
async function loadSettings(): Promise<{ settings: WatchSettings | null; errorMessage: string | null }> {
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
      repos: syncSettings.repos as NonEmptyRepos,
      pat,
    },
    errorMessage: null,
  };
}

/**
 * 定期監視が一時停止中かどうかを返す。
 * @returns 一時停止中なら true
 */
export async function isScheduledWatchPaused(): Promise<boolean> {
  const syncSettings = await loadSyncSettings();
  return syncSettings.isWatchPaused;
}

/**
 * 直近の監視実行時刻 (ISO8601) をストレージとランタイム状態に保存する。
 * @param iso ISO8601 形式の日時文字列
 */
async function saveLastCheckedAt(iso: string) {
  updateRuntimeState({ lastCheckedAt: iso });
  await saveLocalRuntimeStorage({ lastCheckedAt: iso });
}

/**
 * 拡張機能アイコン上のバッジ表示を更新する。
 *
 * 0 件のときはバッジ文字列を空にして非表示にする。
 * @param count バッジに表示する未読通知数
 */
function setBadge(count: number) {
  chrome.action.setBadgeText({ text: formatBadgeText(count) });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  }
}

/**
 * Date を秒精度の UTC ISO8601 文字列へ変換する。
 * @param value 変換対象の日時
 * @returns ミリ秒を除いた UTC 文字列
 */
function toUtcIsoSeconds(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * GitHub API から `viewer.login` を取得する。
 *
 * 一度取得した値は runtimeState と local storage にキャッシュし、以降はキャッシュを返す。
 * @param client GraphQL クライアント
 * @param pat GitHub Personal Access Token
 * @param localState 監視サイクル冒頭で読み込んだ local storage の内容
 * @returns ログイン中ユーザーのログイン ID
 */
async function ensureViewerLogin(
  client: GithubGraphqlClient,
  pat: string,
  localState: LocalRuntimeStorage,
): Promise<string> {
  const patCacheKey = await buildPatCacheKey(pat);
  const cachedViewerLogin = getRuntimeState().viewerLogin;
  if (cachedViewerLogin && getRuntimeState().viewerLoginPatKey === patCacheKey) {
    return cachedViewerLogin;
  }

  if (localState.viewerLogin && localState.viewerLoginPatKey === patCacheKey) {
    updateRuntimeState({
      viewerLogin: localState.viewerLogin,
      viewerLoginPatKey: localState.viewerLoginPatKey,
    });
    return localState.viewerLogin;
  }

  const result = await client<{ viewer: { login: string } }>(GET_VIEWER_QUERY);
  updateRuntimeState({
    viewerLogin: result.viewer.login,
    viewerLoginPatKey: patCacheKey,
  });
  await saveLocalRuntimeStorage({
    viewerLogin: result.viewer.login,
    viewerLoginPatKey: patCacheKey,
  });
  return result.viewer.login;
}

/**
 * 通知クリック時に遷移する URL の対応表を保存する。
 * @param pairs 通知 ID と URL の組
 */
async function saveNotificationClickTargets(pairs: Record<string, string>) {
  if (Object.keys(pairs).length === 0) {
    return;
  }

  // 対応表は OS 通知クリック時にも削除されるため、書き込み直前の最新状態へマージする
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
          message: `[${getNotificationKinds(notification)
            .map((kind) => i18n.t(formatNotificationKindLabel(kind)))
            .join(' / ')}] ${notification.title}`,
        },
        () => resolve(),
      );
    });
  }

  await saveNotificationClickTargets(clickTargets);
}

/**
 * 現在の API 結果で open 扱いの通知元 node と approved 状態を取得する。
 *
 * open/closed に依存せず、PullRequest の `reviewDecision` から approved 状態を持ち帰る。
 * @param client GraphQL クライアント
 * @param notifications 状態確認したい通知一覧
 * @returns 最新 API 結果に基づく open node ID 集合と approved 対応表
 */
async function fetchLatestOpenNotificationNodeIds(
  client: GithubGraphqlClient,
  notifications: StoredNotification[],
): Promise<LatestNotificationStatus> {
  const nodeIds = Array.from(
    new Set(
      notifications
        .map((notification) => notification.sourceNodeId)
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    ),
  );

  if (nodeIds.length === 0) {
    return {
      openNodeIds: new Set<string>(),
      isApprovedByNodeId: new Map<string, boolean>(),
      isChangesRequestedByNodeId: new Map<string, boolean>(),
      isDraftByNodeId: new Map<string, boolean>(),
      commentCountByNodeId: new Map<string, number>(),
    };
  }

  const openNodeIds = new Set<string>();
  const isApprovedByNodeId = new Map<string, boolean>();
  const isChangesRequestedByNodeId = new Map<string, boolean>();
  const isDraftByNodeId = new Map<string, boolean>();
  const commentCountByNodeId = new Map<string, number>();

  for (let index = 0; index < nodeIds.length; index += NOTIFICATION_STATUS_CHUNK_SIZE) {
    const chunk = nodeIds.slice(index, index + NOTIFICATION_STATUS_CHUNK_SIZE);
    const result = await client(WATCH_NOTIFICATION_STATUS_QUERY, {
      nodeIds: chunk,
    });

    for (const node of ((result as { nodes?: NotificationStatusNode[] }).nodes ?? []) as NotificationStatusNode[]) {
      if (
        (node.__typename === 'Issue' || node.__typename === 'PullRequest') &&
        typeof node.id === 'string' &&
        node.id.length > 0
      ) {
        if (node.closed === false) {
          openNodeIds.add(node.id);
        }
        if (node.__typename === 'PullRequest') {
          // 承認取り消しも反映するため true/false を必ず確定させる
          isApprovedByNodeId.set(node.id, node.reviewDecision === 'APPROVED');
          // approved と排他になるよう変更要求も true/false を必ず確定させる
          isChangesRequestedByNodeId.set(node.id, node.reviewDecision === 'CHANGES_REQUESTED');
          // ドラフト解除/付与も反映するため true/false を必ず確定させる
          isDraftByNodeId.set(node.id, node.isDraft === true);
        }
        commentCountByNodeId.set(node.id, computeCommentCount(node as IssueOrPullRequestNode));
      }
    }
  }

  return { openNodeIds, isApprovedByNodeId, isChangesRequestedByNodeId, isDraftByNodeId, commentCountByNodeId };
}

/**
 * 今日の0時の Date オブジェクトを返す。
 * @returns 今日の0時の Date
 */
const getTodayMidnight = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/**
 * 監視の基準となる前回チェック時刻を求める。
 *
 * 初回実行など前回時刻が無い場合は今日の 0 時を基準にする。
 * @returns 秒精度の UTC ISO8601 文字列
 */
function resolveLastCheckedAt(): string {
  const { lastCheckedAt } = getRuntimeState();
  return lastCheckedAt ? toUtcIsoSeconds(new Date(lastCheckedAt)) : toUtcIsoSeconds(getTodayMidnight());
}

/**
 * 前回チェック時刻以降に更新された PR / Issue を検索して取得する。
 * @param client GraphQL クライアント
 * @param repos 監視対象リポジトリ一覧
 * @param lastCheckedAt 前回監視時刻
 * @returns PR と Issue を結合したノード一覧
 */
async function fetchUpdatedIssuesAndPullRequests(
  client: GithubGraphqlClient,
  repos: WatchTargetRepo[],
  lastCheckedAt: string,
): Promise<IssueOrPullRequestNode[]> {
  const pullRequestQuery = buildRepoQuery(repos, lastCheckedAt, 'pull_request');
  const issueQuery = buildRepoQuery(repos, lastCheckedAt, 'issue');
  debugLog('watch cycle search queries', { pullRequestQuery, issueQuery });

  const [pullRequests, issues] = await Promise.all([
    searchIssuesAndPullRequests(client, pullRequestQuery, 'pull_request'),
    searchIssuesAndPullRequests(client, issueQuery, 'issue'),
  ]);

  return [...pullRequests, ...issues];
}

/**
 * 自分へのメンションを含む未解決レビュー スレッドの新規コメントを検知する。
 * @param client GraphQL クライアント
 * @param notifications 種別判定済みの通知一覧
 * @param issuesAndPrs 検索で取得した項目一覧
 * @param lastCheckedAt 前回監視時刻
 * @param viewerLogin ログイン名
 * @returns `thread` 種別を反映した通知一覧
 */
async function detectThreadNotifications(
  client: GithubGraphqlClient,
  notifications: StoredNotification[],
  issuesAndPrs: IssueOrPullRequestNode[],
  lastCheckedAt: string,
  viewerLogin: string,
): Promise<StoredNotification[]> {
  const updatedPullRequestIds = getUpdatedPullRequestIds(issuesAndPrs, lastCheckedAt);
  if (updatedPullRequestIds.length === 0) {
    return notifications;
  }

  const reviewResult = await client<{ nodes?: PullRequestReviewThreadsNode[] }>(WATCH_REVIEW_THREADS_QUERY, {
    prIds: updatedPullRequestIds,
  });
  debugLog('WatchReviewThreads result', reviewResult);

  return applyThreadNotificationKinds(notifications, reviewResult.nodes ?? [], lastCheckedAt, viewerLogin);
}

/**
 * 検知した通知を保存済み状態と統合し、最新ステータスとバッジ数を確定させて保存する。
 * @param client GraphQL クライアント
 * @param settings 検証済みの監視設定
 * @param detectedNotifications 今回検知した通知一覧
 * @returns 新規追加された通知一覧とバッジ数
 */
async function reconcileAndPersistNotifications(
  client: GithubGraphqlClient,
  settings: WatchSettings,
  detectedNotifications: StoredNotification[],
): Promise<{ addedNotifications: StoredNotification[]; badgeCount: number }> {
  // 通信中に popup が既読化を書き込んでいる可能性があるため、統合前に最新状態を読み直す
  const localState = await loadLocalRuntimeStorage();
  const reconciled = reconcileNotificationState(
    localState.notifications,
    localState.readNotificationIds,
    detectedNotifications,
  );
  const latestStatus = await fetchLatestOpenNotificationNodeIds(client, reconciled.notifications);
  const notificationsWithLatestStatus = settings.autoRemoveClosed
    ? removeClosedNotifications(reconciled.notifications, latestStatus)
    : applyLatestResultStatus(reconciled.notifications, latestStatus);
  const badgeNotifications = filterNotificationsByDraftSetting(notificationsWithLatestStatus, settings.notifyDraftPr);
  const badgeCount = calculateUnreadCount(badgeNotifications, []);

  debugLog('watch cycle notification summary', {
    addedNotifications: reconciled.addedNotifications.length,
    badgeCount,
    activeNotifications: latestStatus.openNodeIds.size,
  });

  await saveLocalRuntimeStorage({
    notifications: notificationsWithLatestStatus,
    readNotificationIds: reconciled.readNotificationIds,
    badgeCount,
  });

  return { addedNotifications: reconciled.addedNotifications, badgeCount };
}

/**
 * 監視サイクル本体。
 *
 * 1. 設定読み込み
 * 2. PR / Issue の検索
 * 3. 新規作成または更新 / メンション / Assignee コメント / レビュースレッドコメントの検知
 * 4. 通知ストアとバッジの更新
 * 5. `lastCheckedAt` の更新
 */
async function runWatchCycle(): Promise<WatchCycleResult> {
  const { settings, errorMessage } = await loadSettings();
  if (!settings) {
    debugLog('watch cycle skipped: settings are incomplete');
    return {
      status: 'skipped',
      errorMessage: errorMessage ?? '設定が不足しているため更新できません。',
    };
  }

  // 通信前の状態で足りる用途 (lastCheckedAt / viewer キャッシュ) は冒頭の 1 回だけ読み込む
  const localState = await loadLocalRuntimeStorage();
  hydrateRuntimeState(localState);

  const client = createGithubClient(settings.pat);
  const lastCheckedAt = resolveLastCheckedAt();
  const viewerLogin = await ensureViewerLogin(client, settings.pat, localState);
  debugLog('watch cycle started', {
    repoCount: settings.repos.length,
    lastCheckedAt,
    viewerLogin,
  });

  const issuesAndPrs = await fetchUpdatedIssuesAndPullRequests(client, settings.repos, lastCheckedAt);
  const detectedAt = toUtcIsoSeconds(new Date());
  const collectedNotifications = collectNotifications(issuesAndPrs, lastCheckedAt, viewerLogin, detectedAt);
  const notificationsWithThreads = await detectThreadNotifications(
    client,
    collectedNotifications,
    issuesAndPrs,
    lastCheckedAt,
    viewerLogin,
  );
  // 更新属性がないものは除外
  const detectedNotifications = notificationsWithThreads.filter(
    (notification) => (notification.kinds?.length ?? 0) > 0,
  );

  const { addedNotifications, badgeCount } = await reconcileAndPersistNotifications(
    client,
    settings,
    detectedNotifications,
  );

  setBadge(badgeCount);

  if (addedNotifications.length > 0) {
    await showOSNotifications(addedNotifications);
  }

  await saveLastCheckedAt(detectedAt);

  debugLog('watch cycle completed', { detectedAt });
  return {
    status: 'completed',
  };
}

/** 実行中の監視サイクル。多重起動を避けるため runWatchCycleOnce からのみ更新する。 */
let runningWatchCycle: Promise<WatchCycleResult> | null = null;

/**
 * 同時実行を避けながら監視サイクルを 1 回だけ走らせる。
 * @returns 実行中または完了した監視サイクルの Promise
 */
export function runWatchCycleOnce(): Promise<WatchCycleResult> {
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
export function setupAlarms() {
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
export async function restoreBadge() {
  const localState = await loadLocalRuntimeStorage();
  const settings = await loadSyncSettings();
  const notifications = filterNotificationsByDraftSetting(localState.notifications, settings.notifyDraftPr);
  const badgeCount = calculateUnreadCount(notifications, localState.readNotificationIds);
  if (badgeCount !== localState.badgeCount) {
    await saveLocalRuntimeStorage({ badgeCount });
  }
  setBadge(badgeCount);
}
