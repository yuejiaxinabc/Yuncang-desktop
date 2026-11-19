# 云仓桌面端 0.6.0（企业版 + 私有化双模式）

## 两种部署模式，默认私有化

- **私有化部署（默认）**：和以前一样，填「服务器地址 + API 密钥」，走 `/api/v1/open`，功能全量（入库/出库/调拨/盘点/单据/打印）。
- **企业版（账号登录）**：只填账号密码 + 图形验证码，登录 SaaS 平台；数据仍然通过云仓 SDK 走平台接口（`/api/app/*`，会话 Cookie 鉴权）。
  首次进来是私有化配置页，顶部可切到「企业版（账号登录）」。

## 企业版做了什么

1. **登录链路**：`GET /api/auth/captcha` 拉图形验证码 → `POST /api/auth/platform/login`（account/password/captchaToken/captchaAnswer）→ 拿到 `yc_sess` 会话 Cookie，
   再 `GET /api/app/bootstrap` 读企业/套餐/成员/能力。验证码在界面里直接显示，点图换一张；填错自动换新图。
2. **会话存储**：Cookie 用 Electron safeStorage 加密落盘，密码不落盘；会话 2 小时过期 → 自动回登录页（重新要验证码）。
3. **数据映射**（经 SDK）：
   - 仓库 `/api/app/warehouses` → 仓库下拉；
   - 商品 `/api/app/products` → `sku` 当编码，支持建档（POST）；
   - 库存 `/api/app/inventory` → `sku/productName/warehouseName/qty/lockedQty/avgCost` 映射成结存/锁定/可用/均价。
4. **能力门禁**：平台 `capabilities`（inventory.read / product.read / stock.in …）映射成桌面端 scope；作业类入口在企业版一律置灰并标注「企业版未开放」。
5. 设置页换成「企业版身份」卡片（平台地址、企业、账号、成员、能力数）+ 退出企业版。

## 服务端需要你确认/补的（客户端改不了）

1. **平台登录强制图形验证码**：`/api/auth/platform/login` 不带/带错 `captchaToken+captchaAnswer` 一律 `CAPTCHA_INVALID`。
   桌面端已按平台行为显示验证码；若要「只填账号密码」，需要服务端给桌面端开一条不带验证码的设备/客户端登录（或 IP 白名单）。
2. **企业版没有出入库/调拨/盘点 REST 接口**：实测 `GET/POST /api/app/stock-in|stock-out|transfer|stocktake` 全部返回
   `{"code":"NOT_FOUND","message":"未实现的接口"}`。所以企业版目前只能做查询 + 商品建档；作业要么补这些端点，要么改走开放接口网关。
3. **开放接口网关（YC3-HMAC-SHA256，KeyId+Secret+SecretKey，Header X-YC-Tenant）的 base URL 未暴露**：
   `/api/v1/open` 在 SaaS 返回 404 `Route GET:/api/v1/open not found`（Fastify）。若要桌面端「用 SDK 调开放接口」，请给出网关地址与凭证下发方式。

## 自测

- `npm run ent:check` 9/9（mock 平台：验证码→登录→bootstrap→仓库/商品/库存映射→作业置灰→设置页）
- `npm run smoke` 21/21、`npm run ui:check` 17/17、`npm run count:check` 9/9（私有化模式无回归）
