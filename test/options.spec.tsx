import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OptionsApp from '../src/options/optionsApp';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';
import { flushPromises, renderReact } from './helpers/react';

const patStorageMocks = vi.hoisted(() => ({
  saveEncryptedPat: vi.fn(async (_pat: string) => {}),
  clearEncryptedPat: vi.fn(async () => {}),
  hasEncryptedPat: vi.fn(async () => false),
  hasReadablePat: vi.fn(async () => false),
}));

vi.mock('../src/shared/patStorage', () => ({
  saveEncryptedPat: patStorageMocks.saveEncryptedPat,
  clearEncryptedPat: patStorageMocks.clearEncryptedPat,
  hasEncryptedPat: patStorageMocks.hasEncryptedPat,
  hasReadablePat: patStorageMocks.hasReadablePat,
}));

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

function formatLocalDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('/') +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

async function setTextValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('options App', () => {
  let chromeMock: ChromeMockController;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock.chrome;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    patStorageMocks.saveEncryptedPat.mockClear();
    patStorageMocks.clearEncryptedPat.mockClear();
    patStorageMocks.hasEncryptedPat.mockReset();
    patStorageMocks.hasReadablePat.mockReset();
    patStorageMocks.hasEncryptedPat.mockResolvedValue(false);
    patStorageMocks.hasReadablePat.mockResolvedValue(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete global.chrome;
  });

  it('sync storage の内容と PAT 状態を初期表示する', async () => {
    const expectedLastCheckedAt = formatLocalDateTime('2026-05-17T01:02:03Z');
    patStorageMocks.hasReadablePat.mockResolvedValue(true);
    chromeMock.setSyncState({
      repos: [
        { owner: 'octo', name: 'repo1' },
        { owner: 'hubot', name: 'repo2' },
      ],
      intervalMinutes: 15,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-17T01:02:03Z',
    });

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;

    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');
    expect(passwordInput.placeholder).toContain('変更する場合のみ新しい PAT を入力');
    expect(textarea.value).toBe('octo/repo1\nhubot/repo2');
    expect(numberInput.value).toBe('15');
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(view.container.textContent).toContain(expectedLastCheckedAt);

    await view.unmount();
  });

  it('最終チェック日をリセットできる', async () => {
    const expectedLastCheckedAt = formatLocalDateTime('2026-05-17T01:02:03Z');
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-17T01:02:03Z',
    });

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const button = findButton(view.container, 'リセット');
    expect(button).toBeTruthy();
    expect(view.container.textContent).toContain(expectedLastCheckedAt);

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.storage.local.set).toHaveBeenCalledWith(
      { lastCheckedAt: null },
      expect.any(Function),
    );
    expect(view.container.textContent).toContain('未設定');

    await view.unmount();
  });

  it('フォーム送信時に repos / interval / PAT を保存する', async () => {
    patStorageMocks.hasReadablePat.mockResolvedValue(false);

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    const form = view.container.querySelector('form') as HTMLFormElement;

    await setTextValue(passwordInput, 'github_pat_new_value');
    await setTextValue(textarea, 'octo/repo1\ninvalid\nhubot/repo2');
    await setTextValue(numberInput, '30');

    patStorageMocks.hasReadablePat.mockResolvedValue(true);

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.storage.sync.set).toHaveBeenCalledWith(
      {
        repos: [
          { owner: 'octo', name: 'repo1' },
          { owner: 'hubot', name: 'repo2' },
        ],
        intervalMinutes: 30,
      },
      expect.any(Function),
    );
    expect(patStorageMocks.saveEncryptedPat).toHaveBeenCalledWith('github_pat_new_value');
    expect(passwordInput.value).toBe('');
    expect(view.container.textContent).toContain('保存しました');
    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');

    await view.unmount();
  });

  it('保存済み PAT を削除できる', async () => {
    patStorageMocks.hasEncryptedPat.mockResolvedValue(true);
    patStorageMocks.hasReadablePat.mockResolvedValue(true);

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const button = findButton(view.container, '保存済み PAT を削除');
    expect(button).toBeTruthy();

    patStorageMocks.hasEncryptedPat.mockResolvedValue(false);
    patStorageMocks.hasReadablePat.mockResolvedValue(false);

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(patStorageMocks.clearEncryptedPat).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('PAT を削除しました');
    expect(view.container.textContent).toContain('現在の状態: PAT 未設定');

    await view.unmount();
  });

  it('PAT 保存に失敗した場合はエラーメッセージを表示する', async () => {
    patStorageMocks.saveEncryptedPat.mockRejectedValueOnce(new Error('save failed'));

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const form = view.container.querySelector('form') as HTMLFormElement;

    await setTextValue(passwordInput, 'github_pat_error');

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('保存に失敗しました');

    await view.unmount();
  });
});
