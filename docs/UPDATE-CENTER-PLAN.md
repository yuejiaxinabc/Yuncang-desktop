# 更新中心 · 多平台规划（v2）

> 目标：一套更新中心同时服务 **服务端（Linux）**、**桌面端（Windows / macOS / Linux）**、**移动端（Android / iOS）**，
> 客户端只认「产品 + 平台 + 架构 + 通道」，服务端只管发清单。

## 一、先说结论

1. **清单（manifest）是唯一契约**，客户端不猜 URL、不猜文件名：给什么下什么；
2. **产物放对象存储，清单放更新中心**：更新中心只存元数据（KB 级），下载走 COS 多地域 + CDN，谁快用谁；
3. **平台差异只体现在「安装动作」**，下载与校验完全共用一条链路；
4. **iOS 不自更新**（Apple 不允许），客户端只做「有新版本 → 跳 App Store / TestFlight」，这条必须写进契约，别让后面的人以为漏做了。

## 二、产品与平台矩阵

| product | platform | 产物格式 | 谁能自更新 |
| --- | --- | --- | --- |
| `yuncang-server` | `linux` | tar.gz（现有 云仓 服务端包） | 服务端内置更新脚本 |
| `yuncang-desktop` | `win-x64` | NSIS exe | ✅ 静默 `/S` 安装 |
| `yuncang-desktop` | `mac-arm64` / `mac-x64` | dmg（签名 + 公证） | ✅ 挂载 dmg 覆盖安装 |
| `yuncang-desktop` | `linux-x64` | AppImage（主）/ deb（备） | ✅ 替换 AppImage 后重启 |
| `yuncang-mobile` | `android` | apk（AAB 走商店） | ✅ 下载 apk + 系统安装器 |
| `yuncang-mobile` | `ios` | ipa（仅企业内部分发） | ❌ 只能跳 App Store / TestFlight |

架构字段统一用 `arch`：`x64 / arm64 / universal`；移动端填 `universal`。

## 三、目录与命名

对象存储（各区域同构，北京为主，南京/成都复制）：

~~~text
/apps/
  <product>/                     # yuncang-desktop
    <channel>/                   # stable | beta
      manifest.json              # 清单（体积 < 8KB，客户端首先拉它）
      <version>/
        <platform>-<arch>.<ext>  # win-x64.exe / mac-arm64.dmg / linux-x64.AppImage
        notes.md                 # 更新说明（与清单里的 notes 同源）
        sha256.txt
~~~

- 文件名带平台与架构，避免「同版本不同平台」互相覆盖；
- 版本号语义：`主.次.修` 稳定版、`主.次.修.补` 测试版（沿用现有约定）；
- `manifest.json` 永远指向「当前推荐版本」，历史版本留在 `<version>/` 下不删（回滚用）。

## 四、清单结构（v2）

~~~json
{
  "schema": 2,
  "product": "yuncang-desktop",
  "channel": "stable",
  "generatedAt": "2026-11-14T12:00:00Z",
  "latest": {
    "platform": "win-x64",
    "version": "0.5.0",
    "minVersion": "0.3.0",
    "mandatory": false,
    "publishedAt": "2026-11-14T11:40:00Z",
    "notes": "本版本修复了\n1. …\n更新了\n1. …",
    "size": 81424117,
    "sha256": "e3f2…",
    "signature": "base64(ECDSA-P256(sha256(manifest-without-signature)))",
    "sources": [
      "https://updata-1307293667.cos.ap-beijing.myqcloud.com/apps/yuncang-desktop/stable/0.5.0/win-x64.exe",
      "https://update.yuejiaxin.ln.cn/download/yuncang-desktop/0.5.0/win-x64.exe"
    ],
    "rollout": { "percent": 100, "excludeDeviceIds": [] }
  },
  "history": [ { "version": "0.4.1", "publishedAt": "…", "sha256": "…" } ]
}
~~~

要点：

