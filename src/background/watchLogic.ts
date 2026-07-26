import type { NotificationKind, StoredNotification } from '../shared/notifications';
import type { WatchTargetRepo } from './index';

export type WatchSearchTarget = 'pull_request' | 'issue';

/** 最新 API 結果から得た通知元 node の状態。 */
export type LatestNotificationStatus = {
  /** open 扱いの node ID 集合。 */
  openNodeIds: Set<string>;
  /** PullRequest node ID -> approved 状態の対応表。 */
  isApprovedByNodeId: Map<string, boolean>;
  /** PullRequest node ID -> draft 状態の対応表。 */
  isDraftByNodeId: Map<string, boolean>;
};

type GithubActor = {
  login: string | null;
};

type GithubComment = {
  id?: string | null;
  body?: string | null;
  author?: GithubActor | null;
  createdAt: string;
  updatedAt?: string | null;
};

type GithubAssigneeConnection = {
  nodes?: GithubActor[];
};

type GithubRepositoryRef = {
  name: string;
  owner?: GithubActor | null;
};

export type IssueOrPullRequestNode = {
  __typename: 'Issue' | 'PullRequest';
  id?: string | null;
  isDraft?: boolean | null;
  reviewDecision?: string | null;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  repository: GithubRepositoryRef;
  assignees?: GithubAssigneeConnection | null;
  body?: string | null;
  comments?: {
    nodes?: GithubComment[];
  } | null;
};

export type ReviewThreadNode = {
  id: string;
  isResolved: boolean;
  comments?: {
    nodes?: GithubComment[];
  } | null;
};

export type PullRequestReviewThreadsNode = {
  __typename?: 'PullRequest';
  id?: string | null;
  number: number;
  title: string;
  url: string;
  repository: GithubRepositoryRef;
  reviewThreads?: {
    nodes?: ReviewThreadNode[];
  } | null;
};

/**
 * 2 つの日時を比較し、value が baseIso より後なら true を返す。
 * @param value 比較対象の日時
 * @param baseIso 基準日時
 * @returns value が基準日時より後かどうか
 */
function isDateAfter(value: string | null | undefined, baseIso: string): boolean {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() > new Date(baseIso).getTime();
}

/**
 * 本文中に対象ユーザーへのメンションが含まれるか判定する。
 * @param text 判定対象の本文
 * @param viewerLogin ログイン名
 * @returns `@viewerLogin` を含む場合は true
 */
function includesMention(text: string | null | undefined, viewerLogin: string): boolean {
  if (!text) {
    return false;
  }

  return text.toLowerCase().includes(`@${viewerLogin}`.toLowerCase());
}

/**
 * 監視対象リポジトリと種別に応じて search API 用クエリを組み立てる。
 * @param repos 監視対象リポジトリ一覧
 * @param lastCheckedAt 前回監視時刻
 * @param target 検索対象の種別
 * @returns GitHub search API に渡すクエリ文字列
 */
export function buildRepoQuery(repos: WatchTargetRepo[], lastCheckedAt: string, target: WatchSearchTarget): string {
  const repoPart = repos.length === 0 ? '' : repos.map((repo) => `repo:${repo.owner}/${repo.name}`).join(' ');
  const statePart = target === 'pull_request' ? 'is:pr is:open' : 'is:issue state:open';
  const conditionPart = `updated:>${lastCheckedAt}`; // ここでは先頭の説明しか検知できない。追加コメントは対象外。

  return [repoPart, statePart, conditionPart].filter(Boolean).join(' ');
}

/**
 * 新規作成通知の候補かどうかを判定する。
 * @param node 判定対象の Issue / Pull Request
 * @param lastCheckedAt 前回監視時刻
 * @returns 作成日時が前回監視時刻より後なら true
 */
export function isNewNotificationCandidate(node: IssueOrPullRequestNode, lastCheckedAt: string): boolean {
  return isDateAfter(node.createdAt, lastCheckedAt);
}

