; installer.nsh
;
; mdpad NSIS カスタムインクルード
;
; 機能:
; 1. VERSION をゼロパディング済みの表示バージョンに上書き
; 2. インストール時にファイル拡張子ごとの右クリックメニュー登録（カスタムページ）
; 3. アンインストール時のレジストリクリーンアップ
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
; Version: 1.1.00068
; Since: 1.1.00066
; Revision: 4
; LastModified: 2026-03-04 22:30:00 (JST)

; ============================================================
; 1. バージョン上書き（ゼロパディング表示用）
; ============================================================
; 環境変数 MDPAD_DISPLAY_VERSION をコンパイル時に読み取り、
; VERSION を上書きしてインストーラ UI にゼロパディング済みバージョンを表示する。
!ifdef VERSION
  !undef VERSION
!endif
!define VERSION "$%MDPAD_DISPLAY_VERSION%"

; ============================================================
; 2. nsDialogs / LogicLib の読み込み（ファイル先頭で !include）
; ============================================================
; nsDialogs のマクロ（NSD_CreateLabel, NSD_CreateCheckbox 等）を
; Function 定義内で使用するため、!include は Function 定義より前に置く必要がある。
; ※ customHeader マクロ内に置くと、マクロ展開前に Function がパースされて
;    "Invalid command" エラーになるため、ファイル先頭で直接 include する。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; customHeader マクロ: electron-builder テンプレートのトップレベルで展開される。
; MUI_PAGE_CUSTOM はトップレベルのページ宣言として呼ぶ必要があるため、
; ここに配置する。customInit（.onInit 内）に置くとページとして認識されない。
!macro customHeader
  !insertmacro MUI_PAGE_CUSTOM fileAssocPage fileAssocPageLeave
!macroend

; ============================================================
; 3. チェックボックス状態の変数宣言
; ============================================================
; NSIS の Var 宣言はグローバルスコープで行う必要がある。
; chk* = チェックボックスのハンドル（UI要素）
; state* = チェックボックスの状態値（BST_CHECKED / BST_UNCHECKED）
Var chkMarkdown
Var chkText
Var chkHtml
Var chkMdx
Var stateMarkdown
Var stateText
Var stateHtml
Var stateMdx

; ============================================================
; 4. カスタムページ: ファイル拡張子の右クリックメニュー登録選択
; ============================================================
; nsDialogs を使い、インストール時にユーザーが拡張子グループごとに
; 右クリックメニュー登録を選択できるページを表示する。

; --- ページ表示関数 ---
Function fileAssocPage
  ; ページの作成（nsDialogs 標準テンプレート）
  nsDialogs::Create 1018
  Pop $0

  ; 説明ラベル
  ${NSD_CreateLabel} 0 0 100% 24u "右クリックメニューに「mdpadで開く」を追加する拡張子を選択してください："
  Pop $0

  ; チェックボックス: Markdown (.md, .markdown) — デフォルト ON
  ${NSD_CreateCheckbox} 20u 30u 100% 12u "Markdown (.md, .markdown)"
  Pop $chkMarkdown
  ${NSD_SetState} $chkMarkdown ${BST_CHECKED}

  ; チェックボックス: テキスト (.txt, .text) — デフォルト OFF
  ${NSD_CreateCheckbox} 20u 46u 100% 12u "テキスト (.txt, .text)"
  Pop $chkText

  ; チェックボックス: HTML (.html, .htm) — デフォルト OFF
  ${NSD_CreateCheckbox} 20u 62u 100% 12u "HTML (.html, .htm)"
  Pop $chkHtml

  ; チェックボックス: MDX (.mdx) — デフォルト OFF
  ${NSD_CreateCheckbox} 20u 78u 100% 12u "MDX (.mdx)"
  Pop $chkMdx

  ; 注記ラベル（Windows 10/11 の違いを説明）
  ${NSD_CreateLabel} 0 100u 100% 30u "※ Windows 10: 右クリックメニューに直接表示されます$\n※ Windows 11: 「その他のオプションを表示」内に表示されます"
  Pop $0

  ; ページを表示
  nsDialogs::Show
FunctionEnd

; --- ページ離脱時のコールバック（チェック状態を変数に保存） ---
Function fileAssocPageLeave
  ${NSD_GetState} $chkMarkdown $stateMarkdown
  ${NSD_GetState} $chkText $stateText
  ${NSD_GetState} $chkHtml $stateHtml
  ${NSD_GetState} $chkMdx $stateMdx
FunctionEnd

; ============================================================
; 5. customInit: .onInit で展開されるマクロ
; ============================================================
; MUI_PAGE_CUSTOM は customHeader に移動済み（トップレベルで宣言する必要があるため）。
; customInit は electron-builder テンプレートが要求するため空マクロとして残す。
!macro customInit
!macroend

; ============================================================
; 6. customInstall: ファイルインストール後のレジストリ書き込み
; ============================================================
; ユーザーが選択した拡張子グループに応じて、
; HKCU\Software\Classes\{ext}\shell\mdpad にエントリを作成する。

; ヘルパーマクロ: 指定拡張子に右クリックメニューを登録
!macro _WriteShellEntry EXT
  WriteRegStr HKCU "Software\Classes\${EXT}\shell\mdpad" "" "mdpadで開く(&M)"
  WriteRegStr HKCU "Software\Classes\${EXT}\shell\mdpad" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\${EXT}\shell\mdpad\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customInstall
  ; Markdown (.md, .markdown) — チェック時のみ登録
  ${If} $stateMarkdown == ${BST_CHECKED}
    !insertmacro _WriteShellEntry ".md"
    !insertmacro _WriteShellEntry ".markdown"
  ${EndIf}

  ; テキスト (.txt, .text) — チェック時のみ登録
  ${If} $stateText == ${BST_CHECKED}
    !insertmacro _WriteShellEntry ".txt"
    !insertmacro _WriteShellEntry ".text"
  ${EndIf}

  ; HTML (.html, .htm) — チェック時のみ登録
  ${If} $stateHtml == ${BST_CHECKED}
    !insertmacro _WriteShellEntry ".html"
    !insertmacro _WriteShellEntry ".htm"
  ${EndIf}

  ; MDX (.mdx) — チェック時のみ登録
  ${If} $stateMdx == ${BST_CHECKED}
    !insertmacro _WriteShellEntry ".mdx"
  ${EndIf}

  ; エクスプローラのシェル通知（アイコンキャッシュ更新等）
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend

; ============================================================
; 7. customUnInstall: アンインストール時のレジストリ削除
; ============================================================
; どの拡張子が登録されているか不明なため、全拡張子を無条件に削除する。
; 存在しないキーの削除は安全（エラーにならない）。
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\.md\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.markdown\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.txt\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.text\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.html\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.htm\shell\mdpad"
  DeleteRegKey HKCU "Software\Classes\.mdx\shell\mdpad"

  ; エクスプローラのシェル通知
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
