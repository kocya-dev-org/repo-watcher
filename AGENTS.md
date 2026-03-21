# エージェント向けリポジトリガイド

## 目的

このリポジトリは、GitHub 上のアクティビティを監視し、次の通知を表示する Chrome 拡張です。

- 新しい Issue / Pull Request
- 認証済みユーザーへのメンション
- 過去にユーザーへメンションがあった未解決レビュー スレッドへの新規コメント
- ユーザーがアサインされている Issue / Pull Request への新規コメント

実装は TypeScript で行われており、GitHub GraphQL v4 を `@octokit/graphql` 経由で利用しています。

## 最初に確認するファイル

作業を始めるときは、概ね次の順番で確認してください。

1. `AGENTS.md`
   このファイルです。リポジトリ全体の作業ルール、構成、注意点をまとめています。
2. `spec.md`
   機能要件、UI 要件、GraphQL ベースの検知設計の意図を定義しています。
3. `tasks.md`
   完了済み・未完了・検討中の進捗を管理しています。
4. `package.json`
   build、test、lint、format の正式な npm script を定義しています。
5. `src/background/index.ts`
   現在の挙動を決める中心実装です。

## 基本ルール

- 会話とコードコメントは、明確な理由がない限り日本語を使ってください。
- 1 つのコミットは 1 つの機能、または 1 つの修正に集中させてください。
- コミットメッセージは Conventional Commits に従ってください。
- TypeScript の型を積極的に付け、挙動をできるだけ未型付けのまま残さないでください。
- コメントが必要な場合は、必要最小限かつ JSDoc 形式を優先してください。
- 新しい外部ライブラリを追加する前に、必ず確認を取ってください。

## リポジトリ構成

- `src/background/index.ts`
  バックグラウンドの service worker です。アラーム設定、GitHub ポーリング、通知検知、バッジ更新、storage 書き込みを担当します。
- `src/popup/*`
  拡張アイコンから開くポップアップ UI です。`chrome.storage.local` の通知状態を読み取り、PR と Issue をグループ化し、対象をタブで開き、既読化を行います。
- `src/options/*`
  設定 UI です。`chrome.storage.sync` を通して設定を読み書きします。
- `public/manifest.json`
  Chrome extension manifest v3 の定義です。
- `test/background.spec.ts`
  バックグラウンド登録と Chrome API モック周辺の軽量なスモークテストです。
- `dist/`
  Chrome に unpacked extension として読み込むための Vite ビルド成果物です。

## 現在のアーキテクチャ

この拡張は現在、Vite により次の 3 つのエントリーポイントをビルドします。

- background service worker: `src/background/index.ts`
- popup page: `src/popup/index.html` -> `src/popup/index.tsx`
- options page: `src/options/index.html` -> `src/options/index.tsx`

状態管理は Chrome storage に分かれています。

- `chrome.storage.sync`
  PAT、監視対象リポジトリ、ポーリング間隔、通知トグルなど、ユーザーが編集する設定を保持します。
- `chrome.storage.local`
  `lastCheckedAt`、`notifications`、`badgeCount`、`readNotificationIds` など、実行時データを保持します。

重要な実行フローは次のとおりです。

1. `onInstalled` で `setupAlarms` を呼びます。
2. `chrome.alarms` が `runWatchCycle` を起動します。
3. `runWatchCycle` が設定を読み込み、GitHub GraphQL クライアントを作成し、`viewer.login` を取得し、検索クエリを実行し、通知項目を導出して、統合済み通知を local storage に保存します。
4. Popup は local storage を読み込み、有効な通知種別で絞り込み、開いた項目を既読化します。

## ドキュメントの位置付け

- `spec.md` は、プロダクトとして意図する挙動とクエリ戦略を定義します。
- `tasks.md` は、実装状況と残課題を把握するための最重要ドキュメントです。
- `README.md` は現時点ではプレースホルダーに近く、信頼できる設計資料として扱わないでください。
- この `AGENTS.md` は、ほかの資料より詳細な説明が追加されても守るべき作業規約を含みます。
- `spec.md` と `tasks.md` と実装が食い違う場合は、その差分を明示してください。

## 実装上の制約と注意点

- 実質的な主要ロジックは `src/background/index.ts` に集中しています。ここへの変更は、ポーリング、storage 形式、バッジ挙動、popup 挙動へ同時に影響します。
- popup と background は、明示的に共有型がない storage 契約に依存しています。通知データ形状を変える場合は両方を一緒に更新してください。
- 設定データ形状を変える場合は、options UI と background の設定読み込みロジックを一緒に更新してください。
- PAT は現状では平文に近い形で保存されています。`spec.md` に暗号化の記述があっても、それは将来課題であり、実装済みとみなしてはいけません。
- OS 通知はドキュメント上の計画に含まれていますが、現在の background 実装は主にバッジ状態更新と local storage 更新を担っています。
- テストは最小限で、動作レベルの十分な網羅ではなくスモークテスト寄りです。
- `tsconfig.json` は `src` のみを含んでいるため、テストファイルは TypeScript コンパイル対象外です。
- `public/manifest.json` の `options_page` と `default_popup` は `src/.../*.html` を指しています。エントリーポイントやファイル名、バンドル設定を触るときは `vite.config.ts` と合わせて確認してください。

## 変更時の実装ルール

- 通知挙動、バッジロジック、storage key を変更する場合は、まず `src/background/index.ts` を確認してください。
- 通知データの shape を変える場合は、background と popup の両方を更新してください。
- 設定の shape を変える場合は、options UI と background の両方を更新してください。
- エントリーポイント、ファイル名、拡張ページの変更時は、`public/manifest.json` と `vite.config.ts` を必ずセットで再確認してください。
- 新しいライブラリ導入は事前確認が必要です。

## 推奨ワークフロー

使用する npm script は `package.json` を正とし、主に次を使います。

- `npm run build`
- `npm run test`
- `npm run lint`
- `npm run format`

機能追加や修正では、可能な限り次の順序で進めてください。

1. 実装する
2. `npm run build` でビルド確認する
3. テストを追加または更新する
4. `npm run test` を実行する
5. `npm run lint` を実行する
6. `npm run format` を実行する

検証に失敗し、原因や修正方針が明確でない場合は、推測で直しにいかず、ブロッカーとして明示してください。

## 特に壊しやすい箇所

- background、popup、options 間で共有される storage schema
- GraphQL クエリ形状と `Issue` / `PullRequest` の扱いの前提
- 通知追加時や既読化時の badge count 管理
- Chrome extension manifest と Vite 出力パスの整合性
- PAT の取り扱いに関する表現と実装の乖離
