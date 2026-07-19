---
name: popup/options UI のテスト (Chrome 拡張)
description: github-notify-ext の popup / options ページを、chrome.storage にデータを注入してエンドツーエンドで描画確認する手順。GitHub API を呼ばずに検証する。
---

# popup / options UI のテスト

これは Manifest V3 の Chrome 拡張 (React + Vite)。popup / options の描画をエンドツーエンドで確認する手順:

1. ビルド: `npm ci && npm run build` → `dist/` が生成される。
2. 拡張を Chrome に読み込む。browser ツールは拡張ディレクトリを指定した再起動でプリロードできる:
   `extensions=/absolute/path/to/repo/dist` を指定して再起動する。これにより「パッケージ化されていない拡張機能を読み込む」のネイティブ ファイル ピッカー (自動化では操作不可) を回避できる。
   あるいは `chrome://extensions/` でデベロッパーモードを有効にして「パッケージ化されていない拡張機能を読み込む」でも良い。
3. `chrome://extensions/` に表示される拡張 ID を控える。
4. ページを直接開く:
   - popup: `chrome-extension://<id>/src/popup/index.html`
   - options: `chrome-extension://<id>/src/options/index.html`
5. ページの console からテストデータを注入する (拡張オリジンは chrome.storage にアクセス可能):
   - `chrome.storage.sync.set({ repos: [{owner,name,color}], isWatchPaused:false })`
   - `chrome.storage.local.set({ notifications: [StoredNotification...], readNotificationIds: [] })`
   - StoredNotification の形状 (`src/shared/notifications.ts` 参照): `id, sourceNodeId, isPullRequest, owner, repo, number, title, url, detectedAt (ISO), kinds[]`。
   - リポジトリ色の取得元: `repos[].color` (HEX)。既定のフォールバックは `DEFAULT_REPO_COLOR = '#0969da'` (`src/shared/repositories.ts`)。
6. ページをリロードする (popup はマウント時に storage を読む)。

## リポジトリ色の縦ライン検証

リポジトリ色は popup の通知一覧で描画される (`src/popup/App.tsx` の `renderNotificationItem`)。各通知の `<li>` に `borderLeft: '3px solid <color>'` を付与し、`aria-label="リポジトリ色:<hex>"` を設定する。

- 設定色があるリポジトリ: `owner/repo` に一致する `repos[].color` の色。
- 色が未設定 / 一致なし: `DEFAULT_REPO_COLOR` (`#0969da`)。
- 確認方法:
  - `li.getAttribute('aria-label')` が `リポジトリ色:<hex>` になっている (HEX で厳密比較しやすい)。
  - `getComputedStyle(li).borderLeftWidth` が `3px`、`borderLeftStyle` が `solid`、`borderLeftColor` が期待色の RGB (例: `#e11d48` → `rgb(225, 29, 72)`) になっている。
- 注意: この縦ラインはリポジトリ色機能を含むビルドでのみ描画される。`main` に未マージの状態で古い `dist/` を読み込むと縦ラインは出ないため、必ず対象ブランチを `npm run build` した `dist/` を読み込むこと。

純粋な描画テストでは GitHub PAT / API は不要 — storage を直接注入する。

## Devin Secrets Needed
描画のみの popup テストでは不要。
