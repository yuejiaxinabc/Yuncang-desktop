# 上架 Microsoft Store（用商店签名，彻底绕开 SmartScreen）

> 路线：把现有 Electron 桌面端打成 MSIX，交微软商店审核；安装包由**微软签名**，用户从商店装 → 不弹「未知发布者」。

## 一、需要准备

1. 注册 **Microsoft Partner Center** 开发者账号：<https://partner.microsoft.com/dashboard/registration>
   - 个人：19 美元一次性；公司：99 美元一次性；
2. 在 Partner Center 新建应用，名称填 **云仓**（Store 名称全球唯一）；
3. 在「应用管理 → 应用标识」拿到三项：Package/Identity/Name、Package/Identity/Publisher、Publisher display name；
4. 上架素材：图标（512、300×300）、3~5 张截图、短/长描述、分类、隐私政策 URL、支持联系方式。

## 二、打包

把 `package.json` 里 `build.appx` 的 `identityName` / `publisher` / `publisherDisplayName` 换成真实值，然后：

```bash
npm run dist:appx   # 产出 dist/*.appx 与 .msixupload
```

把 `.msixupload` 上传到 Partner Center 提交审核（首次 1~3 个工作日）。

## 三、商店版与自建更新的关系（代码已处理）

- 主进程用 `process.windowsStore / APPX_PACKAGE_FAMILY_NAME` 判断是否商店版；
- 商店版：设置页提示「更新由商店统一推送」，**禁止应用内下载安装**；
- exe 版：继续走自建更新中心 + 对象存储三地域。

## 四、优缺点

| | 商店分发 | 自建 exe + 证书 |
| --- | --- | --- |
| SmartScreen | 无警告（微软签名） | 需买 OV/EV 证书 |
| 成本 | 19/99 美元一次性 | ¥1000~6000 / 年 |
| 更新 | 商店推，审核后生效 | 自己控，分钟级 |
| 分发 | 只能走 Store | U 盘/内网/链接都行 |
