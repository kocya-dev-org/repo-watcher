import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchLatestReleaseVersion,
  isNewerVersion,
  loadLatestReleaseCheck,
  saveLatestReleaseCheck,
} from '../src/shared/releaseCheck';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/kocya-dev-org/repo-watcher/releases/latest';

describe('isNewerVersion', () => {
  it('latest > current のとき true を返す', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('0.0.1', '0.0.0')).toBe(true);
  });

  it('latest <= current のとき false を返す', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false);
    expect(isNewerVersion('1.9.9', '2.0.0')).toBe(false);
  });

  it('文字列比較ではなく数値比較を行う', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('先頭の v やプレリリースなどのサフィックスは無視する', () => {
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.1-beta.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0+build', '1.0.0')).toBe(false);
  });
});

describe('fetchLatestReleaseVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tag_name から先頭の v を除去して返す', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v1.2.3' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLatestReleaseVersion()).resolves.toBe('1.2.3');
    expect(fetchMock).toHaveBeenCalledWith(LATEST_RELEASE_API_URL, expect.anything());
  });

  it('v なしの tag_name はそのまま返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tag_name: '2.0.0' }),
      })),
    );

    await expect(fetchLatestReleaseVersion()).resolves.toBe('2.0.0');
  });

  it('404 / 403 などのエラーレスポンスは null を返し例外を投げない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(fetchLatestReleaseVersion()).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    await expect(fetchLatestReleaseVersion()).resolves.toBeNull();
  });

  it('ネットワークエラーや tag_name 欠落も null を返し例外を投げない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network failure');
      }),
    );
    await expect(fetchLatestReleaseVersion()).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      })),
    );
    await expect(fetchLatestReleaseVersion()).resolves.toBeNull();
  });
});

describe('latestReleaseCheck の storage 入出力', () => {
  let chromeMock: ChromeMockController;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock.chrome;
  });

  afterEach(() => {
    delete global.chrome;
  });

  it('保存した最新バージョンと確認時刻を読み込める', async () => {
    await saveLatestReleaseCheck('1.2.3', '2026-09-11T00:00:00.000Z');

    await expect(loadLatestReleaseCheck()).resolves.toEqual({
      latestReleaseVersion: '1.2.3',
      latestReleaseCheckedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  it('未保存時は両方 null を返す', async () => {
    await expect(loadLatestReleaseCheck()).resolves.toEqual({
      latestReleaseVersion: null,
      latestReleaseCheckedAt: null,
    });
  });
});
