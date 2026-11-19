# Yuncang Desktop

云仓桌面客户端，Electron 构建，只提供 Windows 版本。

版本 0.6.2 · Apache License 2.0

## 下载

安装包在 [Releases](https://github.com/yuejiaxinabc/Yuncang-desktop/releases)：

| 平台 | 文件 |
| --- | --- |
| Windows 10 / 11 / Server 2019+ x64 | `Yuncang-Setup-0.6.2-x64.exe` |

首次运行可能被 SmartScreen 提示「未知发布者」，点「更多信息 → 仍要运行」。

## 第一次打开

1. 填服务器地址，形如 `https://wms.example.com`，可带端口
2. 填 API 密钥，在云仓后台「设置 → API 管理」创建
3. 能操作哪些仓库由密钥的 scope 与授权仓库决定

## 功能

- 入库、出库、调拨、盘点、库存查询
- 扫码枪直接扫，标签打印对接打印机
- 长时间作业不掉线，本地缓存

## 开发

```bash
npm install
npm run dev
npm run build
```

## 目录

```
src/main/      主进程（窗口、菜单、更新）
src/renderer/  渲染层（工作台页面）
build/         图标与打包配置
```

变更记录见 [RELEASE-0.6.2.md](RELEASE-0.6.2.md)。

## 相关仓库

| 仓库 | 内容 | GitHub | Gitee |
| --- | --- | --- | --- |
| Yuncang | 服务端源码 | https://github.com/yuejiaxinabc/Yuncang | https://gitee.com/yuejiaxinabc/Yuncang |
| Yuncang-Update | 发布包（稳定版/测试版、离线包、安装脚本） | https://github.com/yuejiaxinabc/Yuncang-Update | https://gitee.com/yuejiaxinabc/Yuncang-Update |
| Yuncang-desktop | 桌面客户端 | https://github.com/yuejiaxinabc/Yuncang-desktop | https://gitee.com/yuejiaxinabc/Yuncang-desktop |
| Yuncang-MiniProgram | 微信小程序 | https://github.com/yuejiaxinabc/Yuncang-MiniProgram | https://gitee.com/yuejiaxinabc/Yuncang-MiniProgram |
| Yuncang-SDK | JavaScript / Python / Go SDK | https://github.com/yuejiaxinabc/Yuncang-SDK | https://gitee.com/yuejiaxinabc/Yuncang-SDK |
| Yuncang-index | 官网 | https://github.com/yuejiaxinabc/Yuncang-index | https://gitee.com/yuejiaxinabc/Yuncang-index |
