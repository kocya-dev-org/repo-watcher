import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { WatchTargetRepo } from '../src/background/index';
import {
  buildRepoQuery,
  hasAssigneeCommentNotification,
  hasMentionNotification,
  hasMentionThreadNotification,
  isNewNotificationCandidate,
  isUpdatedNotificationCandidate,
  toStoredNotification,
} from '../src/background/watchLogic';
import {
  buildPatCacheKey,
  decryptPat,
  encryptPat,
  redactSensitiveText,
  sanitizeError,
} from '../src/background/security';
import {
  calculateUnreadCount,
  getStoredNotificationNodeId,
  markNotificationAsRead,
  reconcileNotificationState,
  type StoredNotification,
} from '../src/shared/notifications';

// jsdom 環境では chrome API が存在しないため、最低限のモックを構成する
declare const global: any;

function setupChromeMock() {
  const alarmsListeners: Array<(alarm: { name: string }) => void> = [];
  const runtimeInstalledListeners: Array<() => void> = [];
  const runtimeStartupListeners: Array<() => void> = [];
  const storageChangedListeners: Array<
    (changes: Record<string, unknown>, areaName: string) => void
  > = [];
  const notificationClickedListeners: Array<(notificationId: string) => void> = [];
  const runtimeMessageListeners: Array<
    (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void
  > = [];

  const chromeMock = {
    storage: {
      sync: {
        get: vi.fn((defaults: any, cb: (items: any) => void) => {
          // デフォルト値をそのまま返す
          cb(defaults);
        }),
      },
      local: {
        get: vi.fn((defaults: any, cb: (items: any) => void) => {
          cb(defaults);
        }),
        set: vi.fn((items: any, cb?: () => void) => {
          cb?.();
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: (changes: Record<string, unknown>, areaName: string) => void) => {
          storageChangedListeners.push(fn);
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    tabs: {
      create: vi.fn(),
    },
    alarms: {
      clear: vi.fn((name: string, cb: () => void) => cb()),
      create: vi.fn(),
      onAlarm: {
        addListener: vi.fn((fn: (alarm: { name: string }) => void) => {
          alarmsListeners.push(fn);
        }),
      },
      // テスト用にリスナー呼び出しを行うヘルパー
      __trigger(name: string) {
        for (const l of alarmsListeners) l({ name });
      },
    },
    notifications: {
      create: vi.fn((notificationId: string, options: unknown, cb?: () => void) => {
        cb?.();
      }),
      clear: vi.fn((notificationId: string, cb?: (wasCleared: boolean) => void) => {
        cb?.(true);
      }),
      onClicked: {
        addListener: vi.fn((fn: (notificationId: string) => void) => {
          notificationClickedListeners.push(fn);
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
        let responded = false;
        let handledAsync = false;
        const sendResponse = (response: unknown) => {
          responded = true;
          callback?.(response);
        };

        for (const listener of runtimeMessageListeners) {
          const listenerResult = listener(message, {}, sendResponse);
          if (listenerResult === true) {
            handledAsync = true;
          }
          if (responded) {
            break;
          }
        }

        if (!responded && !handledAsync) {
          callback?.(undefined);
        }
      }),
      onInstalled: {
        addListener: vi.fn((fn: () => void) => {
          runtimeInstalledListeners.push(fn);
        }),
      },
      onStartup: {
        addListener: vi.fn((fn: () => void) => {
          runtimeStartupListeners.push(fn);
        }),
      },
      onMessage: {
        addListener: vi.fn(
          (
            fn: (
              message: unknown,
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => boolean | void,
          ) => {
            runtimeMessageListeners.push(fn);
          },
        ),
      },
    },
  } as any;

  global.chrome = chromeMock;
  return chromeMock;
}

describe('background watch logic (sanity)', () => {
  let chromeMock: any;

  beforeEach(() => {
    chromeMock = setupChromeMock();
    vi.resetModules();
  });

  afterEach(() => {
    // 汚染を避けるため削除
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (global as any).chrome;
  });

  it('WatchTargetRepo 型が期待通りに扱える', () => {
    const repos: WatchTargetRepo[] = [
      { owner: 'owner1', name: 'repo1' },
      { owner: 'owner2', name: 'repo2' },
    ];
    expect(repos).toHaveLength(2);
    expect(repos[0].owner).toBe('owner1');
  });

  it('background スクリプトが読み込まれると onInstalled / onAlarm リスナーが登録される', async () => {
    await import('../src/background/index');

    // onInstalled リスナー登録確認
    expect(chromeMock.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    // onAlarm リスナー登録確認
    expect(chromeMock.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    // storage.onChanged / notifications.onClicked も購読される
    expect(chromeMock.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.notifications.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it('アラーム発火時にストレージへアクセスしようとする', async () => {
    await import('../src/background/index');

    // アラームを擬似的に発火
    chromeMock.alarms.__trigger('github-notify-watch');

    // runWatchCycle 内で storage.sync.get が 1 回以上呼ばれていることをざっくり確認
    expect(chromeMock.storage.sync.get).toHaveBeenCalled();
  });
});

describe('background security helpers', () => {
  it('PAT キャッシュキーは同じ入力から同じ SHA-256 ハッシュを返す', async () => {
    const pat = 'github_pat_example_secret_value';

    const first = await buildPatCacheKey(pat);
    const second = await buildPatCacheKey(pat);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('secret');
  });

  it('PAT キャッシュキーは異なる入力で変わる', async () => {
    const first = await buildPatCacheKey('github_pat_first_value');
    const second = await buildPatCacheKey('github_pat_second_value');

    expect(first).not.toBe(second);
  });

  it('PAT は起動時刻ベースで暗号化して複号できる', async () => {
    const startupAt = '2026-03-21T10:00:00.000Z';
    const pat = 'github_pat_example_secret_value';

    const encrypted = await encryptPat(pat, startupAt);
    const decrypted = await decryptPat(encrypted, startupAt);

    expect(JSON.stringify(encrypted)).not.toContain(pat);
    expect(decrypted).toBe(pat);
  });

  it('異なる起動時刻では PAT を複号できない', async () => {
    const encrypted = await encryptPat(
      'github_pat_example_secret_value',
      '2026-03-21T10:00:00.000Z',
    );

    await expect(decryptPat(encrypted, '2026-03-21T11:00:00.000Z')).rejects.toThrowError();
  });

  it('認証情報を含む文字列をログ出力前に伏せる', () => {
    const text =
      'authorization: token github_pat_abcdefghijklmnopqrstuvwxyz bearer ghp_exampletoken';

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz');
    expect(redacted).not.toContain('ghp_exampletoken');
    expect(redacted).toContain('[REDACTED]');
  });

  it('例外オブジェクトから安全な最小情報だけを返す', () => {
    const sanitized = sanitizeError({
      name: 'GraphqlResponseError',
      message: 'authorization: token github_pat_abcdefghijklmnopqrstuvwxyz failed',
      status: 401,
      errors: [
        {
          message: 'bearer ghp_exampletoken is invalid',
          type: 'FORBIDDEN',
          request: {
            headers: {
              authorization: 'token github_pat_abcdefghijklmnopqrstuvwxyz',
            },
          },
        },
      ],
    });

    expect(sanitized).toEqual({
      name: 'GraphqlResponseError',
      message: 'authorization: [REDACTED] failed',
      status: 401,
      graphQLErrors: [
        {
          message: 'bearer [REDACTED] is invalid',
          type: 'FORBIDDEN',
        },
      ],
    });
  });
});

describe('background notification logic helpers', () => {
  const lastCheckedAt = '2026-03-21T10:00:00.000Z';
  const baseNode = {
    __typename: 'Issue' as const,
    id: 'ISSUE_1',
    number: 42,
    title: '通知テスト',
    url: 'https://github.com/octo/repo/issues/42',
    createdAt: '2026-03-21T10:05:00.000Z',
    updatedAt: '2026-03-21T10:05:00.000Z',
    repository: {
      name: 'repo',
      owner: { login: 'octo' },
    },
    assignees: {
      nodes: [{ login: 'viewer' }],
    },
    body: '',
    comments: {
      nodes: [],
    },
  };

  it('buildRepoQuery は PR 向けの open 条件を含む検索クエリを構築する', () => {
    const query = buildRepoQuery(
      [
        { owner: 'octo', name: 'repo1' },
        { owner: 'hubot', name: 'repo2' },
      ],
      lastCheckedAt,
      'pull_request',
    );

    expect(query).toContain('repo:octo/repo1 repo:hubot/repo2');
    expect(query).toContain('is:pr is:open');
    expect(query).toContain(`updated:>${lastCheckedAt}`);
    expect(query).not.toContain('assignee:');
    expect(query).not.toContain(' OR ');
    expect(query).not.toContain('(');
    expect(query).not.toContain(')');
  });

  it('buildRepoQuery は Issue 向けの open 条件を含む検索クエリを構築する', () => {
    const query = buildRepoQuery([{ owner: 'octo', name: 'repo1' }], lastCheckedAt, 'issue');

    expect(query).toContain('repo:octo/repo1');
    expect(query).toContain('is:issue state:open');
    expect(query).toContain(`updated:>${lastCheckedAt}`);
    expect(query).not.toContain('is:pr');
  });

  it('新規 PR/Issue 判定は createdAt が lastCheckedAt より後かで決まる', () => {
    expect(isNewNotificationCandidate(baseNode, lastCheckedAt)).toBe(true);
    expect(
      isNewNotificationCandidate(
        { ...baseNode, createdAt: '2026-03-21T09:55:00.000Z' },
        lastCheckedAt,
      ),
    ).toBe(false);
  });

  it('更新通知判定は既存項目が前回監視後に更新された場合のみ真になる', () => {
    expect(
      isUpdatedNotificationCandidate(
        {
          ...baseNode,
          createdAt: '2026-03-21T09:55:00.000Z',
          updatedAt: '2026-03-21T10:05:00.000Z',
        },
        lastCheckedAt,
      ),
    ).toBe(true);

    expect(isUpdatedNotificationCandidate(baseNode, lastCheckedAt)).toBe(false);
    expect(
      isUpdatedNotificationCandidate(
        {
          ...baseNode,
          createdAt: '2026-03-21T09:55:00.000Z',
          updatedAt: '2026-03-21T09:56:00.000Z',
        },
        lastCheckedAt,
      ),
    ).toBe(false);
  });

  it('メンション判定は新しい本文または新しいコメントだけを対象にする', () => {
    expect(
      hasMentionNotification({ ...baseNode, body: 'hello @viewer' }, lastCheckedAt, 'viewer'),
    ).toBe(true);

    expect(
      hasMentionNotification(
        {
          ...baseNode,
          createdAt: '2026-03-21T09:55:00.000Z',
          updatedAt: '2026-03-21T10:10:00.000Z',
          body: 'hello @viewer',
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(false);

    expect(
      hasMentionNotification(
        {
          ...baseNode,
          createdAt: '2026-03-21T09:55:00.000Z',
          comments: {
            nodes: [
              {
                body: 'old @viewer',
                createdAt: '2026-03-21T09:56:00.000Z',
                updatedAt: '2026-03-21T09:56:00.000Z',
              },
              {
                body: 'new @viewer',
                createdAt: '2026-03-21T10:06:00.000Z',
                updatedAt: '2026-03-21T10:06:00.000Z',
              },
            ],
          },
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(true);
  });

  it('assignee コメント判定は assignee かつ新しいコメント更新がある場合のみ真になる', () => {
    expect(
      hasAssigneeCommentNotification(
        {
          ...baseNode,
          comments: {
            nodes: [
              {
                body: 'new comment',
                createdAt: '2026-03-21T10:06:00.000Z',
                updatedAt: '2026-03-21T10:06:00.000Z',
              },
            ],
          },
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(true);

    expect(
      hasAssigneeCommentNotification(
        {
          ...baseNode,
          assignees: { nodes: [{ login: 'someone-else' }] },
          comments: {
            nodes: [
              {
                body: 'new comment',
                createdAt: '2026-03-21T10:06:00.000Z',
                updatedAt: '2026-03-21T10:06:00.000Z',
              },
            ],
          },
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(false);
  });

  it('未解決 thread で過去メンション + 新規コメントがある場合のみ通知対象にする', () => {
    expect(
      hasMentionThreadNotification(
        {
          __typename: 'PullRequest',
          id: 'PR_1',
          number: 5,
          title: 'PR',
          url: 'https://github.com/octo/repo/pull/5',
          repository: {
            name: 'repo',
            owner: { login: 'octo' },
          },
          reviewThreads: {
            nodes: [
              {
                id: 'THREAD_1',
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: '@viewer ping',
                      createdAt: '2026-03-21T09:59:00.000Z',
                    },
                    {
                      body: 'follow up',
                      createdAt: '2026-03-21T10:08:00.000Z',
                    },
                  ],
                },
              },
            ],
          },
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(true);

    expect(
      hasMentionThreadNotification(
        {
          __typename: 'PullRequest',
          id: 'PR_1',
          number: 5,
          title: 'PR',
          url: 'https://github.com/octo/repo/pull/5',
          repository: {
            name: 'repo',
            owner: { login: 'octo' },
          },
          reviewThreads: {
            nodes: [
              {
                id: 'THREAD_1',
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      body: '@viewer ping',
                      createdAt: '2026-03-21T09:59:00.000Z',
                    },
                    {
                      body: 'follow up',
                      createdAt: '2026-03-21T10:08:00.000Z',
                    },
                  ],
                },
              },
            ],
          },
        },
        lastCheckedAt,
        'viewer',
      ),
    ).toBe(false);
  });

  it('StoredNotification は item 単位の ID と kind 一覧を作る', () => {
    const stored = toStoredNotification(baseNode, 'mention', '2026-03-21T10:06:00.000Z');

    expect(stored).toEqual({
      id: 'ISSUE_1',
      kinds: ['mention'],
      sourceNodeId: 'ISSUE_1',
      isPullRequest: false,
      owner: 'octo',
      repo: 'repo',
      number: 42,
      title: '通知テスト',
      url: 'https://github.com/octo/repo/issues/42',
      detectedAt: '2026-03-21T10:06:00.000Z',
      isPresentInLatestResult: true,
    });
  });

  it('sourceNodeId が欠ける旧データでも通知 ID から node ID を復元できる', () => {
    expect(
      getStoredNotificationNodeId({
        id: 'mention:ISSUE_1',
        sourceNodeId: '',
        isPullRequest: false,
        owner: 'octo',
        repo: 'repo',
        number: 42,
        title: '通知テスト',
        url: 'https://github.com/octo/repo/issues/42',
        detectedAt: '2026-03-21T10:06:00.000Z',
        isPresentInLatestResult: true,
      }),
    ).toBe('ISSUE_1');
  });
});

describe('shared notification state helpers', () => {
  const existingNotifications: StoredNotification[] = [
    {
      id: 'new:ISSUE_1',
      sourceNodeId: 'ISSUE_1',
      isPullRequest: false,
      owner: 'octo',
      repo: 'repo',
      number: 1,
      title: 'Issue 1',
      url: 'https://github.com/octo/repo/issues/1',
      detectedAt: '2026-03-21T10:00:00.000Z',
      isPresentInLatestResult: true,
    },
    {
      id: 'mention:ISSUE_2',
      sourceNodeId: 'ISSUE_2',
      isPullRequest: false,
      owner: 'octo',
      repo: 'repo',
      number: 2,
      title: 'Issue 2',
      url: 'https://github.com/octo/repo/issues/2',
      detectedAt: '2026-03-21T10:00:00.000Z',
      isPresentInLatestResult: true,
    },
  ];

  it('既読追加は同じ ID を重複登録しない', () => {
    expect(markNotificationAsRead([], 'mention:ISSUE_2')).toEqual(['ISSUE_2']);
    expect(markNotificationAsRead(['mention:ISSUE_2'], 'mention:ISSUE_2')).toEqual(['ISSUE_2']);
  });

  it('未読件数は notifications と readNotificationIds から再計算する', () => {
    expect(calculateUnreadCount(existingNotifications, [])).toBe(2);
    expect(calculateUnreadCount(existingNotifications, ['mention:ISSUE_2'])).toBe(1);
  });

  it('reconcileNotificationState は同じ item の kind を統合しつつ既読を除去する', () => {
    const detectedNotifications: StoredNotification[] = [
      existingNotifications[0],
      {
        id: 'mention:ISSUE_1',
        sourceNodeId: 'ISSUE_1',
        isPullRequest: false,
        owner: 'octo',
        repo: 'repo',
        number: 1,
        title: 'Issue 1',
        url: 'https://github.com/octo/repo/issues/1',
        detectedAt: '2026-03-21T10:05:00.000Z',
        isPresentInLatestResult: true,
      },
      {
        id: 'thread:PR_3',
        sourceNodeId: 'PR_3',
        isPullRequest: true,
        owner: 'octo',
        repo: 'repo',
        number: 3,
        title: 'PR 3',
        url: 'https://github.com/octo/repo/pull/3',
        detectedAt: '2026-03-21T10:10:00.000Z',
        isPresentInLatestResult: true,
      },
    ];

    const reconciled = reconcileNotificationState(
      existingNotifications,
      ['mention:ISSUE_2'],
      detectedNotifications,
    );

    expect(reconciled.notifications.map((notification) => notification.id)).toEqual([
      'ISSUE_1',
      'PR_3',
    ]);
    expect(reconciled.notifications[0]?.kinds).toEqual(['new', 'mention']);
    expect(reconciled.readNotificationIds).toEqual([]);
    expect(reconciled.badgeCount).toBe(2);
    expect(reconciled.addedNotifications).toMatchObject([
      {
        id: 'ISSUE_1',
        kinds: ['new', 'mention'],
      },
      {
        id: 'PR_3',
        kinds: ['thread'],
      },
    ]);
  });
});
