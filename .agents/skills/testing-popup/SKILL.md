---
name: Testing the popup/options UI (Chrome extension)
description: How to load and test the github-notify-ext popup/options pages end-to-end by injecting chrome.storage data, without hitting the GitHub API.
---

# Testing the popup / options UI

This is a Manifest V3 Chrome extension (React + Vite). To test popup/options rendering end-to-end:

1. Build: `npm ci && npm run build` → produces `dist/`.
2. Load the extension in Chrome. The browser tool can preload it via a restart with the extension dir:
   restart with `extensions=/absolute/path/to/repo/dist`. This avoids the native "Load unpacked" file picker (which the automation cannot drive).
   Alternatively enable Developer mode on `chrome://extensions/` and Load unpacked.
3. Note the extension ID shown on `chrome://extensions/`.
4. Open the page directly:
   - popup: `chrome-extension://<id>/src/popup/index.html`
   - options: `chrome-extension://<id>/src/options/index.html`
5. Inject test data via the page's console (extension origin has chrome.storage access):
   - `chrome.storage.sync.set({ repos: [{owner,name,color}], isWatchPaused:false })`
   - `chrome.storage.local.set({ notifications: [StoredNotification...], readNotificationIds: [] })`
   - StoredNotification shape (see `src/shared/notifications.ts`): `id, sourceNodeId, isPullRequest, owner, repo, number, title, url, detectedAt (ISO), kinds[]`.
   - Repo color source: `repos[].color` HEX; default fallback `DEFAULT_REPO_COLOR = '#0969da'` (`src/shared/repositories.ts`).
6. Reload the page — popup reads storage on mount. Verify with `getComputedStyle(li).borderLeftColor/Width/Style` for exact RGB assertions.

No GitHub PAT / API is needed for pure render tests — inject storage directly.

## Devin Secrets Needed
None for render-only popup testing.
