import { graphql } from '@octokit/graphql';

import { buildPatCacheKey, sanitizeError } from './security';
import { loadDecryptedPat, rotateEncryptedPatForStartup } from '../shared/patStorage';

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
};

type Settings = SyncSettings & {
  pat: string;
};

type RuntimeState = {
  viewerLogin: string | null;
  viewerLoginPatKey: string | null;
  lastCheckedAt: string | null;
};

const DEFAULT_INTERVAL_MINUTES = 5;

let runtimeState: RuntimeState = {
  viewerLogin: null,
  viewerLoginPatKey: null,
  lastCheckedAt: null,
};

type NotificationKind = 'new' | 'mention' | 'thread' | 'assignee';

type StoredNotification = {
  id: string; // `${kind}:${nodeId}` などで一意化
  kind: NotificationKind;
  isPullRequest: boolean;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  detectedAt: string; // ISO8601
};

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
      authorization: `token ${pat}`,
    },
  });
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
 * 設定ストレージから PAT / 監視対象リポジトリ / 各種フラグを読み込む。
 *
 * PAT またはリポジトリ一覧が未設定の場合は null を返す。
 * @returns 設定オブジェクト、または未設定時は null
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
      },
      (items: any) => {
        const settings: SyncSettings = {
          repos: items.repos,
          intervalMinutes: Number(items.intervalMinutes) || DEFAULT_INTERVAL_MINUTES,
          enableNewItems: Boolean(items.enableNewItems),
          enableMentions: Boolean(items.enableMentions),
          enableMentionThreads: Boolean(items.enableMentionThreads),
          enableAssigneeComments: Boolean(items.enableAssigneeComments),
        };

        resolve(settings);
      },
    );
  });
}

/**
 * 設定ストレージと暗号化済み PAT を読み込み、監視実行に必要な設定を返す。
 * @returns 設定オブジェクト、または未設定時は null
 */
