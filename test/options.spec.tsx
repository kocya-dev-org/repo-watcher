import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OptionsApp from '../src/options/optionsApp';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';
import { flushPromises, renderReact } from './helpers/react';

const patStorageMocks = vi.hoisted(() => ({
  saveEncryptedPat: vi.fn(async (_pat: string) => {}),
  clearEncryptedPat: vi.fn(async () => {}),
  hasEncryptedPat: vi.fn(async () => false),
}));

vi.mock('../src/shared/patStorage', () => ({
  saveEncryptedPat: patStorageMocks.saveEncryptedPat,
  clearEncryptedPat: patStorageMocks.clearEncryptedPat,
  hasEncryptedPat: patStorageMocks.hasEncryptedPat,
}));

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
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

async function setCheckboxValue(element: HTMLInputElement, checked: boolean) {
  if (element.checked === checked) {
    return;
  }

  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    patStorageMocks.hasEncryptedPat.mockResolvedValue(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete global.chrome;
  });

  it('sync storage の内容と PAT 状態を初期表示する', async () => {
    patStorageMocks.hasEncryptedPat.mockResolvedValue(true);
    chromeMock.setSyncState({
      repos: [
        { owner: 'octo', name: 'repo1' },
        { owner: 'hubot', name: 'repo2' },
      ],
      intervalMinutes: 15,
      enableNewItems: false,
      enableMentions: true,
      enableMentionThreads: false,
      enableAssigneeComments: true,
    });

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    const checkboxes = view.container.querySelectorAll('input[type="checkbox"]');

    expect(view.container.textContent).toContain('現在の状態: PAT 設定済み');
    expect(passwordInput.placeholder).toContain('変更する場合のみ新しい PAT を入力');
    expect(textarea.value).toBe('octo/repo1\nhubot/repo2');
    expect(numberInput.value).toBe('15');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[3] as HTMLInputElement).checked).toBe(true);

    await view.unmount();
  });

  it('フォーム送信時に repos / interval / toggles / PAT を保存する', async () => {
    patStorageMocks.hasEncryptedPat.mockResolvedValue(false);

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const passwordInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    const numberInput = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    const checkboxes = view.container.querySelectorAll('input[type="checkbox"]');
    const form = view.container.querySelector('form') as HTMLFormElement;

    await setTextValue(passwordInput, 'github_pat_new_value');
    await setTextValue(textarea, 'octo/repo1\ninvalid\nhubot/repo2');
    await setTextValue(numberInput, '30');
    await setCheckboxValue(checkboxes[0] as HTMLInputElement, false);
    await setCheckboxValue(checkboxes[1] as HTMLInputElement, false);
    await setCheckboxValue(checkboxes[2] as HTMLInputElement, true);
    await setCheckboxValue(checkboxes[3] as HTMLInputElement, true);

    patStorageMocks.hasEncryptedPat.mockResolvedValue(true);

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
        enableNewItems: false,
        enableMentions: false,
        enableMentionThreads: true,
        enableAssigneeComments: true,
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

    const view = await renderReact(<OptionsApp />);
    await flushPromises();

    const button = findButton(view.container, '保存済み PAT を削除');
    expect(button).toBeTruthy();

    patStorageMocks.hasEncryptedPat.mockResolvedValue(false);

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