/**
 * 既存項目が前回監視後に更新された通知候補かどうかを判定する。
 * @param node 判定対象の Issue / Pull Request
 * @param lastCheckedAt 前回監視時刻
 * @returns 作成済み項目が前回監視後に更新されていれば true
 */
export function isUpdatedNotificationCandidate(node: IssueOrPullRequestNode, lastCheckedAt: string): boolean {
  return !isDateAfter(node.createdAt, lastCheckedAt) && isDateAfter(node.updatedAt, lastCheckedAt);
}

/**
 * assignee に含まれる項目へ新規コメントが付いたか判定する。
 * @param node 判定対象の Issue / Pull Request
 * @param lastCheckedAt 前回監視時刻
 * @param viewerLogin ログイン名
 * @returns assignee 対象で新しいコメントがあれば true
 */
export function hasAssigneeCommentNotification(
  node: IssueOrPullRequestNode,
  lastCheckedAt: string,
  viewerLogin: string,
): boolean {
  const hasAssignee = node.assignees?.nodes?.some((assignee) => assignee.login === viewerLogin) ?? false;

  if (!hasAssignee) {
    return false;
  }

  return (
    node.comments?.nodes?.some((comment) => isDateAfter(comment.updatedAt ?? comment.createdAt, lastCheckedAt)) ?? false
  );
}

/**
 * 本文またはコメントに自分宛メンションが追加されたか判定する。
 * @param node 判定対象の Issue / Pull Request
 * @param lastCheckedAt 前回監視時刻
 * @param viewerLogin ログイン名
 * @returns 新しいメンションがあれば true
 */
export function hasMentionNotification(
  node: IssueOrPullRequestNode,
  lastCheckedAt: string,
  viewerLogin: string,
): boolean {
  const hasMentionInBody = includesMention(node.body, viewerLogin);
  const hasRecentBodyMention = hasMentionInBody && isDateAfter(node.createdAt, lastCheckedAt);
  const hasRecentCommentMention =
    node.comments?.nodes?.some(
      (comment) =>
        includesMention(comment.body, viewerLogin) &&
        isDateAfter(comment.updatedAt ?? comment.createdAt, lastCheckedAt),
    ) ?? false;

  return hasRecentBodyMention || hasRecentCommentMention;
}

/**
 * review thread 追加取得のために更新済み PR の node ID を抽出する。
 * @param nodes search API で取得した項目一覧
 * @param lastCheckedAt 前回監視時刻
 * @returns 更新済み Pull Request の node ID 一覧
 */
export function getUpdatedPullRequestIds(nodes: IssueOrPullRequestNode[], lastCheckedAt: string): string[] {
  return nodes
    .filter(
      (node) => node.__typename === 'PullRequest' && Boolean(node.id) && isDateAfter(node.updatedAt, lastCheckedAt),
    )
    .map((node) => node.id as string);
}

/**
 * 自分への過去メンションを含む未解決レビュー スレッドに新規コメントがあるか判定する。
 * @param pr reviewThreads を含む Pull Request
 * @param lastCheckedAt 前回監視時刻
 * @param viewerLogin ログイン名
 * @returns 条件を満たすスレッドが 1 つでもあれば true
 */
export function hasMentionThreadNotification(
  pr: PullRequestReviewThreadsNode,
  lastCheckedAt: string,
  viewerLogin: string,
): boolean {
  const threads = pr.reviewThreads?.nodes ?? [];

  return threads.some((thread) => {
    if (thread.isResolved) {
      return false;
    }

    const comments = thread.comments?.nodes ?? [];
    if (comments.length === 0) {
      return false;
    }

    const hadMentionBefore = comments.some(
      (comment) => !isDateAfter(comment.createdAt, lastCheckedAt) && includesMention(comment.body, viewerLogin),
    );
    const hasNewCommentAfter = comments.some((comment) => isDateAfter(comment.createdAt, lastCheckedAt));

    return hadMentionBefore && hasNewCommentAfter;
  });
}

/**
 * GraphQL ノードを popup / storage 共通の通知データへ正規化する。
 * @param node 通知元の Issue / Pull Request / review thread 付き PR
 * @param kinds 通知の種別一覧
 * @param detectedAt 検知時刻
 * @returns 保存用通知データ、生成できない場合は null
 */
