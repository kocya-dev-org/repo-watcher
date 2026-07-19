# Copilot Instructions

## 会話ルール

- **確認対象がある場合は必須**: `AskUserQuestion` ツールで「過去のみ」か「未来を含む」かをユーザーに質問する
  - **重要**: 複数のカラムがある場合でも、**1回の `AskUserQuestion` ツール呼び出しで複数の質問（questions配列）を使用**する
  - 質問形式：「カラム `{カラム名}` は過去のみですか、未来も含みますか?」
  - 選択肢：
    - 「過去のみ（過去分詞形推奨）」：そのカラムは常に過去の日時のみを指します。過去分詞形（例: `paid_at`、`started_on`）を推奨します。
    - 「未来を含む（現在形推奨）」：そのカラムに未来の日時が含まれる可能性があります。現在形（例: `pays_at`、`starts_on`）を推奨します。

## ビルド・テスト・Lint コマンド

- `npm run build` - TypeScript のコンパイルと Vite ビルドを実行する
- `npm run test` - Vitest の全テストを 1 回実行する
- `npm run lint` - `src/**/*.ts` と `src/**/*.tsx` に対して ESLint を実行する
- 単一テストファイル: `npx vitest run test/background.spec.ts`
- テスト名を指定した単体実行: `npx vitest run test/background.spec.ts -t "background スクリプトが読み込まれると onInstalled / onAlarm リスナーが登録される"`

## 実装ルール

- 実装時は対応するテストコードを追加する
  - 既存のテストコードを検索し、重複するケースがないか確認する
  - 追加するテストコードは、変更したコードの機能を十分にカバーするものでなければならない
- 関数コメントをjsdoc形式で記述する
  - 関数の目的、引数の説明、返り値の説明を含める
  - 例:
    ```ts
    /**
     * ユーザーの名前を取得する関数
     * @param userId - ユーザーのID
     * @returns ユーザーの名前
     */
    function getUserName(userId: string): string {
      // 実装
    }
    ```

## 高レベルアーキテクチャ

- このリポジトリは Chrome 拡張で、Vite で 3 つのエントリーポイントをビルドする。background service worker は `src/background/index.ts`、popup は `src/popup/index.html` から `src/popup/index.tsx`、options は `src/options/index.html` から `src/options/index.tsx` を使う。エントリーポイントや出力名を変える場合は `public/manifest.json` と `vite.config.ts` を必ず揃える。
- プロダクトの中心は `src/background/index.ts`。ここで sync settings と復号済み PAT を読み込み、`chrome.storage.local` から runtime state を復元し、`viewer.login` を取得し、GitHub GraphQL の `search(type: ISSUE)` で新規項目・メンション・担当チケットコメント候補を集め、必要なら `nodes(ids: ...)` で未解決レビュー スレッドを追加取得し、重複排除した通知を local storage に保存してバッジと OS 通知を更新する。
- メンション検知は GraphQL の専用フィルタだけに依存せず、background 側で本文とコメントを `@viewerLogin` で走査して判定する。レビュー スレッド通知は `lastCheckedAt` 以降に更新された PR に対してのみ追加クエリを行う。
- popup (`src/popup/App.tsx`) は storage 駆動で動作する。GitHub API は直接呼ばず、`chrome.storage.local` から `notifications` と `readNotificationIds` を読み、`chrome.storage.sync` から通知トグルを読み、クリック時は storage と badge を更新して既読化する。
- options UI (`src/options/optionsApp.tsx`) は編集可能な設定を `chrome.storage.sync` に保存するが、PAT だけは別管理で、`src/shared/patStorage.ts` を通じて `chrome.storage.local` に保存する。PAT を sync storage に入れない前提で background と連携している。
- PAT 周りの責務は `src/shared/patStorage.ts` と `src/background/security.ts` に分かれている。PAT は保存前に暗号化され、起動時刻ベースの情報で再暗号化ローテーションされ、復号に失敗したものは破棄される。エラーログもトークンを伏せてから出力する。

## 主要な規約

- 作業開始時は `AGENTS.md`、`spec.md`、`tasks.md`、`package.json`、`src/background/index.ts` の順で確認する。`README.md` は現状プレースホルダー寄りなので、設計の正本として扱わない。
- このリポジトリでは会話、コードコメント、Issue、Pull Request、コミットに付随する説明、レビューコメント、ドキュメント記述など、対人コミュニケーションとして残る文章は原則すべて日本語で行う。明確な理由がない限り英語へ切り替えない。
- storage schema は extension の各画面・各処理をつなぐ契約になっている。通知データの shape を変える場合は background と popup を同時に更新し、設定データの shape を変える場合は background と options を同時に更新する。
- `chrome.storage.sync` には `repos`、`intervalMinutes`、各通知トグルのようなユーザー編集可能な設定を保存する。`chrome.storage.local` には `lastCheckedAt`、`viewerLogin`、`viewerLoginPatKey`、`notifications`、`readNotificationIds`、`badgeCount`、`notificationClickTargets`、暗号化済み PAT と起動時刻情報のような runtime データを保存する。
- 通知の重複排除は `StoredNotification.id = ${kind}:${nodeId}` を前提にしている。既読状態は `readNotificationIds` で別管理されるため、どちらか片方だけ変えると badge と popup の整合が崩れる。
- 挙動の大部分は `src/background/index.ts` に集約されている。ここを変更すると polling、storage schema、badge、popup、OS 通知クリックの挙動まで同時に影響する前提で扱う。
- 現在のテストは `test/background.spec.ts` にある smoke test / security helper test が中心。`tsconfig.json` の `include` は `src` のみなので、テストファイルは TypeScript コンパイルではなく Vitest 側で検証される。
- `spec.md`、`tasks.md`、実装が食い違う場合は、ドキュメントが正しいと決め打ちせず差分を明示する。
- 新しい外部ライブラリを追加する前には確認を取る。
