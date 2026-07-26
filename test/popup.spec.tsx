import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../src/popup/App';
import type { StoredNotification } from '../src/shared/notifications';
import { createChromeMock, type ChromeMockController } from './helpers/chromeMock';
import { flushPromises, renderReact } from './helpers/react';

declare const global: typeof globalThis & { chrome: ChromeMockController['chrome'] };

function findClickableItem(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('li[aria-label^="リポジトリ色:"]')).find((item) =>
    item.textContent?.includes(text),
  );
}

function findLinkByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('a')).find((link) => link.textContent?.includes(text));
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text));
}

function findTab(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button[role="tab"]')).find((button) => button.textContent === text);
}

function findButtonByAriaLabel(container: HTMLElement, label: string) {
  return container.querySelector(`button[aria-label="${label}"]`);
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

  it('通知を PR / Issue タブで切り替えて表示し、既定では PR タブを選択する', async () => {
    const notifications: StoredNotification[] = [
      {
        id: 'PR_1',
        kinds: ['new', 'mention'],
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
      readNotificationIds: [],
      badgeCount: 2,
    });
    chromeMock.setSyncState({
      repos: [],
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const pullRequestTab = findTab(view.container, 'Pull Request');
    const issueTab = findTab(view.container, 'Issue');
    expect(pullRequestTab).toBeTruthy();
    expect(issueTab).toBeTruthy();
    expect(pullRequestTab?.getAttribute('aria-selected')).toBe('true');
    expect(issueTab?.getAttribute('aria-selected')).toBe('false');
    expect(view.container.textContent).toContain('PR 通知');
    expect(view.container.textContent).not.toContain('Issue メンション');
    expect(view.container.textContent).not.toContain('担当通知');
    expect(view.container.textContent).toContain('新規');
    expect(view.container.textContent).toContain('メンション');
    expect(view.container.querySelectorAll('[title="既読"]')).toHaveLength(0);
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(1);

    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(pullRequestTab?.getAttribute('aria-selected')).toBe('false');
    expect(issueTab?.getAttribute('aria-selected')).toBe('true');
    expect(view.container.textContent).toContain('Issue メンション');
    expect(view.container.textContent).toContain('担当通知');
    expect(view.container.textContent).toContain('メンション');
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(2);

    await view.unmount();
  });

  it('ドラフト PR 通知設定が OFF のとき一覧と badge からドラフト PR を除外する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_DRAFT',
          isPullRequest: true,
          isDraft: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'ドラフト PR',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_READY',
          isPullRequest: true,
          isDraft: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: '通常 PR',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
    });
    chromeMock.setSyncState({ notifyDraftPr: false });

    const view = await renderReact(<App />);
    await flushPromises();

    expect(view.container.textContent).not.toContain('ドラフト PR');
    expect(view.container.textContent).toContain('通常 PR');
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

    await view.unmount();
  });

  it('既読/未読アイコンのクリックで既読状態と badge だけを切り替える', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'ISSUE_1',
          kinds: ['mention'],
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
      readNotificationIds: ['PR_1'],
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
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(1);

    await view.unmount();
  });

  it('全既読/未読アイコンは一覧の状態に応じて変化し、クリックで表示中一覧を一括切り替えする', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知 1',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_2',
          kinds: ['mention'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'PR 通知 2',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
        {
          id: 'ISSUE_1',
          kinds: ['mention'],
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 12,
          title: 'Issue 通知',
          url: 'https://example.com/issues/12',
          detectedAt: '2026-05-06T06:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 3,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const bulkToggleButton = () =>
      findButtonByAriaLabel(view.container, 'Mark all as read') ??
      findButtonByAriaLabel(view.container, 'Mark visible list as read') ??
      findButtonByAriaLabel(view.container, 'Mark all as unread');

    expect(findButtonByAriaLabel(view.container, 'Mark all as read')).toBeTruthy();

    await act(async () => {
      bulkToggleButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: ['PR_1', 'PR_2'],
      badgeCount: 1,
    });
    expect(findButtonByAriaLabel(view.container, 'Mark all as unread')).toBeTruthy();

    await act(async () => {
      bulkToggleButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: [],
      badgeCount: 3,
    });
    expect(findButtonByAriaLabel(view.container, 'Mark all as read')).toBeTruthy();

    const prItem = findClickableItem(view.container, 'PR 通知 1');
    const unreadIcon = prItem?.querySelector('button[title="未読"]');
    expect(unreadIcon).toBeTruthy();

    await act(async () => {
      unreadIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(findButtonByAriaLabel(view.container, 'Mark visible list as read')).toBeTruthy();

    await act(async () => {
      bulkToggleButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: ['PR_1', 'PR_2'],
      badgeCount: 1,
    });
    expect(findButtonByAriaLabel(view.container, 'Mark all as unread')).toBeTruthy();

    const issueTab = findTab(view.container, 'Issue');
    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(findButtonByAriaLabel(view.container, 'Mark all as read')).toBeTruthy();

    await view.unmount();
  });

  it('タイトルを別タブ用のリンクとして表示し、項目自体のクリックでは遷移しない', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
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

    const contentLink = findLinkByText(view.container, 'PR 通知');
    expect(contentLink).toBeTruthy();
    expect(contentLink?.getAttribute('href')).toBe('https://example.com/pr/10');
    expect(contentLink?.getAttribute('target')).toBe('_blank');

    await act(async () => {
      findClickableItem(view.container, '新規PR 通知')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.getLocalState()).toMatchObject({
      readNotificationIds: [],
      badgeCount: 1,
    });
    expect(view.container.querySelectorAll('[title="未読"]')).toHaveLength(1);

    await view.unmount();
  });

  it('通知項目の左端に設定済みリポジトリの色で縦ラインを描画する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'colored',
          number: 10,
          title: '色付き PR',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_2',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'plain',
          number: 11,
          title: 'デフォルト色 PR',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
    });
    chromeMock.setSyncState({
      repos: [{ owner: 'octo', name: 'colored', color: '#ff0000' }],
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const coloredItem = findClickableItem(view.container, '色付き PR');
    const plainItem = findClickableItem(view.container, 'デフォルト色 PR');
    expect(coloredItem?.style.borderLeftWidth).toBe('3px');
    expect(coloredItem?.style.borderLeftStyle).toBe('solid');
    expect(coloredItem?.style.borderLeftColor).toBe('rgb(255, 0, 0)');
    expect(coloredItem?.style.borderRadius).toBe('0');
    expect(coloredItem?.getAttribute('aria-label')).toBe('リポジトリ色:#ff0000');
    expect(plainItem?.style.borderLeftWidth).toBe('3px');
    expect(plainItem?.style.borderLeftColor).toBe('rgb(9, 105, 218)');
    expect(plainItem?.getAttribute('aria-label')).toBe('リポジトリ色:#0969da');

    await view.unmount();
  });

  it('承認済み PR には緑ラベルを表示し、未承認では表示しない', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          isApproved: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: '承認済み PR',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_2',
          kinds: ['new'],
          isPullRequest: true,
          isApproved: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: '未承認 PR',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
        {
          id: 'PR_3',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 12,
          title: '未指定 PR',
          url: 'https://example.com/pr/12',
          detectedAt: '2026-05-06T06:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 3,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const findApprovedLabel = (title: string) => {
      const item = findClickableItem(view.container, title);

      return Array.from(item?.querySelectorAll('span') ?? []).find(
        (span) => (span as HTMLElement).style.backgroundColor === 'rgb(26, 127, 55)',
      ) as HTMLElement | undefined;
    };

    const approvedLabel = findApprovedLabel('承認済み PR');
    expect(approvedLabel).toBeTruthy();
    expect(approvedLabel?.style.borderRadius).toBe('10px');
    expect(approvedLabel?.style.fontSize).toBe('10px');
    expect(findApprovedLabel('未承認 PR')).toBeUndefined();
    expect(findApprovedLabel('未指定 PR')).toBeUndefined();

    await view.unmount();
  });

  it('最新の API 結果にない通知は薄いグレー背景で表示する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          sourceNodeId: 'PR_1',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: '残っている PR',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
          isPresentInLatestResult: true,
        },
        {
          id: 'PR_2',
          kinds: ['mention'],
          sourceNodeId: 'PR_2',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'close 済み PR',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
          isPresentInLatestResult: false,
        },
      ],
      readNotificationIds: [],
      badgeCount: 2,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    expect(findClickableItem(view.container, '残っている PR')?.style.backgroundColor).toBe('transparent');
    expect(findClickableItem(view.container, 'close 済み PR')?.style.backgroundColor).toBe('rgb(246, 248, 250)');

    await view.unmount();
  });

  it('popup を閉じたときに既読通知を一覧から除去する', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'ISSUE_1',
          kinds: ['mention'],
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
          id: 'ISSUE_1',
          kinds: ['mention'],
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

  it('popup を開いた時点で既読の Issue 通知は一覧から除去して再表示しない', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          sourceNodeId: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 10,
          title: 'PR 通知',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'ISSUE_1',
          sourceNodeId: 'ISSUE_1',
          kinds: ['mention'],
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 11,
          title: 'Issue メンション',
          url: 'https://example.com/issues/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
      ],
      readNotificationIds: ['ISSUE_1'],
      badgeCount: 2,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    expect(findClickableItem(view.container, 'PR 通知')).toBeTruthy();
    expect(view.container.textContent).not.toContain('Issue メンション');
    expect(chromeMock.getLocalState()).toMatchObject({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
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
    expect(chromeMock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

    await view.unmount();
  });

  it('読み込み中・空状態・メニュー表示を扱える', async () => {
    let localCallback: ((items: unknown) => void) | null = null;
    chromeMock.chrome.storage.local.get.mockImplementationOnce((query: unknown, callback: (items: unknown) => void) => {
      localCallback = callback;
    });
    chromeMock.setSyncState({
      repos: [],
    });

    const view = await renderReact(<App />);

    expect(view.container.textContent).toContain('Loading...');

    await act(async () => {
      localCallback?.({
        notifications: [
          {
            id: 'mention:ISSUE_1',
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

    expect(view.container.textContent).toContain('No notifications available for this tab.');

    const menuButton = findButtonByAriaLabel(view.container, 'Menu');
    expect(menuButton).toBeTruthy();

    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('Version: 1.0.0');
    expect(view.container.textContent).toContain('Repository');

    const menuPopover = view.container.querySelector('#menu-popover');
    expect(menuPopover?.getAttribute('data-popover-open')).toBe('true');

    const openOptionsButton = findButton(view.container, 'Open Settings');
    await act(async () => {
      openOptionsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(chromeMock.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    expect(menuPopover?.getAttribute('data-popover-open')).toBeNull();

    await view.unmount();
  });

  it('メニューの外側をクリックすると閉じる', async () => {
    const view = await renderReact(<App />);
    await flushPromises();

    const menuButton = findButtonByAriaLabel(view.container, 'Menu');
    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const menuPopover = view.container.querySelector('#menu-popover');
    expect(menuPopover?.getAttribute('data-popover-open')).toBe('true');

    // jsdom は Popover API の light-dismiss を実装していないため、テスト用モックで再現する。
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(menuPopover?.getAttribute('data-popover-open')).toBeNull();

    await view.unmount();
  });

  it('updated 通知も一覧に表示できる', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'updated:ISSUE_20',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo',
          number: 20,
          title: '更新通知',
          url: 'https://example.com/issues/20',
          detectedAt: '2026-05-06T09:10:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
    });
    chromeMock.setSyncState({
      repos: [],
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const issueTab = findTab(view.container, 'Issue');
    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('更新通知');
    expect(view.container.textContent).toContain('更新');

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
              id: 'ISSUE_99',
              kinds: ['new'],
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

    const headerButtons = Array.from(
      view.container.querySelectorAll('header > div:first-of-type button[aria-label]'),
    ).map((button) => button.getAttribute('aria-label'));
    expect(headerButtons).toEqual(['Pause scheduled watch', 'Update', 'Mark all as read', 'Menu']);

    const refreshButton = findButtonByAriaLabel(view.container, 'Update');
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'refresh-watch-cycle' },
      expect.any(Function),
    );
    expect(view.container.textContent).toContain('No notifications available for this tab.');

    const issueTab = findTab(view.container, 'Issue');
    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('更新後の通知');

    await view.unmount();
  });

  it('定期監視の一時停止/再開ボタンは保存済み状態に応じて表示を切り替え、押下で永続状態を反転する', async () => {
    chromeMock.setLocalState({
      notifications: [],
      readNotificationIds: [],
      badgeCount: 0,
    });
    chromeMock.setSyncState({
      repos: [],
      isWatchPaused: true,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const resumeButton = findButtonByAriaLabel(view.container, 'Resume scheduled watch');
    expect(resumeButton).toBeTruthy();

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getSyncState()).toMatchObject({
      isWatchPaused: false,
    });
    expect(findButtonByAriaLabel(view.container, 'Pause scheduled watch')).toBeTruthy();

    const pauseButton = findButtonByAriaLabel(view.container, 'Pause scheduled watch');
    await act(async () => {
      pauseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.getSyncState()).toMatchObject({
      isWatchPaused: true,
    });
    expect(findButtonByAriaLabel(view.container, 'Resume scheduled watch')).toBeTruthy();

    await view.unmount();
  });

  it('メニュー内の Repository サブメニューで設定済みリポジトリを切り替えて一覧を絞り込む', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo-a',
          number: 10,
          title: 'repo-a の PR',
          url: 'https://example.com/pr/10',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_2',
          kinds: ['new'],
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo-b',
          number: 11,
          title: 'repo-b の PR',
          url: 'https://example.com/pr/11',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
        {
          id: 'mention:ISSUE_1',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo-a',
          number: 12,
          title: 'repo-a の Issue',
          url: 'https://example.com/issues/12',
          detectedAt: '2026-05-06T06:00:00.000Z',
        },
        {
          id: 'mention:ISSUE_2',
          isPullRequest: false,
          owner: 'octo',
          repo: 'repo-b',
          number: 13,
          title: 'repo-b の Issue',
          url: 'https://example.com/issues/13',
          detectedAt: '2026-05-06T05:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 4,
    });
    chromeMock.setSyncState({
      repos: [
        { owner: 'octo', name: 'repo-a' },
        { owner: 'octo', name: 'repo-b' },
        { owner: 'octo', name: 'repo-c' },
      ],
    });

    const view = await renderReact(<App />);
    await flushPromises();

    expect(view.container.textContent).toContain('repo-a の PR');
    expect(view.container.textContent).toContain('repo-b の PR');

    const menuButton = findButtonByAriaLabel(view.container, 'Menu');
    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const repositoryButton = findButtonByAriaLabel(view.container, 'Repository');
    expect(repositoryButton).toBeTruthy();

    await act(async () => {
      repositoryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('octo/repo-a');
    expect(view.container.textContent).toContain('octo/repo-b');
    expect(view.container.textContent).toContain('octo/repo-c');

    const repoAOption = findButtonByAriaLabel(view.container, 'Repository:octo/repo-a');
    expect(repoAOption).toBeTruthy();

    await act(async () => {
      repoAOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(chromeMock.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('repo-a の PR');
    expect(view.container.textContent).not.toContain('repo-b の PR');

    const issueTab = findTab(view.container, 'Issue');
    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('repo-a の Issue');
    expect(view.container.textContent).not.toContain('repo-b の Issue');

    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const reopenedRepositoryButton = findButtonByAriaLabel(view.container, 'Repository');
    await act(async () => {
      reopenedRepositoryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const repoBOption = findButtonByAriaLabel(view.container, 'Repository:octo/repo-b');
    expect(repoBOption).toBeTruthy();

    await act(async () => {
      repoBOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('repo-a の Issue');
    expect(view.container.textContent).toContain('repo-b の Issue');

    const selectedRepoAOption = findButtonByAriaLabel(view.container, 'Repository:octo/repo-a');
    expect(selectedRepoAOption).toBeTruthy();

    await act(async () => {
      selectedRepoAOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).not.toContain('repo-a の Issue');
    expect(view.container.textContent).toContain('repo-b の Issue');

    const selectedRepoBOption = findButtonByAriaLabel(view.container, 'Repository:octo/repo-b');
    expect(selectedRepoBOption).toBeTruthy();

    await act(async () => {
      selectedRepoBOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('repo-a の Issue');
    expect(view.container.textContent).toContain('repo-b の Issue');

    await view.unmount();
  });

  it('通知をリポジトリごとにまとめ、見出しのクリックで展開と折りたたみを切り替える', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_Z',
          isPullRequest: true,
          owner: 'z-owner',
          repo: 'repo',
          number: 1,
          title: '古い通知',
          url: 'https://example.com/pr/1',
          detectedAt: '2026-05-06T07:00:00.000Z',
        },
        {
          id: 'PR_A',
          isPullRequest: true,
          owner: 'a-owner',
          repo: 'repo',
          number: 2,
          title: '先に表示する通知',
          url: 'https://example.com/pr/2',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
        {
          id: 'PR_A_OLD',
          isPullRequest: true,
          owner: 'a-owner',
          repo: 'repo',
          number: 3,
          title: '後に表示する通知',
          url: 'https://example.com/pr/3',
          detectedAt: '2026-05-06T06:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 3,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const groupButtons = () => Array.from(view.container.querySelectorAll('button[aria-expanded]'));
    expect(groupButtons().map((button) => button.textContent?.replace('▲', '').replace('▼', '').trim())).toEqual([
      'a-owner/repo',
      'z-owner/repo',
    ]);
    expect(groupButtons().every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true);

    const notificationLinks = () => Array.from(view.container.querySelectorAll('li[aria-label^="リポジトリ色:"] a'));
    expect(notificationLinks().map((link) => link.textContent)).toEqual([
      '先に表示する通知',
      '後に表示する通知',
      '古い通知',
    ]);

    await act(async () => {
      groupButtons()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(groupButtons()[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent).not.toContain('先に表示する通知');
    expect(view.container.textContent).not.toContain('後に表示する通知');
    expect(view.container.textContent).toContain('古い通知');

    await view.unmount();
  });

  it('表示対象の通知がないタブではリポジトリ見出しを表示しない', async () => {
    chromeMock.setLocalState({
      notifications: [
        {
          id: 'PR_1',
          isPullRequest: true,
          owner: 'octo',
          repo: 'repo',
          number: 1,
          title: 'PR 通知',
          url: 'https://example.com/pr/1',
          detectedAt: '2026-05-06T08:00:00.000Z',
        },
      ],
      readNotificationIds: [],
      badgeCount: 1,
    });

    const view = await renderReact(<App />);
    await flushPromises();

    const issueTab = findTab(view.container, 'Issue');
    await act(async () => {
      issueTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(view.container.textContent).toContain('No notifications available for this tab.');
    expect(view.container.querySelectorAll('button[aria-expanded]')).toHaveLength(0);
    expect(view.container.textContent).not.toContain('octo/repo');

    await view.unmount();
  });
});