export function toStoredNotification(
  node: IssueOrPullRequestNode | PullRequestReviewThreadsNode,
  kinds: NotificationKind[],
  detectedAt: string,
): StoredNotification | null {
  if (!node.repository) {
    return null;
  }

  const owner = node.repository.owner?.login ?? '';
  const repo = node.repository.name ?? '';
  const nodeId = node.id ?? `${owner}/${repo}#${node.number}`;

  return {
    id: nodeId,
    kinds: kinds,
    sourceNodeId: nodeId,
    isPullRequest: node.__typename === 'PullRequest',
    ...(node.__typename === 'PullRequest'
      ? {
          isDraft: Boolean((node as IssueOrPullRequestNode).isDraft),
          // 承認取り消しを反映するため true/false を必ず確定させる
          isApproved: (node as IssueOrPullRequestNode).reviewDecision === 'APPROVED',
        }
      : {}),
    owner,
    repo,
    number: typeof node.number === 'number' ? node.number : 0,
    title: node.title ?? '',
    url: node.url ?? '',
    detectedAt,
    isPresentInLatestResult: true,
  };
}

/**
 * 最新 API 結果に基づき、通知ごとの表示状態と approved 状態を更新する。
 * @param notifications 保存済み通知一覧
 * @param latestStatus 最新 API 結果に基づく open node ID 集合と approved 対応表
 * @returns 表示状態と approved 状態を反映した通知一覧
 */
export function applyLatestResultStatus(
  notifications: StoredNotification[],
  latestStatus: LatestNotificationStatus,
): StoredNotification[] {
  const { openNodeIds, isApprovedByNodeId, isDraftByNodeId } = latestStatus;
  return notifications.map((notification) => {
    const hasApprovedInfo = notification.sourceNodeId ? isApprovedByNodeId.has(notification.sourceNodeId) : false;
    const hasDraftInfo = notification.sourceNodeId ? isDraftByNodeId.has(notification.sourceNodeId) : false;
    return {
      ...notification,
      isPresentInLatestResult: notification.sourceNodeId ? openNodeIds.has(notification.sourceNodeId) : false,
      ...(hasApprovedInfo ? { isApproved: isApprovedByNodeId.get(notification.sourceNodeId as string) } : {}),
      ...(hasDraftInfo ? { isDraft: isDraftByNodeId.get(notification.sourceNodeId as string) } : {}),
    };
  });
}

/**
 * close 済みと判定できた通知を通知一覧から取り除く。
 *
 * `sourceNodeId` を持たない通知は状態を確認できないため除外対象にしない。
 * 残す通知には approved 対応表の値を反映する。
 * @param notifications 保存済み通知一覧
 * @param latestStatus 最新 API 結果に基づく open node ID 集合と approved 対応表
 * @returns close 済み通知を取り除き approved 状態を反映した通知一覧
 */
export function removeClosedNotifications(
  notifications: StoredNotification[],
  latestStatus: LatestNotificationStatus,
): StoredNotification[] {
  const { openNodeIds, isApprovedByNodeId, isDraftByNodeId } = latestStatus;
  return notifications
    .filter((notification) => !notification.sourceNodeId || openNodeIds.has(notification.sourceNodeId))
    .map((notification) => {
      const hasApprovedInfo = notification.sourceNodeId ? isApprovedByNodeId.has(notification.sourceNodeId) : false;
      const hasDraftInfo = notification.sourceNodeId ? isDraftByNodeId.has(notification.sourceNodeId) : false;
      if (!hasApprovedInfo && !hasDraftInfo) {
        return notification;
      }
      return {
        ...notification,
        ...(hasApprovedInfo ? { isApproved: isApprovedByNodeId.get(notification.sourceNodeId as string) } : {}),
        ...(hasDraftInfo ? { isDraft: isDraftByNodeId.get(notification.sourceNodeId as string) } : {}),
      };
    });
}
