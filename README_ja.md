# Repo Watcher

[![Build Status](https://github.com/kocya-dev/repo-watcher/actions/workflows/build-artifact.yml/badge.svg)](https://github.com/kocya-dev/repo-watcher/actions/workflows/build-artifact.yml)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

[English](README.md) | [日本語](README_ja.md)

`Track GitHub PRs and Issues effortlessly from your browser.`

Repo Watcher は、GitHub 上の Issue / Pull Request の更新を監視する Chrome 拡張です。

このリポジトリは Chrome 拡張そのもののソースコードであり、単体の CLI やデスクトップアプリとして利用するものではありません。利用するには Chrome 系ブラウザに拡張として読み込み、GitHub Personal Access Token と監視対象リポジトリを設定する必要があります。

## できること

- 新しい Issue / Pull Request の通知
- 自分へのメンションを含むかどうかの通知
- 自分がアサインされているかどうかの通知
- 通知件数のバッジ表示
- Popup 画面での通知一覧表示と既読管理
- Options 画面での監視対象リポジトリ、監視間隔、通知設定、PAT 管理

## これは何のソフトウェアか

Repo Watcher は GitHub API を定期的に確認し、指定したリポジトリ群の変更を Chrome 拡張として通知するためのソフトウェアです。

主な構成は次のとおりです。

- background service worker: GitHub GraphQL API を呼び出し、通知候補の収集、重複排除、バッジ更新を担当
- popup: 保存済み通知の一覧表示、既読化、手動更新、一時停止状態の確認を担当
- options: PAT、監視対象リポジトリ、監視間隔、通知オプションの設定を担当

## 利用前提

- Chrome または Chromium 系ブラウザ
- GitHub の Personal Access Token
- 監視したい GitHub リポジトリ

この拡張は GitHub 上の通知体験を補助するためのものです。GitHub アカウントやブラウザ環境なしでは意味のある動作をしません。

## セットアップ

### 1. 依存関係をインストールする

```bash
npm install
```

### 2. 拡張をビルドする

```bash
npm run build
```

ビルド後、生成された dist を Chrome に unpacked extension として読み込みます。

### 3. Chrome に読み込む

1. Chrome で 拡張機能 管理ページを開く
2. デベロッパーモードを有効にする
3. パッケージ化されていない拡張機能を読み込む を選ぶ
4. このリポジトリの dist ディレクトリを指定する

### 4. 初期設定を行う

拡張の Options 画面から次を設定します。

- GitHub Personal Access Token
- 監視対象リポジトリ
- 監視間隔
- Draft PR を通知対象に含めるか
- Close 済み通知を自動で一覧から外すか

## 開発

主要コマンド:

```bash
npm run build
npm run test
npm run lint
npm run format
```

コードベースの中心:

- src/background/index.ts: background service worker のエントリーポイント
- src/background/watchCycle.ts: 監視サイクルの中核ロジック
- src/popup/App.tsx: popup UI
- src/options/optionsApp.tsx: options UI

## 権限と動作

manifest では主に次の権限を使います。

- storage
- alarms
- https://api.github.com/* へのアクセス

監視データや既読状態は Chrome storage に保存されます。設定値と実行時データは別ストレージに分けて管理されています。

## 制約

- Chrome 拡張としてのみ動作します
- GitHub API にアクセスできる環境が必要です
- PAT 未設定時は監視を実行できません
- 監視対象リポジトリが未設定だと通知は生成されません

## ライセンス

[MIT License](LICENSE)
