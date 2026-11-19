# 云仓桌面端 0.6.1

## 导出 / 下载模板：双保险，不再因为缺依赖报错

你截图里的报错链是
`tables.js → node_modules/exceljs/excel.js → unzipper → chainsaw → traverse → which-typed-array → call-bind → get-intrinsic → call-bind-apply-helpers（缺失）`。
两个层面都处理了：

1. **exceljs 预打包成单文件**（0.5.11 起）：`src/main/vendor/exceljs.bundle.cjs`，运行时不再解析 node_modules，as ar 里少谁都不影响。
2. **内置零依赖 xlsx 写入器**（本版新增）：`src/main/xlsx-lite.js`，纯 JS 写「存储模式 zip + 最小 SpreadsheetML」。
   exceljs 不可用时自动切换，导出的文件 Excel / WPS / Numbers 都能打开（已用 exceljs 回读校验单元格）。
   也就是说：**即使包被拆、vendor 文件丢了，导出和模板下载也不会再红字失败。**

顺带：写表失败时的返回里带 `engine`（`xlsx` / `xlsx-lite`）与具体原因，不再只有一句「写入失败」。

### 导入 Excel 也一并修了

导入原来在 `file:pick-table` 里直接 `require('exceljs')` 解析，同样会撞上面那条断链。
现在导入也走 `tables.readTable`：优先预打包版 exceljs，缺件时用 **内置纯 JS xlsx 读取器**
（自己解 zip：store/deflate 都支持，读 sharedStrings / inlineStr / 数字），
用 Excel 生成的文件实测能读回 `P1 / 手套 & 口罩 / 12`。CSV 导入不变。

## 你机器上的那份是旧包

截图里的路径是
`C:\Users\admin.8X4IJWXPG28ZULL\Desktop\新建文件夹\cloud-warehouse-desktop\resources\app.asar`
—— 这是把 `win-unpacked` 整个拷到桌面用的绿色版，里面 `src/main/tables.js` 还是老代码（`require('exceljs')`），所以还在走 node_modules 那条断链。
换成 0.6.1 安装包（或把 0.6.1 的 `win-unpacked` 重新拷一份）即可；判断标准：新版 asar 里一定有
`/src/main/vendor/exceljs.bundle.cjs` 与 `/src/main/xlsx-lite.js`。

## 自测

- `npm run smoke` 22/22，新增一条：强制 `YC_FORCE_LITE=1`（模拟 exceljs 缺件）时导出仍落地，并用 exceljs 回读校验
- `npm run ent:check` 9/9、`ui:check` 17/17、`count:check` 9/9、`inbound:check` 5/5
