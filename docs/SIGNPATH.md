# 申请 SignPath 免费代码签名（开源项目）

> SignPath 对开源项目免费签名，签出来的是受信任 CA 证书，Windows 不再提示「未知发布者」。
> 前提：**项目必须是公开仓库 + OSI 认可的开源许可证 + 由 CI 构建**。

## 一、申请流程

1. 打开 <https://signpath.org/> → Apply（用 GitHub 账号登录）；
2. 填项目信息：仓库地址、许可证 MIT、构建方式 GitHub Actions、维护者；
3. 审核通过后，在 SignPath 后台建：Project `yuncang-desktop`、Signing policy `release-signing`、
   Artifact configuration `exe`（匹配 `*.exe`）；
4. 生成 API Token，把三个值加到 GitHub 仓库 Secrets：

| Secret | 值 |
| --- | --- |
| `SIGNPATH_API_TOKEN` | SignPath 生成的 token |
| `SIGNPATH_ORG_ID` | SignPath 后台 Organization ID |
| `SIGNPATH_PROJECT_SLUG` | `yuncang-desktop` |

## 二、签名流水线

`.github/workflows/sign-windows.yml`：推 `v*` tag 触发

```
checkout → npm ci → npm run smoke → npm run dist:win（未签名）
  → 上传未签名产物 → 送 SignPath 签 → Get-AuthenticodeSignature 校验
  → 只有 Valid 才产出 signed artifact
```

## 三、已知约束

- 免费额度按构建次数/月，个人项目够用；企业量级要谈；
- 签名是对**安装包**，不是对源码；每次发版都走一次 CI；
- SignPath 给的是 OV 级证书：签完「未知发布者」会变成组织名，但 SmartScreen 黄色提示仍需累计下载量才彻底消失（EV 才立即消失）。