- `minVersion`：低于它的客户端必须强更（跳不过）；
- `mandatory`：强制更新（安全修复时用）；
- `signature`：清单签名，防「对象存储被改包」；公钥内置在客户端（`update-pubkey.pem`），私钥只在发布机；
- `rollout.percent`：按 `sha256(installId) % 100 < percent` 灰度，出问题把 percent 调 0 立即止血；
- `history` 只留最近 20 条 + 全部 sha256，回滚就是「把 latest 指回旧版本」。

## 五、更新中心 API（v2）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v2/manifest?product=&platform=&arch=&channel=&version=` | 返回该组合的清单；`version` 用于「已是最新」快速判定 |
| GET | `/api/v2/releases?product=&limit=` | 版本历史（网站展示用） |
| POST | `/api/v2/publish` | 发布（Basic Auth），body 见下 |
| POST | `/api/v2/rollout` | 调灰度百分比 / 撤回某版本 |
| POST | `/api/v2/report` | 客户端上报下载与安装结果（可选，匿名 installId） |

发布请求体：

~~~json
{
  "product": "yuncang-desktop",
  "platform": "win-x64",
  "channel": "stable",
  "version": "0.5.0",
  "minVersion": "0.3.0",
  "mandatory": false,
  "notes": "…",
  "size": 81424117,
  "sha256": "…",
  "sources": ["https://…", "https://…"],
  "signature": "…"
}
~~~

**兼容**：旧的 `/api/version?channel=stable` 继续保留（云仓服务端在用），内部映射到 `product=yuncang-server&platform=linux-x64`。

## 六、客户端流程（所有平台共用）

~~~text
启动 → 后台并发 GET manifest（更新中心 + 三个 COS，4s 超时）
   ↓ 取「最快且版本最高」的那份
比对 version（semver）→ 无更新则睡 6~12h
   ↓ 有新版本
校验签名 → 计算权重判断是否在灰度内 → 展示「更新说明」
   ↓ 用户确认（mandatory 时直接进下一步）
对 sources 逐个 HEAD 测速 → 选最快 → 下载（断点续传 + 进度）
   ↓
sha256 校验（不一致直接删包重试下一个源）
   ↓
按平台执行安装动作 → 重启到新版本 → 上报结果
~~~

平台安装动作：

| 平台 | 动作 |
| --- | --- |
| Windows | `setup.exe /S`（NSIS 静默），退出当前进程 |
| macOS | 挂载 dmg → 复制 .app 到 /Applications → 卸载 dmg → `open -n` |
| Linux | AppImage：替换当前文件 + `chmod +x`，重启；deb：`dpkg -i`（需 root，用 pkexec） |
| Android | 下载 apk → `Intent(ACTION_VIEW)` 交给系统安装器（需「未知来源」权限） |
| iOS | 不自更新：展示版本 + 「去 App Store」按钮 |

## 七、签名与发布链

1. **代码签名**（各平台各自做，更新中心不参与）：
   - Windows：EV/Authenticode（没有就先在安装器里放 sha256 校验 + 提示 SmartScreen）；
   - macOS：Developer ID + notarization（否则 Gatekeeper 拦）；
   - Android：keystore 签名，升级必须同签名；
   - iOS：Apple 证书 + TestFlight/App Store。
2. **清单签名**：发布机用离线私钥签 `latest` 段，客户端内置公钥验签；
3. **发布机**（就是现在的更新中心服务器）：
   - 构建产物 → 上传 COS 北京（南京/成都由跨地域复制跟进）→ 生成清单 → 签名 → `POST /api/v2/publish`；
   - 发布后自检：HEAD 三个地域 + 拉一次 `/api/v2/manifest` 对版本。

## 八、数据与页面

- 更新中心从「单产品单通道」升级为「产品 × 平台 × 通道」矩阵，页面按 `product` 分组展示：
  每个产品的当前版本、灰度比例、最近 10 次发布、各平台是否齐活（缺包标红）；
- 现有 `servers` 页面（入网设备）保留，另加「客户端」页：装机量、版本分布、更新成功率。

