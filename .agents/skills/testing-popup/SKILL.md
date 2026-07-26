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
3. `chrome://extensions/` に表示される拡張 ID を控える。shadow DOM のため browser ツールから ID を読めない
   ことがある。unpacked 拡張の ID は絶対パスから決まるので次で計算できる:
   `python3 -c "import hashlib;p=b'/abs/path/dist';print(''.join(chr(ord('a')+int(c,16)) for c in hashlib.sha256(p).hexdigest()[:32]))"`
4. ページを直接開く:
   - popup: `chrome-extension://<id>/src/popup/index.html`
   - options: `chrome-extension://<id>/src/options/index.html`
5. ページの console からテストデータを注入する (拡張オリジンは chrome.storage にアクセス可能):
   - `chrome.storage.sync.set({ repos: [{owner,name,color}], isWatchPaused:false })`
   - `chrome.storage.local.set({ notifications: [StoredNotification...], readNotificationIds: [] })`
   - StoredNotification の形状 (`src/shared/notifications.ts` 参照): `id, sourceNodeId, isPullRequest, owner, repo, number, title, url, detectedAt (ISO), kinds[]`。
   - リポジトリ色の取得元: `repos[].color` (HEX)。既定のフォールバックは `DEFAULT_REPO_COLOR = '#0969da'` (`src/shared/repositories.ts`)。
6. ページをリロードする (popup はマウント時に storage を読む)。

注意点:
- browser ツールの console 実行はトップレベル `await` を使えない (module ではない)。`(() => { ... ; return 'ok'; })()` の即時関数で囲み、`chrome.storage.*.set` はコールバック無しで呼ぶ。
- スクリーンショットは実際のビューポートより縮小されて保存されることがある (例: 1600px 幅 → 1024px 画像。約 0.64 倍)。ピクセル幅を目視で判定せず、`getComputedStyle` / `getBoundingClientRect` の実測値で検証する。細部を残したい場合は `convert <png> -crop <W>x<H>+0+0 +repage -resize 200%` で popup 領域を切り出す。
- ヘッドレス相当の環境では `wmctrl` が使えない (ウィンドウマネージャ無し) ことがある。popup ページはビューポート左上に描画されるので、そのまま録画してよい。

## 通知一覧のグループ表示 (owner/repo) の検証

通知は `owner/repo` ごとにグループ化され、見出しは `button[aria-expanded]` + `▲`/`▼` インジケータ (`src/popup/App.tsx`)。

- 見出しと順序: `[...document.querySelectorAll('button[aria-expanded]')].map(b => b.textContent)` で取得。順序は `localeCompare` 昇順。**大文字始まりの owner (例 `Mid-Org`) を混ぜたテストデータにする** と、単純なコードポイント順との違いが検出できる。
- グループ内の並びは検出日時降順。storage への挿入順を意図的にバラバラ (古いものを先に) にしておくと、ソート漏れを検出できる。
- 展開/折りたたみ: 見出しをクリック → `aria-expanded` が false になり、配下 `li` が DOM から消え、インジケータが `▼` になる。他グループが影響を受けないことも確認する。
- 1 行レイアウトの崩れ検証 (項目行はタイトルリンク + 右寄せ kind チップ):
  - `title.getBoundingClientRect().right <= chips.getBoundingClientRect().left` (重なりなし)
  - スクロールコンテナの `scrollWidth - clientWidth === 0` (横オーバーフローなし)
  - 全行の `height` が一様 (チップの折返しで 2 行になっていない)
  - 長いタイトルは `a.scrollWidth > a.clientWidth` (ellipsis) になる → 長文タイトル + kind 3 個のデータを必ず入れる
  - popup ルート幅は `getComputedStyle(document.querySelector('#root>div')).width`、メニューは `getComputedStyle(document.getElementById('menu-popover')).width` で確認
- 該当 0 件のタブ: 見出しは 0 個で `No notifications available for this tab.` が出る。メニューの Repository 絞り込み (`button[aria-label="Repository:<owner/repo>"]`) で片方のタブを空にすると再現しやすい。
- メニュー popover は `popover="auto"`。閉じるには Escape キーを押す。

## リポジトリ色の縦ライン検証

リポジトリ色は popup の通知一覧で描画される (`src/popup/App.tsx` の `renderNotificationItem`)。各通知の `<li>` に `borderLeft: '3px solid <color>'` を付与し、`aria-label="リポジトリ色:<hex>"` を設定する。

