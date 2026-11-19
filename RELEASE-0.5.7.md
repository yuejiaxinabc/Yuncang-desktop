# 云仓桌面端 0.5.7

本版本修复了
1. 请求失败时提示含糊（网络错误、超时、密钥失效混在一起），现在分别提示
2. 部分错误码没翻译（HTTPS 要求、IP 白名单、缺 scope）只显示英文码

更新了
1. 客户端内部改用官方 SDK（yuncang-sdk）调用接口，鉴权、幂等键、重试策略统一到 SDK
2. 安装包与 macOS 版同步发布：Windows x64、macOS arm64（Apple 芯片）、macOS x64（Intel）
3. 自检项扩充到 18 项并通过，更新链路自检 9 项通过

## 安装

| 平台 | 文件 | 大小 | SHA256 |
| --- | --- | --- | --- |
| Windows x64 | `YunCang-Setup-0.5.7-x64.exe` | 见附件 | 见附件 |
| macOS Apple 芯片 | `YunCang-0.5.7-arm64.dmg` | 117,795,722 | `4ae1027a45472aa933a07860cd57450481d10a719c8d077c0873845cf247d477` |
| macOS Intel | `YunCang-0.5.7-x64.dmg` | 125,887,081 | `f51a4f5ad485aa30574bcab96db2827a560ef3ef2476560c83864086876f631f` |

## 说明

- macOS 包已做 ad-hoc 签名，首次打开若提示「无法验证开发者」，在「系统设置 → 隐私与安全性」允许一次，或执行 `xattr -dr com.apple.quarantine /Applications/云仓.app`
- Windows 包未做代码签名，SmartScreen 提示时点「更多信息 → 仍要运行」
- 自动更新：Windows 走更新中心 + 三地域对象存储；macOS 版同样按平台取对应包
