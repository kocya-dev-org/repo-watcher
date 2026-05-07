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

async function waitForCondition(
  predicate: () => boolean,
  { timeoutMs = 2000, intervalMs = 10 } = {},
) {
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
      enableNewItems: true,
      enableMentions: true,
      enableMentionThreads: true,
      enableAssigneeComments: true,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(async (query: string) => {
      if (query.includes('GetViewer')) {
        return { viewer: { login: 'viewer' } };
      }
      if (query.includes('WatchIssuesAndPRs')) {
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
                  nodes: [
                    {
                      body: 'new comment',
                      author: { login: 'someone' },
                      createdAt: '2026-05-06T09:12:00.000Z',
                      updatedAt: '2026-05-06T09:12:00.000Z',
                    },
                  ],
                },
              },
              {
                __typename: 'PullRequest',
                id: 'PR_2',
                number: 2,
                title: 'PR thread',
                url: 'https://example.com/pulls/2',
                createdAt: '2026-05-06T08:30:00.000Z',
                updatedAt: '2026-05-06T09:20:00.000Z',
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

      throw new Error(`Unexpected query: ${query}`);
    });

    await importBackground();
    chromeMock.triggerAlarm('github-notify-watch');
    await waitForCondition(() => chromeMock.getLocalState().badgeCount === 4);

    const state = chromeMock.getLocalState();
    expect(state).toMatchObject({
      badgeCount: 4,
      readNotificationIds: [],
    });
    expect(new Date(state.lastCheckedAt as string).getTime()).toBeGreaterThan(
      new Date('2026-05-06T07:00:00.000Z').getTime(),
    );
    expect((state.notifications as Array<unknown>)).toHaveLength(4);
    expect(Object.keys(state.notificationClickTargets as Record<string, string>)).toHaveLength(4);
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '4' });
    expect(chromeMock.chrome.notifications.create).toHaveBeenCalledTimes(4);
    expect(
      backgroundMocks.client.mock.calls.some(([query]) =>
        (query as string).includes('WatchReviewThreads'),
      ),
    ).toBe(true);
  });

  it('manual refresh message で runWatchCycle を 1 回実行できる', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      enableNewItems: true,
      enableMentions: false,
      enableMentionThreads: false,
      enableAssigneeComments: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(async (query: string) => {
      if (query.includes('GetViewer')) {
        return { viewer: { login: 'viewer' } };
      }
      if (query.includes('WatchIssuesAndPRs')) {
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

      throw new Error(`Unexpected query: ${query}`);
    });

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

  it('通知トグルが無効な種別は収集せず、review thread クエリも不要なら実行しない', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 5,
      enableNewItems: false,
      enableMentions: false,
      enableMentionThreads: false,
      enableAssigneeComments: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-06T07:00:00.000Z',
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {},
    });

    backgroundMocks.client.mockImplementation(async (query: string) => {
      if (query.includes('GetViewer')) {
        return { viewer: { login: 'viewer' } };
      }
      if (query.includes('WatchIssuesAndPRs')) {
        return {
          search: {
            nodes: [
              {
                __typename: 'PullRequest',
                id: 'PR_1',
                number: 1,
                title: 'No notify',
                url: 'https://example.com/pulls/1',
                createdAt: '2026-05-06T09:10:00.000Z',
                updatedAt: '2026-05-06T09:20:00.000Z',
                repository: { name: 'repo', owner: { login: 'octo' } },
                author: { login: 'someone' },
                assignees: { nodes: [{ login: 'viewer' }] },
                body: '@viewer',
                comments: {
                  nodes: [
                    {
                      body: '@viewer',
                      author: { login: 'someone' },
                      createdAt: '2026-05-06T09:15:00.000Z',
                      updatedAt: '2026-05-06T09:15:00.000Z',
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    });

    await importBackground();
    chromeMock.triggerAlarm('github-notify-watch');
    await waitForCondition(
      () =>
        new Date(chromeMock.getLocalState().lastCheckedAt as string).getTime() >
        new Date('2026-05-06T07:00:00.000Z').getTime(),
    );

    expect(chromeMock.getLocalState()).toMatchObject({
      badgeCount: 0,
      notifications: [],
      notificationClickTargets: {},
    });
    expect(chromeMock.chrome.notifications.create).not.toHaveBeenCalled();
    expect(
      backgroundMocks.client.mock.calls.some(([query]) =>
        (query as string).includes('WatchReviewThreads'),
      ),
    ).toBe(false);
  });

  it('インストール時と sync 設定変更時にアラームを再設定する', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 15,
      enableNewItems: true,
      enableMentions: true,
      enableMentionThreads: true,
      enableAssigneeComments: true,
    });

    await importBackground();

    chromeMock.triggerInstalled();
    await flushPromises();

    expect(chromeMock.chrome.alarms.clear).toHaveBeenCalledWith(
      'github-notify-watch',
      expect.any(Function),
    );
    expect(chromeMock.chrome.alarms.create).toHaveBeenCalledWith('github-notify-watch', {
      periodInMinutes: 15,
    });

    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo' }],
      intervalMinutes: 30,
      enableNewItems: true,
      enableMentions: true,
      enableMentionThreads: true,
      enableAssigneeComments: true,
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

    expect(chromeMock.chrome.alarms.create).toHaveBeenLastCalledWith('github-notify-watch', {
      periodInMinutes: 30,
    });
  });

  it('通知クリック時に対象 URL を開いて click target を掃除する', async () => {
    chromeMock.setLocalState({
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
      notificationClickTargets: {
        'github-notify:new:ISSUE_1:2026-05-06T09:30:00.000Z': 'https://example.com/issues/1',
      },
    });

    await importBackground();

    chromeMock.triggerNotificationClicked('github-notify:new:ISSUE_1:2026-05-06T09:30:00.000Z');
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://example.com/issues/1',
    });
    expect(chromeMock.chrome.notifications.clear).toHaveBeenCalledWith(
      'github-notify:new:ISSUE_1:2026-05-06T09:30:00.000Z',
    );
    expect(chromeMock.getLocalState()).toMatchObject({
      notificationClickTargets: {},
    });
  });

  it('起動時に PAT rotation を実行し、badge を再計算して復元する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'new:ISSUE_1',
          kind: 'new',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 1,
          title: 'Issue 1',
          url: 'https://example.com/issues/1',
          detectedAt: '2026-05-06T09:00:00.000Z',
        },
        {
          id: 'mention:ISSUE_2',
          kind: 'mention',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 2,
          title: 'Issue 2',
          url: 'https://example.com/issues/2',
          detectedAt: '2026-05-06T09:05:00.000Z',
        },
      ],
      readNotificationIds: ['mention:ISSUE_2'],
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
