; installer.nsh
;
; mdpad NSIS カスタムインクルード
;
; 機能:
; 1. VERSION をゼロパディング済みの表示バージョンに上書き
; 2. ウェルカムページ（customWelcomePage フック）
; 3. インストール時にファイル拡張子ごとの右クリックメニュー登録（customPageAfterChangeDir フック）
; 4. アンインストール時のレジストリクリーンアップ
;
; ページ表示順序（assistedInstaller.nsh テンプレートのフック順に従う）:
;   1. customWelcomePage → ウェルカムページ
;   2. PAGE_INSTALL_MODE  → インストールオプション（全ユーザー/現ユーザー）
;   3. MUI_PAGE_DIRECTORY → インストール先の選択
;   4. customPageAfterChangeDir → ファイル関連付けの選択
;   5. MUI_PAGE_INSTFILES → インストール実行
;   6. MUI_PAGE_FINISH    → 完了
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
; Version: 1.1.00084
; Since: 1.1.00066
; Revision: 10
; LastModified: 2026-03-08 00:00:00 (JST)

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
; 2. nsDialogs / LogicLib の読み込み
; ============================================================
; nsDialogs のマクロ（NSD_CreateLabel, NSD_CreateCheckbox 等）を
; Function 定義内で使用するため、!include は Function 定義より前に置く必要がある。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ============================================================
; 3. テンプレートフック用マクロ定義
; ============================================================
; assistedInstaller.nsh は以下の順でフックマクロを検査・展開する:
;   customWelcomePage → (licensePage) → PAGE_INSTALL_MODE →
;   MUI_PAGE_DIRECTORY → customPageAfterChangeDir → MUI_PAGE_INSTFILES →
;   customFinishPage / MUI_PAGE_FINISH
;
; ページ宣言（Page custom）はこれらマクロ内で行うことで、
; テンプレートのページ順序に正しく組み込まれる。
; トップレベルでの Page custom 宣言は禁止（ページ順序が狂うため）。
;
; 注意: Function 定義とVar宣言は !ifndef BUILD_UNINSTALLER で囲むこと。
; アンインストーラビルド時に Function が Page から参照されないと
; NSIS warning 6010（未参照関数）がエラーとして扱われるため。

; --- customHeader: テンプレートが require する空マクロ ---
!macro customHeader
!macroend

; --- customWelcomePage: ウェルカムページ（テンプレートの最初に表示） ---
!macro customWelcomePage
  Page custom welcomePage
!macroend

; --- customPageAfterChangeDir: ディレクトリ選択後に表示 ---
!macro customPageAfterChangeDir
  Page custom fileAssocPage fileAssocPageLeave
!macroend

; --- customInit: .onInit で展開されるマクロ ---
; UAC 昇格による再起動（内部プロセス）かどうかを判定し、
; $isUACRestart 変数にフラグを格納する。
; マクロ展開時には UAC.nsh がテンプレートにより include 済みのため、
; ${UAC_IsInnerInstance} が利用可能。
; BUILD_UNINSTALLER ガード: アンインストーラビルド時には $isUACRestart が
; 未宣言のため、コンパイルエラーを防止する。
!macro customInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $isUACRestart "0"
    ${If} ${UAC_IsInnerInstance}
      StrCpy $isUACRestart "1"
    ${EndIf}
  !endif
!macroend

; ============================================================
; 4. customInstall: ファイルインストール後のレジストリ書き込み
; ============================================================
; ユーザーが選択した拡張子グループに応じて、
; HKCU\Software\Classes\{ext}\shell\mdpad にエントリを作成する。
; マクロ定義はトップレベルに置く必要がある（テンプレートが展開するため）。

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
; 5. customUnInstall: アンインストール時のレジストリ削除
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

; ============================================================
; 6. インストーラ専用: 変数宣言・関数定義
; ============================================================
; !ifndef BUILD_UNINSTALLER で囲むことで、アンインストーラビルド時に
; Function が未参照として警告（→エラー）になることを防ぐ。
!ifndef BUILD_UNINSTALLER

