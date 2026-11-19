; 云仓客户端 · 安装引导（NSIS 壳：提权 + 界面 + 调 PowerShell 做检测与安装）
Unicode true
!include MUI2.nsh

Name "云仓客户端 安装引导"
OutFile "..\\dist-installer\\云仓客户端安装引导.exe"
InstallDir "$TEMP\\cw-bootstrap"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show

!define MUI_WELCOMEPAGE_TITLE "安装云仓客户端"
!define MUI_WELCOMEPAGE_TEXT "安装前会检测本机环境：\r\n  · Windows 版本与位数\r\n  · 磁盘空间\r\n  · VC++ 运行库（缺少时自动安装）\r\n\r\n然后安装主程序并创建桌面快捷方式。\r\n\r\n首次打开需要填写云仓服务器地址与 API 密钥。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "桌面已生成「云仓客户端」快捷方式。\r\n首次打开请填写服务器地址与密钥，配置会加密保存在本机。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "install"
  InitPluginsDir
  SetOutPath "$TEMP\\cw-bootstrap"
  File "/oname=bootstrap.ps1" "bootstrap.ps1"
  DetailPrint "正在检测环境并安装依赖…"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\\cw-bootstrap\\bootstrap.ps1"'
  Pop $0
  DetailPrint "引导脚本退出码：$0"
  StrCmp $0 "0" done
    MessageBox MB_ICONSTOP|MB_OK "安装未完成（代码 $0）。\r\n日志：$TEMP\\cw-bootstrap.log"
  done:
SectionEnd
