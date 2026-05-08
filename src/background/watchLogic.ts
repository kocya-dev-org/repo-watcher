import type { NotificationKind, StoredNotification } from '../shared/notifications';
import type { WatchTargetRepo } from './index';

export type WatchSearchTarget = 'pull_request' | 'issue';

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

function isDateAfter(value: string | null | undefined, baseIso: string): boolean {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() > new Date(baseIso).getTime();
}

function includesMention(text: string | null | undefined, viewerLogin: string): boolean {
  if (!text) {
    return false;
  }

  return text.toLowerCase().includes(`@${viewerLogin}`.toLowerCase());
}

export function buildRepoQuery(
  repos: WatchTargetRepo[],
  lastCheckedAt: string,
  target: WatchSearchTarget,
): string {
  const repoPart =
    repos.length === 0 ? '' : repos.map((repo) => `repo:${repo.owner}/${repo.name}`).join(' ');
  const statePart =
    target === 'pull_request' ? 'is:pr is:open' : 'is:issue state:open';
  const conditionPart = `updated:>${lastCheckedAt}`;

  return [repoPart, statePart, conditionPart].filter(Boolean).join(' ');
}

export function isNewNotificationCandidate(
  node: IssueOrPullRequestNode,
  lastCheckedAt: string,
): boolean {
  return isDateAfter(node.createdAt, lastCheckedAt);
}

export function hasAssigneeCommentNotification(
  node: IssueOrPullRequestNode,
  lastCheckedAt: string,
  viewerLogin: string,
): boolean {
  const hasAssignee =
    node.assignees?.nodes?.some((assignee) => assignee.login === viewerLogin) ?? false;

  if (!hasAssignee) {
    return false;
  }

  return (
    node.comments?.nodes?.some((comment) =>
      isDateAfter(comment.updatedAt ?? comment.createdAt, lastCheckedAt),
    ) ?? false
  );
}

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

export function getUpdatedPullRequestIds(
  nodes: IssueOrPullRequestNode[],
  lastCheckedAt: string,
): string[] {
  return nodes
    .filter(
      (node) =>
        node.__typename === 'PullRequest' &&
        Boolean(node.id) &&
        isDateAfter(node.updatedAt, lastCheckedAt),
    )
    .map((node) => node.id as string);
}

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
      (comment) =>
        !isDateAfter(comment.createdAt, lastCheckedAt) &&
        includesMention(comment.body, viewerLogin),
    );
    const hasNewCommentAfter = comments.some((comment) =>
      isDateAfter(comment.createdAt, lastCheckedAt),
    );

    return hadMentionBefore && hasNewCommentAfter;
  });
}

export function toStoredNotification(
  node: IssueOrPullRequestNode | PullRequestReviewThreadsNode,
  kind: NotificationKind,
  detectedAt: string,
): StoredNotification | null {
  if (!node.repository) {
    return null;
  }

  const owner = node.repository.owner?.login ?? '';
  const repo = node.repository.name ?? '';
  const nodeId = node.id ?? `${owner}/${repo}#${node.number}`;

  return {
    id: `${kind}:${nodeId}`,
    kind,
    isPullRequest: node.__typename === 'PullRequest',
    owner,
    repo,
    number: typeof node.number === 'number' ? node.number : 0,
    title: node.title ?? '',
    url: node.url ?? '',
    detectedAt,
  };
}
