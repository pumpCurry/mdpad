; installer.nsh
;
; mdpad NSIS カスタムインクルード
;
; electron-builder が生成する NSIS スクリプト内で、
; VERSION をゼロパディング済みの表示バージョンに上書きする。
;
; 背景:
; - electron-builder は package.json の version を semver としてパースする際、
;   "1.1.00066" → "1.1.66" のようにゼロパディングを除去することがある。
; - NSIS インストーラの UI（タイトルバーや表示テキスト）で
;   ゼロパディング済みの正式バージョンを表示するため、
;   環境変数 MDPAD_DISPLAY_VERSION を NSIS コンパイル時に読み取り、
;   VERSION を再定義する。
;
; 仕組み:
; - build-installer.js が MDPAD_DISPLAY_VERSION 環境変数をセットしてから
;   electron-builder を起動する。
; - NSIS の $%ENV_VAR% 構文はコンパイル時に展開されるため、
;   環境変数が存在すれば VERSION が上書きされる。
;
; Version: 1.1.00066
; Since: 1.1.00066
; Revision: 2
; LastModified: 2026-03-02 03:30:00 (JST)

; 環境変数 MDPAD_DISPLAY_VERSION をコンパイル時に読み取り、
; VERSION を上書きしてインストーラ UI にゼロパディング済みバージョンを表示する。
; $%MDPAD_DISPLAY_VERSION% が空でなければ上書きする。
!ifdef VERSION
  !undef VERSION
!endif
!define VERSION "$%MDPAD_DISPLAY_VERSION%"
