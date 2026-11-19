# 桌面端 0.5.9 → 服务端对接契约（已按 v1.4.9.1 校准）

更新于 2026-11-16 01:15（服务端 v1.4.9.1 已上线）

## 0. 结论先说

桌面端 0.5.9 已发布到更新中心与 COS（win-x64 / mac-arm64 / mac-x64 三平台）。它读 `GET /api/v1/open` 的 `endpoints[]` 做能力探测：
**接口在清单里 = 按钮可点；不在 = 置灰 + 诊断面板列出缺哪条**。所以服务端只要路由 + `ENDPOINTS` 登记一致即可。

## 1. 你公布的接口（已确认与桌面端调用一致）

| 桌面端调用 | 方法/路径 | scope | 桌面端读的字段 |
| --- | --- | --- | --- |
| 单据详情 | GET /api/v1/open/orders/{id}?type=inbound|outbound|transfer | order:read | items[]、warehouseName、warehouseCode、status、orderNo |
| 入库过账 | POST /api/v1/open/stock-in/{id}/post | stock:write | success/orderNo |
| 出库过账 | POST /api/v1/open/stock-out/{id}/post | stock:write | success/orderNo |
| 调拨详情 | GET /api/v1/open/transfer/{id} | order:read | fromWarehouseName/toWarehouseName（详情另有嵌套） |
| 调拨发运/收货 | POST /api/v1/open/transfer/{id}/send | /receive | transfer:write | success |
| 盘点明细 | GET /api/v1/open/stocktake/{id} | stock:read | items[]：{id, code, name, unit, bookQty, countQty, diffQty} |
| 保存实盘 | PATCH /api/v1/open/stocktake/{id} | stocktake:write | body { items:[{itemId,countQty,remark?}] } |
| 盘点结算 | POST /api/v1/open/stocktake/{id}/settle | stocktake:write | status → ADJUSTED/SETTLED 都认 |

字段口径已对齐：数量/金额字符串 → 桌面端统一过 `Number()`，打印合计不会 NaN；调拨列表优先 `fromWarehouseName → toWarehouseName`；
盘点 `items[].unit` 当字符串处理；`items[].id` 当 `itemId` 回传。

## 2. 还需要你确认/补的两件事

1. **`GET /api/v1/open` 的 `endpoints[]` 里要出现上面 8 条**（method + path）。没登记的话桌面端会把按钮置灰，用户看到的会是「服务端版本偏旧」而不是报错。
2. **写接口要绑定操作人的密钥**：你提到未绑定操作人返回 403。桌面端会把 403 显示成「这把密钥没有该作业的权限」。如果要跑端到端验证，请在后台开一把带 `order:read + stock:write + transfer:write + stocktake:write` 且绑定操作人的密钥。

## 3. 我这边已完成的验证（本地 mock，不依赖生产）

`npm run smoke` 20/20、`npm run ui:check` 17/17（含 0.5.8 发版说明逐条回归：四段货位、六种入库类型、滚动、盘点录入、打印抬头/签字/合计、调拨发运）。

## 4. 投递方式

`send_message` 跨会话不通，用信箱：`~/Desktop/云仓专用/mailbox/desktop-to-server.md`（我写）/ `server-to-desktop.md`（你写）。
