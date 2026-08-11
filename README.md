# Repo Watcher

[![Build Status](https://github.com/kocya-dev/repo-watcher/actions/workflows/build-artifact.yml/badge.svg)](https://github.com/kocya-dev/repo-watcher/actions/workflows/build-artifact.yml)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

[English](README.md) | [日本語](README_ja.md)

`Track GitHub PRs and Issues effortlessly from your browser.`

Repo Watcher is a Chrome extension that monitors updates to GitHub issues and pull requests.

This repository contains the source code for the Chrome extension itself. It is not a standalone CLI tool or desktop application. To use it, you need to load it as an extension in a Chromium-based browser and configure a GitHub Personal Access Token and the repositories you want to watch.

## Features

- Notifications for new issues and pull requests
- Detection of items that mention you
- Detection of items assigned to you
- Badge counts for unread notifications
- A popup UI for viewing notifications and marking them as read
- An options page for managing watched repositories, polling interval, notification settings, and your PAT

## What this software is

Repo Watcher periodically checks the GitHub API and surfaces changes from selected repositories through a Chrome extension.

The main parts are:

- background service worker: calls the GitHub GraphQL API, collects notification candidates, removes duplicates, and updates the badge state
- popup: shows stored notifications, marks them as read, supports manual refresh, and displays the paused state
- options: manages the PAT, watched repositories, polling interval, and notification options

## Requirements

- Chrome or another Chromium-based browser
- A GitHub Personal Access Token
- GitHub repositories you want to monitor

This extension is meant to supplement your GitHub notification workflow. It is only useful when used with a GitHub account in a browser environment.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

After the build completes, load the generated dist directory into Chrome as an unpacked extension.

### 3. Load it into Chrome

1. Open the Extensions management page in Chrome.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the dist directory from this repository.

### 4. Configure it

From the extension's options page, configure the following:

- GitHub Personal Access Token
- Repositories to watch
- Polling interval
- Whether draft pull requests should be included
- Whether closed notifications should be removed from the list automatically

## Development

Main commands:

```bash
npm run build
npm run test
npm run lint
npm run format
```

Core files:

- src/background/index.ts: entry point for the background service worker
- src/background/watchCycle.ts: core watch-cycle logic
- src/popup/App.tsx: popup UI
- src/options/optionsApp.tsx: options UI

## Permissions and Behavior

The manifest primarily uses the following permissions:

- storage
- alarms
- access to https://api.github.com/*

Watch data and read-state data are stored in Chrome storage. User settings and runtime data are managed separately.

## Limitations

- It only works as a Chrome extension.
- It requires an environment that can access the GitHub API.
- Watching cannot run until a PAT is configured.
- No notifications are generated if no repositories are configured.

## License

[MIT License](LICENSE)
