<p align="center">
  <img src="docs/resources/mdpad_icon.png" alt="mdpad icon" width="128" height="128">
</p>

<h1 align="center">mdpad</h1>

<p align="center">GitHub準拠 Markdown エディタ - Windows スタンドアロンデスクトップアプリケーション</p>

Electron と CodeMirror 6 で構築された、ライブプレビューと差分表示機能を備えた高機能 Markdown エディタです。

![mdpad エディタ＋プレビュー画面](docs/resources/02_edit_preview.png)

## 機能

- **エディタ** - CodeMirror 6 ベースのエディタ。Markdown シンタックスハイライト、行番号、コード折りたたみ、矩形選択（Alt+ドラッグ）、正規表現対応の検索・置換（マッチ数表示）
- **ライブプレビュー** - GitHub Flavored Markdown のリアルタイム描画
  - テーブル、タスクリスト、脚注（GFM）
  - Mermaid 図
  - KaTeX 数式（`$...$`、`$$...$$`）
  - コードブロックのシンタックスハイライト（highlight.js）
  - エディタとのスクロール同期
- **差分ビュー** - サイドバイサイドまたはインライン差分表示
  - 編集履歴モード（ファイルを開いた時点との比較）
  - ファイル比較モード（外部ファイルとの比較）
  - プレビューペインでのリッチ Markdown 差分表示
- **柔軟なレイアウト** - 1〜3ペインレイアウト、自由に組み合わせ可能
  - Ctrl+1 / Ctrl+2 / Ctrl+3 で各ペインを切り替え
  - ドラッグ可能なペイン分割線
- **ペイン横断検索** - エディタ・プレビュー・差分を横断して検索。マッチ数表示対応
- **ドラッグ＆ドロップ** - ファイルをウィンドウにドロップして開く
- **自動バックアップ** - 設定可能な自動保存タイマー（1〜60分またはOFF）
  - ステータスバーに次回バックアップまでのカウントダウン表示
  - クラッシュリカバリ機能（差分表示用にオリジナルの内容を保持）
  - マルチインスタンス対応（PIDベース）
- **ズーム** - Ctrl+/- でズーム、ステータスバーに倍率表示
- **HTMLダイアログ** - 保存確認ダイアログ、リジューム保存対応の終了ダイアログ
- **多言語対応（i18n）** - 日本語 / 英語、OSロケール自動検出

## インストール

### ポータブル版（zip）

[Releases](../../releases) ページから最新の `mdpad-v*-win-x64-portable.zip` をダウンロードし、任意のフォルダに展開して `mdpad.exe` を実行してください。インストール作業は不要です。

### ソースからビルド

```bash
git clone https://github.com/pumpCurry/mdpad.git
cd mdpad
npm install
npm run build:zip
```

ビルド成果物は `build/` ディレクトリに出力されます。

## キーボードショートカット

| ショートカット | 動作 |
|----------------|------|
| Ctrl+N | 新規ファイル |
| Ctrl+O | ファイルを開く |
| Ctrl+S | 保存 |
| Ctrl+Shift+S | 名前を付けて保存 |
| Ctrl+F | 検索 |
| Ctrl+H | 置換 |
| Ctrl+1 | エディタペインの表示切替 |
| Ctrl+2 | プレビューペインの表示切替 |
| Ctrl+3 | 差分ペインの表示切替 |
| Alt+Z | 折り返し表示の切替 |
| Ctrl+Z | 元に戻す |
| Ctrl+Y | やり直し |
| Ctrl++/- | 拡大/縮小 |
| Ctrl+0 | ズームリセット |
| F12 | 開発者ツール |

## 開発

### 前提条件

- Node.js 18 以上
- npm

### セットアップ

```bash
npm install
```

### 起動（開発モード）

```bash
npm start
```

### ビルド（ポータブル exe）

```bash
npm run build
```

出力先は `build/win-unpacked/` です。ポータブル zip を作成するには:

```bash
npm run build:zip
```

`build/mdpad-vX.X.XXXXX-win-x64-portable.zip` が生成されます。

## 技術スタック

| コンポーネント | 技術 |
|----------------|------|
| フレームワーク | Electron |
| エディタ | CodeMirror 6 |
| Markdown | markdown-it + プラグイン |
| 図表 | Mermaid |
| 数式 | KaTeX |
| コードハイライト | highlight.js |
| 差分 | jsdiff |
| サニタイザ | DOMPurify |
| バンドラ | esbuild |
| ビルド | electron-builder |

## サードパーティライセンス

本プロジェクトは以下のオープンソースライブラリを使用しています。

| ライブラリ | ライセンス |
|------------|-----------|
| Electron | MIT |
| CodeMirror 6 | MIT |
| markdown-it | MIT |
| Mermaid | MIT |
| KaTeX | MIT |
| highlight.js | BSD-3-Clause |
| jsdiff | BSD-3-Clause |
| DOMPurify | Apache-2.0 / MPL-2.0 |
| github-markdown-css | MIT |
| esbuild | MIT |
| electron-builder | MIT |

## ライセンス

MIT License - (C) pumpCurry, 5r4ce2

詳細は [LICENSE](LICENSE) をご覧ください。

## ドキュメント

- [使い方ガイド](docs/ja/how_to_use.md)