; --- UAC 再起動フラグ ---
; customInit マクロで設定され、ウェルカムページのスキップ判定に使用する。
; "1" = UAC 昇格後の内部プロセス（ウェルカムをスキップ）
; "0" = 通常起動
Var isUACRestart

; --- チェックボックス状態の変数宣言 ---
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

; --- ウェルカムページ ---
; アプリアイコン、アプリ名、バージョン、挨拶メッセージを表示する。
Function welcomePage
  ; UAC 昇格後の内部プロセスではウェルカムページをスキップする。
  ; customInit で設定した $isUACRestart フラグを確認する。
  ; StrCmp は基本NSIS命令のため、UAC.nsh の include 不要。
  StrCmp $isUACRestart "0" +2 ; "0"（通常起動）なら Abort をスキップ
  Abort                        ; "1"（UAC再起動）ならページをスキップ

  ; ヘッダーテキストを設定（MUI_HEADER_TEXT マクロは MUI2 include 前のため使用不可。
  ; GetDlgItem + SendMessage(WM_SETTEXT=12) で直接設定する。
  ; MUI2 の制御ID: 1037 = ヘッダータイトル, 1038 = ヘッダーサブタイトル
  ; 注意: 1028 はダイアログ下部のブランディングテキスト（誤って使用すると重なり発生）
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 12 0 "STR:mdpad セットアップ"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 12 0 "STR:インストールウィザードへようこそ"

  nsDialogs::Create 1018
  Pop $0

  ; --- アプリアイコン (大きく表示) ---
  ; MUI_ICON をプラグインディレクトリにコピーし、LoadImage で 64x64 に読み込む
  File /oname=$PLUGINSDIR\app.ico "${MUI_ICON}"
  ${NSD_CreateIcon} 130u 5u 32u 32u ""
  Pop $R1
  ; IMAGE_ICON=1, LR_LOADFROMFILE=0x0010
  System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\app.ico", i 1, i 64, i 64, i 0x0010) p .R0'
  SendMessage $R1 0x0170 $R0 0 ; STM_SETICON = 0x0170

  ; --- タイトル: "Welcome to mdpad Installer" ---
  ${NSD_CreateLabel} 0 50u 100% 20u "Welcome to mdpad Installer"
  Pop $R0
  CreateFont $R2 "$(^Font)" 16 700
  SendMessage $R0 0x0030 $R2 0 ; WM_SETFONT

  ; --- バージョン表示 ---
  ${NSD_CreateLabel} 0 70u 100% 14u "Version ${VERSION}"
  Pop $R0
  CreateFont $R2 "$(^Font)" 10 400
  SendMessage $R0 0x0030 $R2 0 ; WM_SETFONT

  ; --- 挨拶メッセージ ---
  ${NSD_CreateLabel} 0 95u 100% 16u "このたびは mdpad をお選びくださいまして、ありがとうございます。"
  Pop $R0

  ; --- 管理者権限の注意 ---
  ${NSD_CreateLabel} 0 117u 100% 16u "PC全てのユーザーでインストールする場合は、管理者権限が必要になります。"
  Pop $R0

  ; --- 次へ案内 ---
  ${NSD_CreateLabel} 0 145u 100% 14u "「次へ」でインストールを開始します。"
  Pop $R0

  nsDialogs::Show
FunctionEnd

; --- ファイル関連付けページ ---
; nsDialogs を使い、インストール時にユーザーが拡張子グループごとに
; 右クリックメニュー登録を選択できるページを表示する。
Function fileAssocPage
  ; ヘッダーテキストを設定（MUI_HEADER_TEXT マクロは MUI2 include 前のため使用不可。
  ; GetDlgItem + SendMessage(WM_SETTEXT=12) で直接設定する。
  ; MUI2 の制御ID: 1037 = ヘッダータイトル, 1038 = ヘッダーサブタイトル
  ; 注意: 1028 はダイアログ下部のブランディングテキスト（誤って使用すると重なり発生）
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 12 0 "STR:ファイルの関連付け"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 12 0 "STR:右クリックメニューに「mdpadで開く」を追加します"

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

!endif ; BUILD_UNINSTALLER
