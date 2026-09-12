![](../assets/marquee.png)

# Repo Watcher Manual

## What this extension does

Repo Watcher is a Chrome extension that monitors Issues and Pull Requests in the repositories you specify.

You can mainly check the following notifications:

- New Issue / Pull Request
- Mentions of you
- New comments on issues or pull requests where you are the assignee

Notifications appear in the extension icon badge and on the popup screen.

![Image: Repo Watcher icon and unread count badge on the Chrome toolbar](./assets/01_toolbar_icon_badge.png)

## Prerequisites

- Chrome or a Chromium-based browser
- GitHub Personal Access Token (PAT)
- The owner/repository names of the repositories you want to watch

Create a PAT from GitHub's Settings > Developer settings. A fine-grained PAT is recommended.
When you choose All repositories or Only select repositories, the required permissions are:

- Metadata: Read-only
- Issues: Read-only
- Pull requests: Read-only

![](./assets/generate_token.png)

> [!note]
>
> - If you want to monitor Internal/Private repositories under an organization, set the resource owner to the organization.
> - If you create a classic PAT, grant the repo permission.

## Initial setup

After loading the extension, open the settings page.

How to open it:

- Click the extension icon
- Open the popup menu in the top-right
- Select Open Settings

![Image: Popup menu with Open Settings selected](./assets/02_popup_menu_open_settings.png)

![Image: Open Settings screen](./assets/03_options_page.png)

### API key (PAT)

1. Enter your GitHub PAT in the API Key (PAT) field.
2. Click Save.

The PAT is encrypted and stored in the extension's local storage.

### Notification settings

The following settings are available:

- Notify about draft PRs
  When enabled, draft PRs are also included in the badge and the notification list.
- Automatically remove closed items
  When enabled, PRs / Issues that are already closed are automatically removed from the notification list during updates.
- Enable notifications for all issues
  When disabled, issue changes are not included in the badge or the notification list.
  The Issue tab remains hidden.
- Only notify about issues assigned to me
  When enabled, only issues where you are the assignee are included in the badge and the notification list.
  This option is available only when "Enable notifications for all issues" is turned on.
- Automatically remove expired notifications
  When the extension starts, notifications whose last update is older than the configured number of days are automatically removed.

### Watched repositories

1. Click Repository settings.
2. Add repositories to watch in owner/repository format.
3. Set a display color if needed.
4. Click OK.
5. Finally, click Save on the settings page.

The display color is used as the left strip color for notifications in the popup.

![Image: Repository settings dialog where you enter the owner/repository and display color](./assets/04_repository_settings_dialog.png)

### Watch interval

The watch interval is configured in minutes. The minimum is 15 minutes.

### Last checked

The Last checked field shows the latest time the notification content was fetched.

Click Reset to clear the saved timestamp. The next update will re-fetch notifications using 00:00:00 of the current day as the baseline.

## Viewing notifications

In the popup, you can switch between the Pull Request and Issue tabs.

Each notification lets you check the following information:

- Title: The PR / Issue title. Selecting it opens the relevant page on GitHub.
- Notification kind label: Indicates the state, such as PR / Issue status or a mention.
- Repository color: The configured repository color is shown as a left-side strip.
- Comment count: The number of comments. Selecting it opens the latest relevant comment on GitHub.
- Read / Unread state: Check the item and close the popup to exclude it from the list the next time you open it.

Meaning of notification labels:

- New: Newly created since the last check
- Updated: An existing item that was updated
- Mention: A mention of you was detected
- Thread: A new comment was added to an unresolved review thread that previously mentioned you
- Assignee: You are the assignee and a new comment was posted
- Draft: Draft PR
- Approved: The PR has an approval review
- Changes requested: The PR has a changes requested review

![Image: Popup showing Pull Request and Issue tabs, labels, comment counts, and read/unread toggles](./assets/05_popup_tabs_labels_comments_read.png)

## Icon menu

### Pause and resume periodic watching

Press the pause button in the top-right of the popup to stop periodic watching. Press it again to resume.

You can still manually refresh while paused.

### Manual refresh

Press the refresh button in the top-right of the popup to run the watch cycle immediately.

### Toggle read/unread

- Use the left-side button on each notification to toggle Read / Unread.
- Use the check button in the top-right to mark all items in the current view as read or unread.

Read items are excluded from the unread count.

Items marked read remain visible while the popup is open. Reopening the popup removes them from the list.

### Menu

- Open Repository from the popup menu to filter the view by configured repositories.
- Open Options to open the settings page.
- View version information.

![Image: Popup repository filter with multiple repositories selected](./assets/06_popup_repository_filter.png)

## Troubleshooting: notifications not appearing

Check the following in order:

1. Is a PAT configured?
2. Does the PAT have the required permissions?
3. Are the watched repositories configured correctly?
4. Is periodic watching paused?
5. Is the watch interval too long?
6. Does a manual refresh show an error?

Reset the Last checked time and then run a manual refresh to re-check using 00:00:00 of the current day as the baseline.

## Notes

- The notification list is managed primarily around unread items; read notifications are not retained.
- Whether draft PRs are shown depends on the Include draft PRs setting.
- Remember to click Save after changing settings for them to take effect.