async function loadSettings(): Promise<Settings | null> {
  const syncSettings = await loadSyncSettings();
  const pat = await loadDecryptedPat();

  if (!pat || !Array.isArray(syncSettings.repos) || syncSettings.repos.length === 0) {
    return null;
  }

  return {
    ...syncSettings,
    pat,
  };
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
 * `search(type: ISSUE)` で利用するクエリ文字列を組み立てる。
 *
 * - 監視対象リポジトリ: `repo:owner/name` の OR 条件
 * - 条件部分: `created:>lastCheckedAt` / `mentions:viewer` / `assignee:viewer` を OR で結合
 * @param repos 監視対象リポジトリ一覧
 * @param lastCheckedAt 前回監視時刻 (ISO8601)
 * @param viewerLogin ログインユーザーの login
 * @returns GitHub search クエリ文字列
 */
function buildRepoQuery(
  repos: WatchTargetRepo[],
  lastCheckedAt: string,
  viewerLogin: string,
): string {
  const repoPart =
    repos.length === 0 ? '' : `${repos.map((r) => `repo:${r.owner}/${r.name}`).join(' OR ')}`;

  const conditionPart = [
    `created:>${lastCheckedAt}`,
    //`mentions:${viewerLogin}`,
    `assignee:${viewerLogin}`,
  ].join(' ');

  return `${repoPart} is:open ${conditionPart}`.trim();
}

/**
 * 監視サイクル本体。
 *
 * 1. 設定読み込み
 * 2. Issues / PR の検索
 * 3. 新規作成 / メンション / Assignee コメント / レビュースレッドコメントの検知
 * 4. 通知ストアとバッジの更新
 * 5. `lastCheckedAt` の更新
 */
async function runWatchCycle() {
  const settings = await loadSettings();
  if (!settings || !settings.pat || settings.repos.length === 0) {
    return;
  }

  await hydrateRuntimeState();
  const client = createGithubClient(settings.pat);

  const nowIso = new Date().toISOString();
  const lastCheckedAt = runtimeState.lastCheckedAt ?? new Date(0).toISOString();
  const viewerLogin = await ensureViewerLogin(client as any, settings.pat);

  const repoQuery = buildRepoQuery(settings.repos, lastCheckedAt, viewerLogin);

  const searchResult = await (client as any)(
    `
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
    `,
    {
      repoQuery,
    },
  );

  const issuesAndPrs = (searchResult.search?.nodes ?? []) as any[];

  // 各種イベントごとに一時配列へ振り分ける
  const newItems: any[] = [];
  const mentionItems: any[] = [];
  const assigneeCommentItems: any[] = [];
  const updatedPrIds: string[] = [];

  for (const node of issuesAndPrs) {
    const isNew = new Date(node.createdAt) > new Date(lastCheckedAt);
    const hasAssigneeMe =
      (node.assignees?.nodes ?? []).some((a: any) => a.login === viewerLogin) ?? false;

    const comments = node.comments?.nodes ?? [];
    const hasNewComment =
      comments.some((c: any) => new Date(c.updatedAt) > new Date(lastCheckedAt)) ?? false;

    const textTargets = [
      node.body as string,
      ...comments.map((c: any) => (c.body as string) ?? ''),
    ];
    const mentionToken = `@${viewerLogin}`;
    const hasMention = textTargets.some((t) => t && t.includes(mentionToken)) ?? false;

    // 新規 PR / Issue
    if (settings.enableNewItems && isNew) {
      newItems.push(node);
    }
    // 本文・コメント中に自分宛メンションが含まれるもの
    if (settings.enableMentions && hasMention) {
      mentionItems.push(node);
    }
    // 自分が Assignee かつ lastCheckedAt 以降にコメント更新があるもの
    if (settings.enableAssigneeComments && hasAssigneeMe && hasNewComment) {
      assigneeCommentItems.push(node);
    }

    const isPR = node.__typename === 'PullRequest';
    if (isPR && new Date(node.updatedAt) > new Date(lastCheckedAt)) {
      updatedPrIds.push(node.id);
    }
  }

  // 自分のメンションを含む未解決レビュー スレッドへの新規コメント検知
  const mentionThreadItems: any[] = [];
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

    for (const pr of (reviewResult.nodes ?? []) as any[]) {
      const threads = pr.reviewThreads?.nodes ?? [];
      for (const thread of threads) {
        // 解決済みスレッドは対象外
        if (thread.isResolved) continue;

        const comments = thread.comments?.nodes ?? [];
        if (comments.length === 0) continue;

        const mentionToken = `@${viewerLogin}`;
        const hadMentionBefore = comments.some(
          (c: any) =>
            new Date(c.createdAt) <= new Date(lastCheckedAt) &&
            (c.body as string)?.includes(mentionToken),
        );
        const lastComment = comments[comments.length - 1];
        const lastCreatedAt = new Date(lastComment.createdAt);

        // 過去コメントに自分宛メンションが存在し、
        // かつ最後のコメントが前回監視時刻より新しければ通知対象とする
        if (hadMentionBefore && lastCreatedAt > new Date(lastCheckedAt)) {
          mentionThreadItems.push({
            pr,
            thread,
            lastComment,
          });
        }
      }
    }
  }

  // 通知一覧ストアへ反映（重複排除しつつ追加）
  const detectedAt = nowIso;
  // GraphQL ノードから StoredNotification 形式へ変換し、kind と node.id から一意 ID を生成する
  const toStored = (node: any, kind: NotificationKind): StoredNotification | null => {
    if (!node || !node.repository) return null;
    const isPullRequest = node.__typename === 'PullRequest';
    const owner = node.repository.owner?.login ?? '';
    const repo = node.repository.name ?? '';
    const number = typeof node.number === 'number' ? node.number : 0;
    const title = node.title ?? '';
    const url = node.url ?? '';
    const nodeId = node.id ?? `${owner}/${repo}#${number}`;
    const id = `${kind}:${nodeId}`;

    return {
      id,
      kind,
      isPullRequest,
      owner,
      repo,
      number,
      title,
      url,
      detectedAt,
    };
  };

  const collected: StoredNotification[] = [];

  // 新規 PR / Issue
  for (const n of newItems) {
    const s = toStored(n, 'new');
    if (s) collected.push(s);
  }
  // 本文・コメントに自分宛メンションを含むもの
  for (const n of mentionItems) {
    const s = toStored(n, 'mention');
    if (s) collected.push(s);
  }
  // 自分が Assignee のチケットへの新規コメント
  for (const n of assigneeCommentItems) {
    const s = toStored(n, 'assignee');
    if (s) collected.push(s);
  }
  // 自分のメンションを含む未解決レビュー スレッドへのコメント
  for (const t of mentionThreadItems) {
    const pr = (t as any).pr;
    const s = toStored(pr, 'thread');
    if (s) collected.push(s);
  }

  if (collected.length > 0) {
    // 既存通知と突き合わせて重複を排除しつつ追加し、
    // 追加件数分だけバッジカウントを増やす
    let addedNotifications: StoredNotification[] = [];
    await new Promise<void>((resolve) => {
      chrome.storage.local.get({ notifications: [], badgeCount: 0 }, (items: any) => {
        const existing: StoredNotification[] = Array.isArray(items.notifications)
          ? items.notifications
          : [];
        const existingIds = new Set(existing.map((n) => n.id));
        const merged = existing.slice();
        addedNotifications = [];

        for (const n of collected) {
          if (!existingIds.has(n.id)) {
            merged.push(n);
            addedNotifications.push(n);
          }
        }

        const newBadgeCount = (items.badgeCount ?? 0) + addedNotifications.length;

        chrome.storage.local.set(
          {
            notifications: merged,
            badgeCount: newBadgeCount,
          },
          () => {
            setBadge(newBadgeCount);
            resolve();
          },
        );
      });
    });

    await showOSNotifications(addedNotifications);
  }

  await saveLastCheckedAt(nowIso);
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
  setBadge(localState.badgeCount);
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
    changes.enableAssigneeComments
  ) {
    setupAlarms();
  }
});

// アラーム発火時に監視サイクルを実行する
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCH_ALARM_NAME) {
    runWatchCycle().catch((err) => {
      console.error('watch cycle failed', sanitizeError(err));
    });
  }
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
