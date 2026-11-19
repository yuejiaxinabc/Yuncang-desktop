# 云仓桌面端 0.6.2

## 商品导入模板：改成与 Web 端同一套列结构

之前桌面端自己写了个 6 列小模板（code/name/barcode/unit/category/safetyStock），和 Web 的
`/api/products/template` 完全对不上，导回去当然报「表头不匹配」。现在按 `src/lib/product-excel.ts` 的
`BASE_COLUMNS / buildColumns / buildTemplate` 复刻：

- **列结构**：无仓库 16 列 / 有仓库 18 列（把「仓库」「货位编码」插在「初始数量」前面，两列必填）
  `商品编码* | 商品名称* | 条码 | 分类 | 单位 | 规格 | 品牌 | 型号 | 成本方法 | 默认成本 | 售价 | 安全库存 | 启用序列号 | 启用批次 |（仓库* | 货位编码*）| 初始数量 | 备注`
- **表头样式**：蓝底白字，必填列红底；首行冻结
- **数据验证下拉**：仓库（系统仓库名）、分类、单位、成本方法（加权平均/先进先出/月加权 + WEIGHTED/FIFO/MONTHLY）、是否列（是/否）
- **数字格式**：默认成本/售价 `0.00`，安全库存/初始数量 `0.000`
- **第二张 sheet「填写说明」**：逐列说明 + 必填标记 + 5 条注意事项（含货位四段规则）
- 有仓库时才加那两列 —— 和 Web 的 `buildColumns(hasWarehouse)` 判定一致（按当前可见仓库判断）

## 品牌标识更正

侧栏英文名由 `CLOUD WAREHOUSE` 改为 **`YUNCANG`**（云仓的对外英文名就是 YUNCANG，不是直译的 CLOUD WAREHOUSE）。

## 新增入口：登录企业版

私有化部署界面里直接给出企业版入口，不用先猜怎么切：

- 首次配置页底部：**「已有企业版账号？登录企业版」**
- 设置页顶部工具条：**「登录企业版」**
- 企业版登录页底部：**「返回私有化部署」**

点「登录企业版」= 切到企业版登录表单（平台地址 + 账号 + 密码 + 图形验证码），默认私有化部署不变。

## 模板来源：优先服务端实时生成

- **企业版**：直接 `GET /api/products/template`（会话 Cookie），拿服务端实时生成的 xlsx 存盘 —— 模板会随系统状态变，和浏览器下载的是同一个文件。
- **私有化部署**：开放接口里没有这个端点（`/api/products/template` 需要登录会话，客户端只有 API 密钥），所以按上面同一套列定义**本地生成**，保证「桌面下载 → Web 导入」表头能对上。

## 导入：企业版走服务端，私有化按 Web 规则本地校验

- 企业版：文件直接 `POST /api/products/import`（multipart），显示服务端返回的 `created / skipped / failed` 逐行结果。
- 私有化：本地解析后逐条建商品，**先按 Web 规则校验表头**——缺「商品编码」「商品名称」（有仓库时还要「仓库」「货位编码」）直接拒绝并提示「表头不匹配，请下载最新模板」；重复编码算「跳过」不算失败。
- 行映射同时认中文表头与早期英文表头；私有化只提交开放接口认识的字段，规格/品牌/仓库/货位等提示去 Web 导入。

## 自测

`npm run smoke` 26/26（新增：16/18 列结构与列序、两页/冻结/下拉/数字格式、表头校验拒绝）
`npm run ui:check` 17/17、`npm run ent:check` 9/9、`npm run count:check` 9/9

## 要服务端补的（私有化部署）

如果希望私有化部署也能用「服务端实时模板 + 服务端导入」（而不是客户端本地生成），需要在开放接口里加两条、并允许 API 密钥鉴权：

```
GET  /api/v1/open/products/template      -> 返回 xlsx 二进制（就是 /api/products/template 那份）
POST /api/v1/open/products/import        -> multipart file，返回 { created, skipped, failed, results[] }
```
现在 `/api/v1/open/products/template` 带 Bearer 访问是 404（路由不存在），`/api/products/template` 是 401（要会话）。
