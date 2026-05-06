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

  it('通知クリック時に新しいタブを開き、既読と badge を更新する', async () => {
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

    await act(async () => {
      prItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/pr/10' });
    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: ['new:PR_1'],
      badgeCount: 1,
    });
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(view.container.querySelectorAll('[title="既読"]')).toHaveLength(1);

    await view.unmount();
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
});
