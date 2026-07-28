import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';
import { flushPromises } from './helpers/react';

const backgroundMocks = vi.hoisted(() => ({
  client: vi.fn(),
  graphqlDefaults: vi.fn(),
  loadDecryptedPat: vi.fn(),
  rotateEncryptedPatForStartup: vi.fn(async () => {}),
}));

vi.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: backgroundMocks.graphqlDefaults,
  },
}));

vi.mock('../src/shared/patStorage', () => ({
  loadDecryptedPat: backgroundMocks.loadDecryptedPat,
  rotateEncryptedPatForStartup: backgroundMocks.rotateEncryptedPatForStartup,
}));

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

async function importBackground() {
  await import('../src/background/index');
  await flushPromises();
}

async function waitForCondition(predicate: () => boolean, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition not met within timeout');
}

describe('background integration', () => {
  let chromeMock: ChromeMockController;

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();

    chromeMock = createChromeMock();
    global.chrome = chromeMock.chrome;

    backgroundMocks.client.mockReset();
    backgroundMocks.graphqlDefaults.mockReset();
    backgroundMocks.graphqlDefaults.mockReturnValue(backgroundMocks.client);
    backgroundMocks.loadDecryptedPat.mockReset();
    backgroundMocks.loadDecryptedPat.mockResolvedValue('github_pat_test_value');
    backgroundMocks.rotateEncryptedPatForStartup.mockClear();
  });

  afterEach(() => {
    delete global.chrome;
    vi.useRealTimers();
  });

  it('runWatchCycle が通知保存・badge 更新・OS 通知発行・lastCheckedAt 保存まで行う', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          if (variables?.repoQuery?.includes('is:pr')) {
            return {
              search: {
                nodes: [
                  {
                    __typename: 'PullRequest',
                    id: 'PR_2',
                    isDraft: true,
                    number: 2,
                    title: 'PR thread',
                    url: 'https://example.com/pulls/2',
                    createdAt: '2026-05-06T08:30:00.000Z',
                    updatedAt: '2026-05-06T09:20:00.000Z',
                    repository: { name: 'repo', owner: { login: 'octo' } },
                    author: { login: 'someone' },
                    assignees: { nodes: [] },
                    body: '',
                    comments: { totalCount: 4, nodes: [] },
                    reviewThreads: {
                      nodes: [
                        {
                          comments: {
                            totalCount: 2,
                            nodes: [
                              {
                                url: 'https://example.com/pulls/2#discussion_r1',
                                createdAt: '2026-05-06T09:00:00.000Z',
                              },
                              {
                                url: 'https://example.com/pulls/2#discussion_r2',
                                createdAt: '2026-05-06T09:20:00.000Z',
                              },
                            ],
                          },
                        },
                        {
                          comments: {
                            totalCount: 3,
                            nodes: [
                              {
                                url: 'https://example.com/pulls/2#discussion_r3',
                                createdAt: '2026-05-06T08:40:00.000Z',
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            };
          }

          return {
            search: {
              nodes: [
                {
                  __typename: 'Issue',
                  id: 'ISSUE_1',
                  number: 1,
                  title: 'Issue 新規',
                  url: 'https://example.com/issues/1',
                  createdAt: '2026-05-06T09:10:00.000Z',
                  updatedAt: '2026-05-06T09:15:00.000Z',
                  repository: { name: 'repo', owner: { login: 'octo' } },
                  author: { login: 'someone' },
                  assignees: { nodes: [{ login: 'viewer' }] },
                  body: 'hello @viewer',
                  comments: {
                    totalCount: 1,
                    nodes: [
                      {
                        body: 'old comment',
                        url: 'https://example.com/issues/1#issuecomment-1',
                        author: { login: 'someone' },
                        createdAt: '2026-05-06T09:11:00.000Z',
                        updatedAt: '2026-05-06T09:11:00.000Z',
                      },
                      {
                        body: 'new comment',
                        url: 'https://example.com/issues/1#issuecomment-2',
                        author: { login: 'someone' },
                        createdAt: '2026-05-06T09:12:00.000Z',
                        updatedAt: '2026-05-06T09:12:00.000Z',
                      },
                    ],
                  },
                },
              ],
            },
          };
        }
        if (query.includes('WatchReviewThreads')) {
          return {
            nodes: [
              {
                __typename: 'PullRequest',
                id: 'PR_2',
                number: 2,
                title: 'PR thread',
                url: 'https://example.com/pulls/2',
                repository: { name: 'repo', owner: { login: 'octo' } },
                reviewThreads: {
                  nodes: [
                    {
                      id: 'THREAD_1',
                      isResolved: false,
                      comments: {
                        nodes: [
                          {
                            id: 'COMMENT_1',
                            body: '@viewer ping',
                            author: { login: 'someone' },
                            createdAt: '2026-05-06T08:50:00.000Z',
                          },
                          {
                            id: 'COMMENT_2',
                            body: 'follow up',
                            author: { login: 'someone' },
                            createdAt: '2026-05-06T09:25:00.000Z',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        if (query.includes('WatchReviewThreads')) {
          return { nodes: [] };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: nodeId.startsWith('PR_') ? 'PullRequest' : 'Issue',
              id: nodeId,
              closed: false,
              ...(nodeId === 'PR_2' ? { isDraft: true } : {}),
              ...(nodeId === 'PR_2'
                ? {
                    comments: { totalCount: 4 },
                    reviewThreads: {
                      nodes: [{ comments: { totalCount: 2 } }, { comments: { totalCount: 3 } }],
                    },
                  }
                : { comments: { totalCount: 1 } }),
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(() => chromeMock.getLocalState().badgeCount === 2);

    const state = chromeMock.getLocalState();
    expect(state).toMatchObject({
      badgeCount: 2,
      readNotificationIds: [],
    });
    expect(new Date(state.lastCheckedAt as string).getTime()).toBeGreaterThan(
      new Date('2026-05-06T07:00:00.000Z').getTime(),
    );
    expect(state.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(state.notifications as Array<unknown>).toHaveLength(2);
    expect(state.notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'PR_2', isDraft: true })]),
    );
    expect(state.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'PR_2', commentCount: 9 }),
        expect.objectContaining({ id: 'ISSUE_1', commentCount: 1 }),
      ]),
    );
    const issueNotification = (state.notifications as Array<{ id: string; latestCommentUrl?: string }>).find(
      (notification) => notification.id === 'ISSUE_1',
    );
    const pullRequestNotification = (state.notifications as Array<{ id: string; latestCommentUrl?: string }>).find(
      (notification) => notification.id === 'PR_2',
    );
    expect(issueNotification?.latestCommentUrl).toBe('https://example.com/issues/1#issuecomment-2');
    expect(pullRequestNotification?.latestCommentUrl).toBe('https://example.com/pulls/2#discussion_r2');
    expect(Object.keys(state.notificationClickTargets as Record<string, string>)).toHaveLength(2);
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
    expect(chromeMock.chrome.notifications.create).toHaveBeenCalledTimes(2);
    expect(
      backgroundMocks.client.mock.calls.some(
        ([query, variables]) =>
          (query as string).includes('WatchIssuesAndPRs') &&
          (variables as { repoQuery?: string } | undefined)?.repoQuery?.includes('is:pr is:open'),
      ),
    ).toBe(true);
    expect(
      backgroundMocks.client.mock.calls.some(
        ([query, variables]) =>
          (query as string).includes('WatchIssuesAndPRs') &&
          (variables as { repoQuery?: string } | undefined)?.repoQuery?.includes('is:issue state:open'),
      ),
    ).toBe(true);
    expect(backgroundMocks.client.mock.calls.some(([query]) => (query as string).includes('WatchReviewThreads'))).toBe(
      true,
    );
    expect(
      backgroundMocks.client.mock.calls.some(([query]) => (query as string).includes('WatchNotificationStatuses')),
    ).toBe(true);
  });

  it('notifyDraftPr が OFF のときドラフト PR を保存しつつ badge から除外する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      notifyDraftPr: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          return {
            search: {
              nodes: variables?.repoQuery?.includes('is:pr')
                ? [
                    {
                      __typename: 'PullRequest',
                      id: 'PR_DRAFT',
                      isDraft: true,
                      number: 3,
                      title: 'Draft PR',
                      url: 'https://example.com/pulls/3',
                      createdAt: '2026-05-06T08:30:00.000Z',
                      updatedAt: '2026-05-06T08:30:00.000Z',
                      repository: { name: 'repo', owner: { login: 'octo' } },
                      assignees: { nodes: [] },
                      body: '',
                      comments: { nodes: [] },
                    },
                  ]
                : [],
            },
          };
        }
        if (query.includes('WatchReviewThreads')) {
          return { nodes: [] };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: 'PullRequest',
              id: nodeId,
              closed: false,
              isDraft: true,
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(() => chromeMock.getLocalState().notifications.length === 1);

    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 0,
      notifications: [expect.objectContaining({ id: 'PR_DRAFT', isDraft: true })],
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('manual refresh message で runWatchCycle を 1 回実行できる', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          if (variables?.repoQuery?.includes('is:pr')) {
            return {
              search: {
                nodes: [],
              },
            };
          }

          return {
            search: {
              nodes: [
                {
                  __typename: 'Issue',
                  id: 'ISSUE_10',
                  number: 10,
                  title: 'Issue manual refresh',
                  url: 'https://example.com/issues/10',
                  createdAt: '2026-05-06T09:10:00.000Z',
                  updatedAt: '2026-05-06T09:10:00.000Z',
                  repository: { name: 'repo', owner: { login: 'octo' } },
                  author: { login: 'someone' },
                  assignees: { nodes: [] },
                  body: '',
                  comments: { nodes: [] },
                },
              ],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: 'Issue',
              id: nodeId,
              closed: false,
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();

    const response = await new Promise<unknown>((resolve) => {
      chromeMock.chrome.runtime.sendMessage({ type: 'refresh-watch-cycle' }, resolve);
    });

    expect(response).toEqual({ ok: true });
    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 1,
    });
    expect(chromeMock.chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('既存項目の更新だけでは updated 通知を保存しない', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          if (variables?.repoQuery?.includes('is:pr')) {
            return {
              search: {
                nodes: [],
              },
            };
          }

          return {
            search: {
              nodes: [
                {
                  __typename: 'Issue',
                  id: 'ISSUE_20',
                  number: 20,
                  title: 'Issue updated item',
                  url: 'https://example.com/issues/20',
                  createdAt: '2026-05-06T06:30:00.000Z',
                  updatedAt: '2026-05-06T09:10:00.000Z',
                  repository: { name: 'repo', owner: { login: 'octo' } },
                  author: { login: 'someone' },
                  assignees: { nodes: [] },
                  body: '',
                  comments: { nodes: [] },
                },
              ],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: 'Issue',
              id: nodeId,
              closed: false,
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();

    const response = await new Promise<unknown>((resolve) => {
      chromeMock.chrome.runtime.sendMessage({ type: 'refresh-watch-cycle' }, resolve);
    });

    expect(response).toEqual({ ok: true });
    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 1,
      notifications: [
        expect.objectContaining({
          id: 'ISSUE_20',
          kinds: ['updated'],
        }),
      ],
    });
    expect(chromeMock.chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('現在の API 結果にない通知は灰色表示用の状態として保存する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      autoRemoveClosed: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [
        {
          id: 'ISSUE_1',
          kinds: ['new'],
          sourceNodeId: 'ISSUE_1',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 1,
          title: 'open issue',
          url: 'https://example.com/issues/1',
          detectedAt: '2026-05-06T07:30:00.000Z',
          isPresentInLatestResult: true,
        },
        {
          id: 'PR_2',
          kinds: ['mention'],
          sourceNodeId: 'PR_2',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'closed pr',
          url: 'https://example.com/pulls/2',
          detectedAt: '2026-05-06T07:40:00.000Z',
          isPresentInLatestResult: true,
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          return {
            search: {
              nodes: [],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: [
              {
                __typename: 'Issue',
                id: 'ISSUE_1',
                closed: false,
              },
              {
                __typename: 'PullRequest',
                id: 'PR_2',
                closed: true,
              },
            ].filter((node) => (variables?.nodeIds ?? []).includes(node.id)),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(
      () =>
        Array.isArray(chromeMock.getLocalState().notifications) &&
        (
          chromeMock.getLocalState().notifications as Array<{
            id: string;
            isPresentInLatestResult?: boolean;
          }>
        ).some((notification) => notification.id === 'PR_2' && notification.isPresentInLatestResult === false),
    );

    expect(chromeMock.getLocalState().notifications).toMatchObject([
      {
        id: 'ISSUE_1',
        isPresentInLatestResult: true,
      },
      {
        id: 'PR_2',
        isPresentInLatestResult: false,
      },
    ]);
  });

  it('監視サイクルで PR のドラフト解除を保存済み通知の isDraft へ反映する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      autoRemoveClosed: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [
        {
          id: 'PR_2',
          kinds: ['mention'],
          sourceNodeId: 'PR_2',
          isPullRequest: true,
          isDraft: true,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'draft pr',
          url: 'https://example.com/pulls/2',
          detectedAt: '2026-05-06T07:40:00.000Z',
          isPresentInLatestResult: true,
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          return {
            search: {
              nodes: [],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: [
              {
                __typename: 'PullRequest',
                id: 'PR_2',
                closed: false,
                isDraft: false,
              },
            ].filter((node) => (variables?.nodeIds ?? []).includes(node.id)),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(
      () =>
        Array.isArray(chromeMock.getLocalState().notifications) &&
        (chromeMock.getLocalState().notifications as Array<{ id: string; isDraft?: boolean }>).some(
          (notification) => notification.id === 'PR_2' && notification.isDraft === false,
        ),
    );

    expect(chromeMock.getLocalState().notifications).toMatchObject([{ id: 'PR_2', isDraft: false }]);
  });

  it('autoRemoveClosed が ON でも残す PR のドラフト付与を反映する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      autoRemoveClosed: true,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [
        {
          id: 'PR_2',
          kinds: ['mention'],
          sourceNodeId: 'PR_2',
          isPullRequest: true,
          isDraft: false,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'pr',
          url: 'https://example.com/pulls/2',
          detectedAt: '2026-05-06T07:40:00.000Z',
          isPresentInLatestResult: true,
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          return {
            search: {
              nodes: [],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: [
              {
                __typename: 'PullRequest',
                id: 'PR_2',
                closed: false,
                isDraft: true,
              },
            ].filter((node) => (variables?.nodeIds ?? []).includes(node.id)),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(
      () =>
        Array.isArray(chromeMock.getLocalState().notifications) &&
        (chromeMock.getLocalState().notifications as Array<{ id: string; isDraft?: boolean }>).some(
          (notification) => notification.id === 'PR_2' && notification.isDraft === true,
        ),
    );

    expect(chromeMock.getLocalState().notifications).toMatchObject([{ id: 'PR_2', isDraft: true }]);
  });

  it('autoRemoveClosed が ON のとき close 済み通知を削除して badge を再計算する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      autoRemoveClosed: true,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [
        {
          id: 'ISSUE_1',
          kinds: ['new'],
          sourceNodeId: 'ISSUE_1',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 1,
          title: 'open issue',
          url: 'https://example.com/issues/1',
          detectedAt: '2026-05-06T07:30:00.000Z',
          isPresentInLatestResult: true,
        },
        {
          id: 'PR_2',
          kinds: ['mention'],
          sourceNodeId: 'PR_2',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'closed pr',
          url: 'https://example.com/pulls/2',
          detectedAt: '2026-05-06T07:40:00.000Z',
          isPresentInLatestResult: true,
        },
        {
          id: 'ISSUE_3',
          kinds: ['new'],
          sourceNodeId: 'ISSUE_3',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 3,
          title: 'closed issue',
          url: 'https://example.com/issues/3',
          detectedAt: '2026-05-06T07:50:00.000Z',
          isPresentInLatestResult: true,
        },
      ],
      readNotificationIds: [],
      badgeCount: 3,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          return {
            search: {
              nodes: [],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: [
              { __typename: 'Issue', id: 'ISSUE_1', closed: false },
              { __typename: 'PullRequest', id: 'PR_2', closed: true },
              { __typename: 'Issue', id: 'ISSUE_3', closed: true },
            ].filter((node) => (variables?.nodeIds ?? []).includes(node.id)),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(() => chromeMock.getLocalState().badgeCount === 1);

    expect(chromeMock.getLocalState().notifications).toMatchObject([{ id: 'ISSUE_1' }]);
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('manual refresh message は PAT が読めないとき失敗を返す', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
    });
    backgroundMocks.loadDecryptedPat.mockResolvedValueOnce(null);

    await importBackground();

    const response = await new Promise<unknown>((resolve) => {
      chromeMock.chrome.runtime.sendMessage({ type: 'refresh-watch-cycle' }, resolve);
    });

    expect(response).toEqual({
      ok: false,
      errorMessage: 'PAT が未設定か読み出せません。',
    });
  });

  it('関連する更新済み PR がなければ review thread クエリを実行しない', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          if (variables?.repoQuery?.includes('is:issue')) {
            return {
              search: {
                nodes: [],
              },
            };
          }

          return {
            search: {
              nodes: [
                {
                  __typename: 'PullRequest',
                  id: 'PR_1',
                  number: 1,
                  title: 'No notify',
                  url: 'https://example.com/pulls/1',
                  createdAt: '2026-05-06T06:10:00.000Z',
                  updatedAt: '2026-05-06T06:20:00.000Z',
                  repository: { name: 'repo', owner: { login: 'octo' } },
                  author: { login: 'someone' },
                  assignees: { nodes: [{ login: 'viewer' }] },
                  body: '@viewer',
                  comments: {
                    nodes: [
                      {
                        body: '@viewer',
                        author: { login: 'someone' },
                        createdAt: '2026-05-06T06:15:00.000Z',
                        updatedAt: '2026-05-06T06:15:00.000Z',
                      },
                    ],
                  },
                },
              ],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: 'PullRequest',
              id: nodeId,
              closed: false,
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await waitForCondition(
      () =>
        new Date(chromeMock.getLocalState().lastCheckedAt as string).getTime() >
        new Date('2026-05-06T07:00:00.000Z').getTime(),
    );

    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 0,
      notifications: [],
    });
    expect(chromeMock.chrome.notifications.create).not.toHaveBeenCalled();
    expect(backgroundMocks.client.mock.calls.some(([query]) => (query as string).includes('WatchReviewThreads'))).toBe(
      false,
    );
  });

  it('定期監視が一時停止中のとき、アラーム発火では API を呼ばずに終了する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      isWatchPaused: true,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    await importBackground();
    chromeMock.triggerAlarm('repo-watcher-watch');
    await flushPromises();

    expect(backgroundMocks.loadDecryptedPat).not.toHaveBeenCalled();
    expect(backgroundMocks.client).not.toHaveBeenCalled();
    expect(chromeMock.getLocalState()).toMatchObject({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });
  });

  it('定期監視が一時停止中でも手動更新は実行できる', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      isWatchPaused: true,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(
      async (query: string, variables?: { repoQuery?: string; nodeIds?: string[] }) => {
        if (query.includes('GetViewer')) {
          return { viewer: { login: 'viewer' } };
        }
        if (query.includes('WatchIssuesAndPRs')) {
          if (variables?.repoQuery?.includes('is:pr')) {
            return {
              search: {
                nodes: [],
              },
            };
          }

          return {
            search: {
              nodes: [
                {
                  __typename: 'Issue',
                  id: 'ISSUE_42',
                  number: 42,
                  title: 'paused manual refresh',
                  url: 'https://example.com/issues/42',
                  createdAt: '2026-05-06T09:10:00.000Z',
                  updatedAt: '2026-05-06T09:10:00.000Z',
                  repository: { name: 'repo', owner: { login: 'octo' } },
                  author: { login: 'someone' },
                  assignees: { nodes: [] },
                  body: '',
                  comments: { nodes: [] },
                },
              ],
            },
          };
        }
        if (query.includes('WatchNotificationStatuses')) {
          return {
            nodes: (variables?.nodeIds ?? []).map((nodeId) => ({
              __typename: 'Issue',
              id: nodeId,
              closed: false,
            })),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    );

    await importBackground();

    const response = await new Promise<unknown>((resolve) => {
      chromeMock.chrome.runtime.sendMessage({ type: 'refresh-watch-cycle' }, resolve);
    });

    expect(response).toEqual({ ok: true });
    expect(backgroundMocks.client).toHaveBeenCalled();
    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 1,
    });
  });

  it('インストール時と sync 設定変更時にアラームを再設定する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 15,
      isWatchPaused: false,
    });

    await importBackground();

    chromeMock.triggerInstalled();
    await flushPromises();

    expect(chromeMock.chrome.alarms.clear).toHaveBeenCalledWith('repo-watcher-watch', expect.any(Function));
    expect(chromeMock.chrome.alarms.create).toHaveBeenCalledWith('repo-watcher-watch', {
      periodInMinutes: 15,
    });

    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 30,
      isWatchPaused: false,
    });
    chromeMock.triggerStorageChanged(
      {
        intervalMinutes: {
          oldValue: 15,
          newValue: 30,
        },
      },
      'sync',
    );
    await flushPromises();

    expect(chromeMock.chrome.alarms.create).toHaveBeenLastCalledWith('repo-watcher-watch', {
      periodInMinutes: 30,
    });
  });

  it('通知クリック時に対象 URL を開いて click target を掃除する', async () => {
    chromeMock.setLocalState({
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {
        'repo-watcher:ISSUE_1:2026-05-06T09:30:00.000Z': 'https://example.com/issues/1',
      },
    });

    await importBackground();

    chromeMock.triggerNotificationClicked('repo-watcher:ISSUE_1:2026-05-06T09:30:00.000Z');
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://example.com/issues/1',
    });
    expect(chromeMock.chrome.notifications.clear).toHaveBeenCalledWith(
      'repo-watcher:ISSUE_1:2026-05-06T09:30:00.000Z',
    );
    expect(chromeMock.getLocalState()).toMatchObject({
      notificationClickTargets: {},
    });
  });

  it('起動時に PAT rotation を実行し、badge を再計算して復元する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'ISSUE_1',
          kinds: ['new'],
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 1,
          title: 'Issue 1',
          url: 'https://example.com/issues/1',
          detectedAt: '2026-05-06T09:00:00.000Z',
        },
        {
          id: 'ISSUE_2',
          kinds: ['mention'],
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'Issue 2',
          url: 'https://example.com/issues/2',
          detectedAt: '2026-05-06T09:05:00.000Z',
        },
      ],
      readNotificationIds: ['ISSUE_2'],
      badgeCount: 99,
      notificationClickTargets: {},
    });

    await importBackground();
    chromeMock.triggerStartup();
    await flushPromises();

    expect(backgroundMocks.rotateEncryptedPatForStartup).toHaveBeenCalledTimes(1);
    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 1,
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
  });
});
