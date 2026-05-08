import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../src/popup/App';
import type { StoredNotification } from '../src/shared/notifications';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';
import { flushPromises, renderReact } from './helpers/react';

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

function findClickableItem(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('li')).find((item) => item.textContent?.includes(text));
}

function findButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

describe('popup App', () => {
  let chromeMock: ChromeMockController;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock.chrome;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.chrome;
  });

  it('通知を PR / Issue に分けて表示し、設定で無効な種別は隠す', async () => {
    const notifications: StoredNotification[] = [
      {
        id: 'new:PR_1',
        kind: 'new',
        isPullRequest: true,
        owner: 'octo',
        repo: 'repo',
        number: 10,
        title: 'PR 通知',
        url: 'https://example.com/pr/10',
        detectedAt: '2026-05-06T08:00:00.000Z',
      },
      {
        id: 'mention:ISSUE_1',
        kind: 'mention',
        isPullRequest: false,
        owner: 'octo',
        repo: 'repo',
        number: 11,
        title: 'Issue メンション',
        url: 'https://example.com/issues/11',
        detectedAt: '2026-05-06T07:00:00.000Z',
      },
      {
        id: 'assignee:ISSUE_2',
        kind: 'assignee',
        isPullRequest: false,
        owner: 'octo',
        repo: 'repo',
        number: 12,
        title: '担当通知',
        url: 'https://example.com/issues/12',
        detectedAt: '2026-05-06T06:00:00.000Z',
      },
    ];

    chromeMock.setLocalState({
      notifications,
      readNotificationIds: ['mention:ISSUE_1'],
      badgeCount: 2,
    });
    chromeMock.setSyncState({
      enableNewItems: true,
      enableMentions: true,
      enableMentionThreads: true,
      enableAssigneeComments: false,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    expect(view.container.textContent).toContain('Pull Requests');
    expect(view.container.textContent).toContain('Issues');
    expect(view.container.textContent).toContain('PR 通知');
    expect(view.container.textContent).toContain('Issue メンション');
    expect(view.container.textContent).not.toContain('担当通知');
    expect(view.container.textContent).toContain('新規');
    expect(view.container.textContent).toContain('メンション');
    expect(view.container.querySelectorAll('[title="既読"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(1);

    await view.unmount();
  });

  it('既読/未読アイコンのクリックで既読状態と badge だけを切り替える', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'new:PR_1',
          kind: 'new',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'mention:ISSUE_1',
          kind: 'mention',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'Issue メンション',
          url: 'https://example.com/issues/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const prItem = findClickableItem(view.container, 'PR 通知');
    expect(prItem).toBeTruthy();

    const unreadIcon = prItem?.querySelector('button[title="未読"]');
    expect(unreadIcon).toBeTruthy();

    await act(async () => {
      unreadIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: ['new:PR_1'],
      badgeCount: 1,
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(view.container.querySelectorAll('[title="既読"]')).toHaveLength(1);

    const readIcon = prItem?.querySelector('button[title="既読"]');
    expect(readIcon).toBeTruthy();

    await act(async () => {
      readIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: [],
      badgeCount: 2,
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(2);

    await view.unmount();
  });

  it('情報表示欄のクリックでだけ新しいタブを開き、既読状態は変えない', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'new:PR_1',
          kind: 'new',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const contentButton = findButtonByText(view.container, 'PR 通知');
    expect(contentButton).toBeTruthy();

    await act(async () => {
      contentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/pr/10' });
    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: [],
      badgeCount: 1,
    });
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(1);

    await view.unmount();
  });

  it('popup を閉じたときに既読通知を一覧から除去する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'new:PR_1',
          kind: 'new',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'mention:ISSUE_1',
          kind: 'mention',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'Issue メンション',
          url: 'https://example.com/issues/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const prItem = findClickableItem(view.container, 'PR 通知');
    const unreadIcon = prItem?.querySelector('button[title="未読"]');
    expect(unreadIcon).toBeTruthy();

    await act(async () => {
      unreadIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    await view.unmount();

    expect(chromeMock.getLocalState()).toMatchObject({
      notifications: [
        {
          id: 'mention:ISSUE_1',
          kind: 'mention',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'Issue メンション',
          url: 'https://example.com/issues/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('読み込み中・空状態・メニュー表示を扱える', async () => {
    let localCallback: ((items: unknown) => void) | null = null;
    chromeMock.chrome.storage.local.get.mockImplementationOnce((query: unknown, callback: (items: unknown) => void) => {
      localCallback = callback;
    });
    chromeMock.setSyncState({
      enableNewItems: false,
      enableMentions: false,
      enableMentionThreads: false,
      enableAssigneeComments: false,
    });

    const view = await renderReact(<App />);

    expect(view.container.textContent).toContain('読み込み中...');

    await act(async () => {
      localCallback?.({
        notifications: [
          {
            id: 'mention:ISSUE_1',
            kind: 'mention',
            isPullRequest: false,
            owner: 'octo',
            repo: 'repo',
            number: 11,
            title: 'Issue メンション',
            url: 'https://example.com/issues/11',
            detectedAt: '2026-05-06T07:00:00.000Z',
          },
        ],
        readNotificationIds: [],
        badgeCount: 1,
      });
    });
    await flushPromises();

    expect(view.container.textContent).toContain('現在表示できる通知はありません。');

    const menuButton = findButton(view.container, 'メニュー');
    expect(menuButton).toBeTruthy();

    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('バージョン: 1.0.0');

    const openOptionsButton = findButton(view.container, '設定を開く');
    await act(async () => {
      openOptionsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(chromeMock.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  it('更新ボタン押下で background に message を送り、最新状態を再読込する', async () => {
    chromeMock.setLocalState({
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
    });
    chromeMock.chrome.runtime.sendMessage.mockImplementationOnce(
      (_message: unknown, callback?: (response: unknown) => void) => {
        chromeMock.setLocalState({
          notifications: [
            {
              id: 'new:ISSUE_99',
              kind: 'new',
              isPullRequest: false,
              owner: 'octo',
              repo: 'repo',
              number: 99,
              title: '更新後の通知',
              url: 'https://example.com/issues/99',
              detectedAt: '2026-05-06T10:00:00.000Z',
            },
          ],
          readNotificationIds: [],
          badgeCount: 1,
        });
        callback?.({ ok: true });
      },
    );

    const view = await renderReact(<App />);
    await flushPromises();

    const menuButton = findButton(view.container, 'メニュー');
    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const refreshButton = findButton(view.container, '更新');
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'refresh-watch-cycle' },
      expect.any(Function),
    );
    expect(view.container.textContent).toContain('更新後の通知');

    await view.unmount();
  });
});
