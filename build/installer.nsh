; 云仓 · 安装/卸载钩子（本文件必须 UTF-8 with BOM，NSIS 才能正确读中文）

; 安装后额外兜底：确保「开始菜单 → 所有程序」里有入口，并在「设置 → 应用」里能查到
!macro customInstall
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\云仓.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayName" "云仓"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "Publisher" "云仓"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString" '"$INSTDIR\Uninstall 云仓.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall 云仓.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "NoRepair" 1
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\云仓.lnk"
  Delete "$SMPROGRAMS\云仓客户端.lnk"
  Delete "$DESKTOP\云仓.lnk"
  Delete "$DESKTOP\云仓客户端.lnk"
  SetShellVarContext all
  Delete "$SMPROGRAMS\云仓.lnk"
  Delete "$DESKTOP\云仓.lnk"
  SetShellVarContext current
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

  ; 本机配置与缓存（productName 决定 userData 目录）
  RMDir /r "$APPDATA\云仓"
  RMDir /r "$LOCALAPPDATA\云仓"
  RMDir /r "$APPDATA\云仓客户端"
  RMDir /r "$LOCALAPPDATA\云仓客户端"
  Delete "$TEMP\cw-bootstrap.log"

  ; 开机自启登记
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "云仓"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "cloud-warehouse-desktop"
!macroend
