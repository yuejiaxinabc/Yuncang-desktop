# 云仓桌面专用接口契约（v1）

桌面客户端 `cloud-warehouse-desktop` 优先连 `/api/v1/desktop`，探测 404 时自动退回 `/api/v1/open`。
想给桌面端单独开后门（更少的字段、更快的响应、设备级会话），照这份契约实现即可，客户端不用改。

## 1. 鉴权

```http
Authorization: Bearer <token>
```

- token 在桌面端首次启动时由用户填写，用 Electron safeStorage（Windows DPAPI）加密存本机，之后自动带上。
- 服务端可沿用现有 `yc_live_` 密钥体系；也可以发更短的桌面 token，只要 `/me` 能返回权限即可。
- 401 统一表示「密钥无效 / 停用 / 过期 / IP 不在白名单」——客户端据此弹「密钥已失效」并跳设置页。

## 2. 统一响应信封

成功：

```json
{ "success": true, "data": { }, "message": "可选提示" }
```

失败：

```json
{ "success": false, "error": "可读的中文说明", "code": "可选机器码" }
```

状态码约定：400 参数不合法 / 401 密钥失效 / 403 权限或仓库越界 / 404 接口不存在（客户端据此判断降级）/
409 幂等冲突 / 429 限速 / 5xx 服务端异常。

## 3. 必需接口

| 方法 | 路径 | 作用 | 必返回 |
| --- | --- | --- | --- |
| GET | `/api/v1/desktop/me` | 密钥自检 | `name, keyPrefix, scopes[], warehouseIds[], serverTime` |
| GET | `/api/v1/desktop/catalog` | 自描述作业目录 | `endpoints[], lockedEndpoints[], scopes[], summary, conventions` |

`endpoints[]` 每项：

```json
{
  "id": "inventory",
  "method": "GET",
  "path": "/api/v1/desktop/inventory",
  "scope": "inventory:read",
  "title": "实时库存",
  "desc": "各仓库结存快照",
  "params": [{ "name": "page", "in": "query", "type": "number", "required": false, "desc": "页码" }]
}
```

- `scope: null` 表示不需要权限（如 `/me`）。
- 客户端按 `scopes[]` 过滤：有的进菜单，没的进「需要授权」区并显示 `missingScope`。
- 参数 `in` 只认 `query` 与 `body`；`type` 支持 `string/number/boolean/json`，
  `json` 在界面上渲染成多行文本域（明细数组用它）。

## 4. 建议首批实现（覆盖仓库日常作业）

| 方法 | 路径 | scope |
| --- | --- | --- |
| GET | `/api/v1/desktop/inventory` | `inventory:read` |
| GET | `/api/v1/desktop/products` | `product:read` |
| GET | `/api/v1/desktop/warehouses` | `warehouse:read` |
| GET | `/api/v1/desktop/reports/low-stock` | `report:read` |
| POST | `/api/v1/desktop/stock-in` | `stock:write` |
| POST | `/api/v1/desktop/stock-out` | `stock:write` |
| POST | `/api/v1/desktop/transfer` | `transfer:write` |
| POST | `/api/v1/desktop/stocktake` | `stocktake:write` |

列表返回 `{ items: [], total, page, pageSize }`；写接口建议支持 `Idempotency-Key` 请求头
（同 key 24 小时只执行一次，换请求体返 409）。

## 5. 设备与会话（可选）

- `POST /api/v1/desktop/device/register`：上报 `deviceId`（客户端首次生成并持久化）、主机名、版本、系统。
- `POST /api/v1/desktop/session/refresh`：如果以后想做短 token + 刷新，返回 `{ token, expiresAt }`。
- `POST /api/v1/desktop/heartbeat`：桌面端每 5 分钟报活，服务端据此判定在线。

## 6. 兼容策略

1. 客户端启动先打 `GET /api/v1/desktop/me`；
2. 404 → 视为「服务端没有桌面档位」，退回 `GET /api/v1/open/me` 与 `GET /api/v1/open`；
3. 401/403/网络错误不降级，直接提示用户（避免把「密钥错了」误判成「接口没有」）。

服务端上线桌面接口后，用户在设置页点「重新连接」即切过去，不需要重装客户端。
