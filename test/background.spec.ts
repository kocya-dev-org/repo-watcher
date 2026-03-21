import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { WatchTargetRepo } from '../src/background/index';
import {
  buildPatCacheKey,
  decryptPat,
  encryptPat,
  redactSensitiveText,
  sanitizeError,
} from '../src/background/security';

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
