# 安装与下载

> 2026-11 起对象存储只剩**北京一个桶**（`updata-1307293667`，ap-beijing）。
> 南京（`update-1307293667`）、成都（`updatea-1307293667`）两个桶已停用，域名还能解析但返回 NoSuchBucket 404。

## 下载（0.5.9）

| 平台 | 文件 |
| --- | --- |
| Windows x64 | [YunCang-Setup-0.5.9-x64.exe](https://updata-1307293667.cos.ap-beijing.myqcloud.com/apps/yuncang-desktop/stable/0.5.9/YunCang-Setup-0.5.9-x64.exe) |
| macOS Apple Silicon | [YunCang-0.5.9-arm64.dmg](https://updata-1307293667.cos.ap-beijing.myqcloud.com/apps/yuncang-desktop/stable/0.5.9/YunCang-0.5.9-arm64.dmg) |
| macOS Intel | [YunCang-0.5.9-x64.dmg](https://updata-1307293667.cos.ap-beijing.myqcloud.com/apps/yuncang-desktop/stable/0.5.9/YunCang-0.5.9-x64.dmg) |

自动更新走更新中心：<https://update.yuejiaxin.ln.cn/login>（客户端「设置 → 检查更新」也会直连）。

## 安装提示

- **Windows**：未购买代码签名，SmartScreen 提示时选「更多信息 → 仍要运行」。
- **macOS**：ad-hoc 签名，首次打开用右键 →「打开」，或执行
  `xattr -dr com.apple.quarantine "/Applications/云仓.app"`。

## 校验收到的包

```bash
shasum -a 256 YunCang-0.5.9-arm64.dmg   # db0b181475001b7226a1b9c81a9d85ebe169e799789c0f2a116053b3b4bab932
shasum -a 256 YunCang-0.5.9-x64.dmg     # 7113feea0ca5d6799d70705c2a5b0564afef455b57be5b44b470fa86409a6c51
certutil -hashfile YunCang-Setup-0.5.9-x64.exe SHA256   # 13f44ff1107fe45b4f973b15c49d3f4dce11a4d8706a22195d7c260f582a5d4b
```