- 設定色があるリポジトリ: `owner/repo` に一致する `repos[].color` の色。
- 色が未設定 / 一致なし: `DEFAULT_REPO_COLOR` (`#0969da`)。
- 確認方法:
  - `li.getAttribute('aria-label')` が `リポジトリ色:<hex>` になっている (HEX で厳密比較しやすい)。
  - `getComputedStyle(li).borderLeftWidth` が `3px`、`borderLeftStyle` が `solid`、`borderLeftColor` が期待色の RGB (例: `#e11d48` → `rgb(225, 29, 72)`) になっている。
- 注意: この縦ラインはリポジトリ色機能を含むビルドでのみ描画される。`main` に未マージの状態で古い `dist/` を読み込むと縦ラインは出ないため、必ず対象ブランチを `npm run build` した `dist/` を読み込むこと。

## options ページの設定検証

- 設定は `chrome.storage.sync`、実行時データは `chrome.storage.local`。保存後の検証は
  `chrome.storage.sync.get(null, r => { window.__r = JSON.stringify(r) })` で退避し、次の console 呼び出しで
  `window.__r` を読むのが確実（browser の console は Promise / `await` の戻り値を返さないことがある）。
- 「デフォルト ON」系のトグルは、対象キーを storage に**入れない**状態から開始して、
  `get(null)` の結果にキーが無いこと + UI が ON であることを併せて確認すると、既定値ロジックのバグを検出できる。
- 数値入力 (監視間隔) は `Ctrl+A` での全選択が効かないことがある。`Backspace`（`BackSpace` ではなく `Backspace`）を
  1 回ずつ送って消してから入力する。
- PAT ステータスは UI からダミー文字列を保存すれば `PAT configured` に変化する（実 PAT は不要）。

## 日本語 UI (i18n) の検証

`src/shared/i18n.ts` は `navigator.language` で言語を決めるため、Chrome for Testing (英語ロケールのみ) では
日本語表示にならない。`--lang=ja` で別プロファイル起動しても `navigator.language` は `en-US` のままなので効果がない。
回避策: `dist/` をコピーして `i18n.js` 内の `navigator.language` を `"ja"` に置換し、そのディレクトリを
2 つ目の unpacked 拡張として読み込む（`extensions=/path/to/dist,/tmp/dist-ja` で再起動）。
拡張 ID はディレクトリパスから決まるため別 ID・別 storage になる点に注意（設定は空から始まる）。
日本語表示の確認は「ラベル文言が ja.json の値と一致するか」だけに使い、永続化の検証は本番 dist 側で行うこと。

## 「完成形の kinds を注入するだけ」では不十分なロジック変更の検証 (harness ページ)

`mergeStoredNotifications` / `reconcileNotificationState` のような **storage に書く前のロジック** を変えた PR では、
完成形の `notifications` を storage に注入しても popup はそれをそのまま描画するだけなので、実装が壊れていても
同じ画面になる (= 意味のないテスト)。この場合は一時的なテスト専用ページを作り、実装本体の関数を拡張オリジンで
実行させる:

1. `src/harness/index.html` + `src/harness/main.ts` を作り、`main.ts` で `src/shared/notifications` から
   検証対象の関数を import して `window.harness = { ... }` に載せる。background 側だけにあるロジック
   (例: `runWatchCycle` の kinds 除外) は同じ式を harness に写して置く。
2. `vite.config.ts` の `rollupOptions.input` に `harness: resolve(__dirname, 'src/harness/index.html')` を追加して
   `npm run build`。
3. `chrome-extension://<id>/src/harness/index.html` を開き、console から「既存通知 + 今回検知した通知」を渡して
   実関数を実行 → 戻り値を `chrome.storage.local.set` → popup をリロードして描画確認。戻り値 (kinds / 
   addedNotifications / badgeCount) は `return JSON.stringify(...)` で同時に検証できる。
4. **テスト後に harness と vite.config.ts の変更を必ず削除し、再ビルドしてブランチをクリーンに戻す。**

## 既読化 / バッジの検証

`chrome.action.getBadgeText` の Promise 戻り値は browser console から取れないことがある。代わりに
`chrome.storage.local.get(['badgeCount','readNotificationIds'], r => console.log('X', JSON.stringify(r)))` を
実行し、次に console (引数なし) でログを読む。既読化 1 件でカウントが 1 減ることを確認する。

純粋な描画テストでは GitHub PAT / API は不要 — storage を直接注入する。

## Devin Secrets Needed
描画のみの popup テストでは不要。
