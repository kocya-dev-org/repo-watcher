import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearEncryptedPat,
  ensurePatStartupTime,
  hasEncryptedPat,
  hasReadablePat,
  loadDecryptedPat,
  loadStoredPatState,
  rotateEncryptedPatForStartup,
  saveEncryptedPat,
  saveStoredPatState,
} from '../src/shared/patStorage';
import { decryptPat, encryptPat } from '../src/background/security';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

describe('shared patStorage lifecycle', () => {
  let chromeMock: ChromeMockController;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.chrome;
  });

  it('loadStoredPatState は期待する shape だけを返す', async () => {
    chromeMock.setLocalState({
      encryptedPat: { invalid: true },
      patCurrentStartupAt: 123,
      patPreviousStartupAt: '2026-05-06T00:00:00.000Z',
    });

    await expect(loadStoredPatState()).resolves.toEqual({
      encryptedPat: null,
      patCurrentStartupAt: null,
      patPreviousStartupAt: '2026-05-06T00:00:00.000Z',
    });
  });

  it('ensurePatStartupTime は未設定時に現在時刻を保存して返す', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T01:02:03.000Z'));

    await expect(ensurePatStartupTime()).resolves.toBe('2026-05-06T01:02:03.000Z');
    await expect(ensurePatStartupTime()).resolves.toBe('2026-05-06T01:02:03.000Z');

    expect(chromeMock.getLocalState()).toMatchObject({
      patCurrentStartupAt: '2026-05-06T01:02:03.000Z',
    });
  });

  it('saveEncryptedPat / clearEncryptedPat / hasEncryptedPat が連動する', async () => {
    await expect(hasEncryptedPat()).resolves.toBe(false);

    await saveStoredPatState({ patCurrentStartupAt: '2026-05-06T01:02:03.000Z' });
    await saveEncryptedPat('github_pat_saved_value');

    await expect(hasEncryptedPat()).resolves.toBe(true);
    expect(JSON.stringify(chromeMock.getLocalState())).not.toContain('github_pat_saved_value');

    await clearEncryptedPat();
    await expect(hasEncryptedPat()).resolves.toBe(false);
  });

  it('loadDecryptedPat は current startup で複号する', async () => {
    const startupAt = '2026-05-06T01:02:03.000Z';
    const encryptedPat = await encryptPat('github_pat_current', startupAt);

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: startupAt,
    });

    await expect(loadDecryptedPat()).resolves.toBe('github_pat_current');
  });

  it('loadDecryptedPat は current で失敗したら previous startup へ fallback し再暗号化する', async () => {
    const previousStartupAt = '2026-05-06T01:02:03.000Z';
    const currentStartupAt = '2026-05-06T02:03:04.000Z';
    const encryptedPat = await encryptPat('github_pat_fallback', previousStartupAt);

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: currentStartupAt,
      patPreviousStartupAt: previousStartupAt,
    });

    await expect(loadDecryptedPat()).resolves.toBe('github_pat_fallback');

    const state = chromeMock.getLocalState();
    const reencrypted = state.encryptedPat;
    expect(reencrypted).toBeTruthy();
    await expect(decryptPat(reencrypted as never, currentStartupAt)).resolves.toBe('github_pat_fallback');
  });

  it('loadDecryptedPat は fallback でも失敗したら encryptedPat を破棄する', async () => {
    chromeMock.setLocalState({
      encryptedPat: {
        version: 1,
        ciphertext: 'invalid',
        iv: 'invalid',
        salt: 'invalid',
        iterations: 100000,
        encryptedAt: '2026-05-06T00:00:00.000Z',
      },
      patCurrentStartupAt: '2026-05-06T02:03:04.000Z',
      patPreviousStartupAt: '2026-05-06T01:02:03.000Z',
    });

    await expect(loadDecryptedPat()).resolves.toBeNull();
    expect(chromeMock.getLocalState()).toMatchObject({
      encryptedPat: null,
      patCurrentStartupAt: '2026-05-06T02:03:04.000Z',
      patPreviousStartupAt: '2026-05-06T01:02:03.000Z',
    });
  });

  it('loadDecryptedPat は複号手段がない encryptedPat を破棄する', async () => {
    const encryptedPat = await encryptPat('github_pat_orphaned', '2026-05-06T01:02:03.000Z');

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: null,
      patPreviousStartupAt: null,
    });

    await expect(loadDecryptedPat()).resolves.toBeNull();
    expect(chromeMock.getLocalState()).toMatchObject({
      encryptedPat: null,
      patCurrentStartupAt: null,
      patPreviousStartupAt: null,
    });
  });

  it('hasReadablePat は複号できる PAT だけを true と判定する', async () => {
    const startupAt = '2026-05-06T01:02:03.000Z';
    const encryptedPat = await encryptPat('github_pat_current', startupAt);

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: startupAt,
    });
    await expect(hasReadablePat()).resolves.toBe(true);

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: null,
      patPreviousStartupAt: null,
    });
    await expect(hasReadablePat()).resolves.toBe(false);
  });

  it('rotateEncryptedPatForStartup は初回起動時に current startup を保存する', async () => {
    await rotateEncryptedPatForStartup('2026-05-06T03:04:05.000Z');

    expect(chromeMock.getLocalState()).toMatchObject({
      patCurrentStartupAt: '2026-05-06T03:04:05.000Z',
    });
  });

  it('rotateEncryptedPatForStartup は PAT がない場合も previous/current を更新する', async () => {
    chromeMock.setLocalState({
      patCurrentStartupAt: '2026-05-06T01:02:03.000Z',
      encryptedPat: null,
    });

    await rotateEncryptedPatForStartup('2026-05-06T03:04:05.000Z');

    expect(chromeMock.getLocalState()).toMatchObject({
      patPreviousStartupAt: '2026-05-06T01:02:03.000Z',
      patCurrentStartupAt: '2026-05-06T03:04:05.000Z',
      encryptedPat: null,
    });
  });

  it('rotateEncryptedPatForStartup は保存済み PAT を新しい startup で再暗号化する', async () => {
    const previousStartupAt = '2026-05-06T01:02:03.000Z';
    const nextStartupAt = '2026-05-06T03:04:05.000Z';
    const encryptedPat = await encryptPat('github_pat_rotated', previousStartupAt);

    chromeMock.setLocalState({
      encryptedPat,
      patCurrentStartupAt: previousStartupAt,
    });

    await rotateEncryptedPatForStartup(nextStartupAt);

    const state = chromeMock.getLocalState();
    expect(state).toMatchObject({
      patPreviousStartupAt: previousStartupAt,
      patCurrentStartupAt: nextStartupAt,
    });
    await expect(decryptPat(state.encryptedPat as never, nextStartupAt)).resolves.toBe('github_pat_rotated');
  });
});
