$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 云仓客户端 · 安装前环境检测与依赖安装（由 云仓客户端安装引导.exe 调用）
# 1) 检测系统版本 / 位数 / 磁盘  2) 缺 VC++ 运行库从对象存储装  3) 装主程序  4) 建桌面快捷方式  5) 启动

$Base = 'https://updata-1307293667.cos.ap-beijing.myqcloud.com/desktop'
$AppInstaller = 'cw-desktop-setup-0.2.0.exe'
$VCRedist = 'prereq/vc_redist.x64.exe'
$LogFile = Join-Path $env:TEMP 'cw-bootstrap.log'

function Log($m) {
  $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Fail($m, $code) {
  Log ('失败：' + $m)
  exit $code
}

"===== 云仓客户端安装引导 $(Get-Date) =====" | Out-File $LogFile -Encoding UTF8
Log ('日志：' + $LogFile)

# ---------- 1. 环境检测 ----------
$os = [Environment]::OSVersion.Version
Log ('系统：' + [Environment]::OSVersion.VersionString)
if (-not [Environment]::Is64BitOperatingSystem) { Fail '需要 64 位 Windows' 10 }
if ($os.Major -lt 10) { Fail '需要 Windows 10 或更高版本（当前 ' + $os + '）' 11 }
if ([Environment]::OSVersion.Version.Build -lt 17763) { Fail 'Windows 10 版本过低（需要 1809 及以上）' 12 }

$free = (Get-PSDrive $env:SystemDrive.Substring(0,1)).Free
Log ('可用空间：' + [math]::Round($free/1GB,1) + ' GB')
if ($free -lt 1GB) { Fail '磁盘空间不足（至少需要 1 GB）' 13 }

# ---------- 2. VC++ 2015-2022 运行库 ----------
$vcKey = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
$vc = Get-ItemProperty -Path $vcKey -ErrorAction SilentlyContinue
if ($vc -and $vc.Installed -eq 1) {
  Log ('VC++ 运行库已安装：' + $vc.Major + '.' + $vc.Minor + '.' + $vc.Bld)
} else {
  Log '缺少 VC++ 2015-2022 运行库，从对象存储下载并安装'
  $vcExe = Join-Path $env:TEMP 'vc_redist.x64.exe'
  try {
    Invoke-WebRequest -Uri ($Base + '/' + $VCRedist) -OutFile $vcExe -UseBasicParsing -TimeoutSec 300
  } catch { Fail ('运行库下载失败：' + $_.Exception.Message) 20 }
  $p = Start-Process -FilePath $vcExe -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
  Log ('运行库安装退出码：' + $p.ExitCode)
  if (@(0,3010,1638) -notcontains $p.ExitCode) { Fail '运行库安装失败，请手动安装后重试' 21 }
}

# ---------- 3. 主程序 ----------
$setup = Join-Path $env:TEMP $AppInstaller
Log '下载主程序安装包（约 80 MB）…'
try {
  Invoke-WebRequest -Uri ($Base + '/' + $AppInstaller) -OutFile $setup -UseBasicParsing -TimeoutSec 900
} catch { Fail ('主程序下载失败：' + $_.Exception.Message) 30 }
Log ('安装包大小：' + [math]::Round((Get-Item $setup).Length/1MB,1) + ' MB')

Log '静默安装…'
$p2 = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Log ('安装退出码：' + $p2.ExitCode)
if ($p2.ExitCode -ne 0) { Fail '主程序安装失败' 31 }

# ---------- 4. 桌面快捷方式 ----------
# 主程序 exe：优先精确名，其次模糊匹配；务必排除 Uninstall*
$roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), 'C:\Program Files', 'C:\Program Files (x86)')
$all = foreach ($r in $roots) {
  if (Test-Path $r) { Get-ChildItem -Path $r -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue }
}
$all = $all | Where-Object { $_.Name -notlike '*ninstall*' -and $_.Name -notlike '*uninst*' -and $_.Name -notlike 'Update*' -and $_.Name -notlike 'elevate*' }
$target = $all | Where-Object { $_.Name -eq '云仓客户端.exe' } | Select-Object -First 1
if (-not $target) { $target = $all | Where-Object { $_.Name -like '*云仓*' -or $_.Name -like '*cloud*warehouse*' } | Select-Object -First 1 }
if (-not $target) { $target = $all | Where-Object { $_.DirectoryName -like '*cloud-warehouse-desktop*' } | Select-Object -First 1 }
if ($target) {
  Log ('主程序：' + $target.FullName)
  $shell = New-Object -ComObject WScript.Shell
  foreach ($desktop in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:PUBLIC 'Desktop'))) {
    try {
      $lnk = $shell.CreateShortcut((Join-Path $desktop '云仓客户端.lnk'))
      $lnk.TargetPath = $target.FullName
      $lnk.WorkingDirectory = $target.DirectoryName
      $lnk.IconLocation = $target.FullName + ',0'
      $lnk.Description = '云仓客户端 · 桌面作业端'
      $lnk.Save()
      Log ('已创建快捷方式：' + $lnk.FullName)
    } catch { Log ('快捷方式写入失败（忽略）：' + $_.Exception.Message) }
  }
  try {
    Start-Process -FilePath $target.FullName
    Log '已启动客户端，首次进入请填写服务器地址与密钥'
  } catch { Log ('启动失败（可手动从桌面打开）：' + $_.Exception.Message) }
} else {
  Log '未定位到主程序 exe，请从开始菜单打开「云仓客户端」'
}

Log '安装引导完成'
exit 0