## 九、落地顺序（建议）

1. **第 1 步（本周）**：更新中心加 `/api/v2/manifest` + 「desktop/win-x64」一条数据；桌面端 0.5.x 接上，
   先跑通「多源测速 → 下载 → sha256 → 安装 → 重启」；
2. **第 2 步**：加签名（清单 + 安装包），灰度字段生效；
3. **第 3 步**：macOS / Linux 桌面端接入，产物路径与平台字段已就位，只是补安装动作；
4. **第 4 步**：Android（apk 自更新）、iOS（只提示）；
5. **第 5 步**：服务端版本并入同一套清单（`product=yuncang-server`），逐步下掉旧的 `/api/version`。

## 十、风险与对策

| 风险 | 对策 |
| --- | --- |
| 对象存储被篡改 | 清单签名 + 安装包 sha256，双重 |
| 灰度翻车 | `percent` 可即时归零；保留 N 个历史版本可回滚 |
| 多平台版本错配 | 清单按 `platform+arch` 分条，缺条目即「不支持」，不猜 |
| 更新把用户配置搞坏 | 升级前备份 `%APPDATA%\<product>\config.json`，安装器不动 userData |
| 下载盗链 | COS 只读 + 可选防盗链 Referer/签名 URL（移动端尤其需要） |
| iOS 审核 | 不自更新、不热更业务逻辑，仅版本提示 |

## 十一、当前进度（2026-11-14）

| 项 | 状态 |
| --- | --- |
| 更新中心 @@/api/v2/manifest@@（公开只读） | ✅ 已上线 |
| 更新中心 @@/api/v2/releases@@ | ✅ 已上线 |
| 更新中心 @@/api/v2/publish@@（Basic Auth） | ✅ 已上线 |
| 桌面端 win-x64 清单 + 包（三地域） | ✅ 0.5.1 已发布 |
| 客户端多源测速 + SHA256 校验 + 静默安装 | ✅ 0.5.1 内置 |
| 灰度字段 @@rollout.percent@@ | ✅ 服务端可设，客户端已判断（当前 100%） |
| 清单签名 @@signature@@ | ⬜ 字段已预留，公钥待内置 |
| macOS / Linux / Android / iOS | ⬜ 目录与平台字段已就位，待出产物 |

## 十二、发布中心页面（2026-11-14 已上线）

首页新增「客户端（多平台）」卡片：

- 发布表单：产品 / 平台 / 通道 / 版本号 / 最低可升级版本 / 灰度百分比 / 直链（多行）/ SHA256 / 包大小 / 更新说明；
- 发布列表：产品·平台、通道、最新版本、灰度（<100% 标黄、0% 标红）、包大小、发布时间，行内可「灰度」调整与「移除」登记；
- 顶部导航加「客户端（多平台）」锚点；15 秒轮询自动刷新，与既有「入网服务器 / 版本历史」并列。

对应接口：GET /api/v2/apps、POST /api/v2/publish、POST /api/v2/rollout、POST /api/v2/delete。

## 十三、登录与视觉（2026-11-14）

- 独立登录页 `/login`：账号 + 密码，回车即登录，错误在页面内提示（不再弹浏览器 Basic 框）；
- 会话：HttpOnly + SameSite=Strict Cookie（`yc_hub=exp.hmac`），有效期 12 小时，`/api/logout` 退出；
  签名密钥由 `SESSION_SECRET`（缺省从 `UPDATE_HUB_PASS` 派生）生成，改密码即让所有旧会话失效；
- 兼容：`Authorization: Basic` 仍然有效，发布脚本 / curl / 客户端接口不受影响；
- 视觉：整体换成蓝白（与云仓 Web 端同一套色板），顶部固定栏（品牌 + 页签 + 退出），卡片化布局，
  表格浅底表头 + 行悬停，状态标签四色分级（主版本 / Beta / 灰度 / 在线）；
- 页面结构：`/`（发布更新）、`/#apps`（客户端多平台）、`/servers`（入网服务器）、`/login`（登录）。
