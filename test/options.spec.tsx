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
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text));
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
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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
      notifyDraftPr: false,
    });
    chromeMock.setLocalState({
      lastCheckedAt: '2026-05-17T01:02:03Z',
    });

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
    const repoList = view.container.querySelector('[aria-label="監視対象リポジトリ一覧"]') as HTMLElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;

    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');
    expect(passwordInput.placeholder).toContain('変更する場合のみ新しい PAT を入力');
    expect(repoList.textContent).toBe('octo/repo1\nhubot/repo2');
    expect(numberInput.value).toBe('15');
    const draftCheckbox = view.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(draftCheckbox.checked).toBe(false);
    expect(view.container.textContent).toContain('通知設定');
    expect(view.container.textContent).toContain('ドラフトPRを通知対象に含める');
    expect(view.container.textContent).toContain('Closeされた項目を自動的に削除する');
    expect(view.container.textContent).toContain(
      '通知内容の最新取得日時を表示します。リセットすると、次回更新時に当日の00:00:00を基準に通知内容を再取得します。',
    );
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

    expect(chromeMock.chrome.storage.local.set).toHaveBeenCalledWith({ lastCheckedAt: null }, expect.any(Function));
    expect(view.container.textContent).toContain('未設定');

    await view.unmount();
  });

  it('リポジトリ設定ダイアログの変更を保存でき、キャンセルは反映しない', async () => {
    patStorageMocks.hasReadablePat.mockResolvedValue(false);

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const settingsButton = findButton(view.container, 'リポジトリ設定');
    expect(settingsButton).toBeTruthy();

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.querySelector('[role="dialog"]')).toBeTruthy();

    const addButton = findButton(view.container, '追加');
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const repoInputs = view.container.querySelectorAll(
      '[role="dialog"] input[type="text"]',
    ) as NodeListOf<HTMLInputElement>;
    const colorInputs = view.container.querySelectorAll(
      '[role="dialog"] input[type="color"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(repoInputs).toHaveLength(3);
    expect(colorInputs).toHaveLength(3);
    colorInputs.forEach((input) => {
      expect(input.value).toMatch(/^#[0-9a-f]{6}$/);
    });

    await setTextValue(repoInputs[0], 'octo');
    expect(repoInputs[0].value).toBe('octo');
    await setTextValue(repoInputs[0], 'octo/repo1');
    await setTextValue(repoInputs[1], 'partial');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(colorInputs[0], '#ff0000');
      colorInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      colorInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    const deleteButtons = Array.from(view.container.querySelectorAll('[role="dialog"] button')).filter((button) =>
      button.textContent?.includes('削除'),
    );
    await act(async () => {
      deleteButtons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.querySelectorAll('[role="dialog"] input[type="text"]')).toHaveLength(2);

    const okButton = findButton(view.container, 'OK');
    await act(async () => {
      okButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.container.textContent).toContain('octo/repo1');

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const cancelButton = findButton(view.container, 'キャンセル');
    const dialogRepoInput = view.container.querySelector('[role="dialog"] input[type="text"]') as HTMLInputElement;
    await setTextValue(dialogRepoInput, 'changed/repo');
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('octo/repo1');
    expect(view.container.textContent).not.toContain('changed/repo');

    const passwordInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    const form = view.container.querySelector('form') as HTMLFormElement;

    await setTextValue(passwordInput, 'github_pat_new_value');
    await setTextValue(numberInput, '30');

    patStorageMocks.hasReadablePat.mockResolvedValue(true);

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.storage.sync.set).toHaveBeenCalledWith(
      {
        repos: [{ owner: 'octo', name: 'repo1', color: '#ff0000' }],
        intervalMinutes: 30,
        notifyDraftPr: true,
        autoRemoveClosed: true,
      },
      expect.any(Function),
    );
    expect(patStorageMocks.saveEncryptedPat).toHaveBeenCalledWith('github_pat_new_value');
    expect(passwordInput.value).toBe('');
    expect(view.container.textContent).toContain('保存しました');
    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');

    await view.unmount();
  });

  it('15 未満の監視間隔は保存時に 15 へクランプする', async () => {
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'repo1' }],
      intervalMinutes: 30,
      notifyDraftPr: true,
      autoRemoveClosed: true,
    });

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    const form = view.container.querySelector('form') as HTMLFormElement;

    await setTextValue(numberInput, '5');

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMinutes: 15 }),
      expect.any(Function),
    );
    expect(numberInput.value).toBe('15');

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

    expect(window.confirm).toHaveBeenCalledWith('PAT を削除しますがよろしいですか？');
    expect(patStorageMocks.clearEncryptedPat).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('PAT を削除しました');
    expect(view.container.textContent).toContain('現在の状態: PAT 未設定');

    await view.unmount();
  });

  it('保存済み PAT の削除をキャンセルすると何も変更しない', async () => {
    patStorageMocks.hasEncryptedPat.mockResolvedValue(true);
    patStorageMocks.hasReadablePat.mockResolvedValue(true);
    vi.mocked(window.confirm).mockReturnValue(false);

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const button = findButton(view.container, '保存済み PAT を削除');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(window.confirm).toHaveBeenCalledWith('PAT を削除しますがよろしいですか？');
    expect(patStorageMocks.clearEncryptedPat).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain('PAT を削除しました');
    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');

    await view.unmount();
  });

  it('PAT 保存に失敗した場合はエラーメッセージを表示する', async () => {
    patStorageMocks.saveEncryptedPat.mockRejectedValueOnce(new Error('save failed'));

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
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
