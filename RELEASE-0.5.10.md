# 云仓桌面端 0.5.10

## 修了你报的 4 个问题

1. **小窗 / 放大都滑不动**
   根因不是「没写 overflow」：`.main` 作为 grid 子项默认 `min-height:auto`，内容一长就把自己顶到窗口外面，再被 `body{overflow:hidden}` 裁掉，于是滑轮完全没反应。
   现在 `.shell` 固定网格行、`.main` 加 `min-height:0; overflow:hidden`，`.content` 真正内部滚动。
   实测：1040×680 下工作台内容 811px、可视 588px，能滚 222px；设置页 1719px → 能滚 1130px。

2. **放置货位不显示 / 报「该仓还没建货位」**
   真正原因是服务端 `/api/v1/open/warehouses?withLocations=1` 只返回 `zones[].locations[]`，**没有下发四段小货位 boxes**，客户端拿不到可选项。
   这版做了三件事：
   - 三个层级（warehouse.boxes / zone.boxes / location.boxes）任一出现都能识别，编码缺段自动补齐；
   - 服务端没下发时不再只显示一句话，而是把手填框放上去：直接填 `A-01-02-03`，服务端 `findBoxByAnyCode` 能解析；
   - 提示按原因分开：「仓库还没建货位」vs「服务端没下发小货位（需要后端补 boxes）」。

3. **出库批量过账：DRAFT 不允许过账**
   服务端规则是出库单只有 `APPROVED / LOCKED` 能过账，草稿必须先审核。0.5.9 把草稿也列成可过账，等于让你点了必失败。
   现在出库草稿只显示「待审核」标签，批量过账也只在 APPROVED/LOCKED 里选，失败会直说要去 Web 端审核。

4. **下载导入模板失败**
   写表逻辑从 main.js 抽到 `src/main/tables.js`（可单测：xlsx 写出/读回、csv 带 BOM），模板表头加粗、列宽自适应；
   保存对话框现在带父窗口 —— Windows 上无父窗口的保存框会跑到主窗口后面，看起来就是「点了没反应」；失败时带 `code`，不再只有一句「导出失败」。

## 其他

- **SDK 升级到 1.1.0**（`cloud-warehouse-sdk/javascript/dist`，含 30 条接口清单与 `locations`/`available` 资源），页脚与设置页显示成 `v0.5.10 · SDK 1.1.0`。
- 表格导出/导入、盘点导出全部走同一套写表实现，不再有第二份互相覆盖的代码。

## 自测

- `npm run smoke` 21/21（含表格写入、草稿箱、打印偏好、SDK 适配）
- `npm run ui:check` 17/17（点击链路 + 0.5.8 七条逐项回归）
- `npm run scroll:check` 1040×680 / 1280×832 / 1600×1000 三档均能滚
- `npm run inbound:check` 服务端无 boxes 时手填四段编码可提交，请求体带 boxCode 不带 boxId

## 还需要服务端配合

`GET /api/v1/open/warehouses?withLocations=1` 请把四段小货位一起返回（建议 `zones[].locations[].boxes[]`，每项 `{id, code, status}`）。
在补上之前，桌面端只能让用户手填四段编码，选不了、也看不到哪些货位可用、是否封存。
