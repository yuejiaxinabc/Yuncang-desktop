# 云仓桌面端 0.5.11

## 修了你自己踩到的两个问题

### 1. 导出 / 下载导入模板失败：`Cannot find module 'call-bind-apply-helpers'`

不是 exceljs 没打进包，是它的传递依赖在 asar 里断链：
`unzipper → chainsaw → traverse → which-typed-array → call-bind → get-intrinsic → call-bind-apply-helpers`，
最后一个没被 electron-builder 收进去，于是 require 到就把整棵链拉垮。

修法：用 esbuild 把 exceljs 预打包成单文件 `src/main/vendor/exceljs.bundle.cjs`（2.3MB，进 asar），
运行时不再经过 node_modules 解析。写表/读表都走这份，模板下载、商品导出、盘点导出一起恢复。

### 2. 大盘点填实盘数量不出差异，保存还说「请填写实盘数量」

0.5.8 起就有的 bug：输入监听器第一行是
`if (!t.id && !t.getAttribute('data-line')) return;`
而盘点输入框只有 `data-count`，一个都不占 —— 打字被直接 return 掉，
所以界面上差异一直是「—」，保存时读到的还是空值，服务端自然回「请填写实盘数量」。

修完：实盘数字边打边算差异，顶部「已盘 x/y」「差异 n」实时变，保存只提交填过的行。

## 自测

- `npm run count:check` 9/9：账面 1240 → 填 1250 差异 +10、填 86→差异 0、两行计 2/2、保存 PATCH 带 `items[{itemId,countQty}]`
- `npm run smoke` 21/21（含 xlsx 写出/读回、csv BOM）
- `npm run ui:check` 17/17、`npm run scroll:check` 三档窗口、`npm run inbound:check` 5/5

## 仍然需要服务端

`/api/v1/open/warehouses?withLocations=1` 请补 `locations[].boxes[]`（四段小货位）。
补上之前桌面端只能手填 `A-01-02-03`。
