'use strict';

/**
 * 渲染层点击链路自检（0.5.9）
 *
 * 起一个 mock 服务 → 用临时 userData 目录写一份配置 → 起 Electron 跑 --smoke-ui，
 * 在渲染层里点一遍「单据记录 → 查看 → 过账 → 勾选 → 设置页诊断」，
 * 把结果和 console 错误一起收回来。
 *
 * 0.5.8 的 t is not defined 就是这种点击才暴露的，纯主进程 smoke 抓不到。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { start } = require('./mock-server');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.UI_CHECK_PORT || 20000 + Math.floor(Math.random() * 10000));

function fail(msg) {
  console.error('FAIL ' + msg);
  process.exitCode = 1;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-'));
  const { server } = await start(PORT);

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    version: 1,
    baseUrl: 'http://127.0.0.1:' + PORT,
    token: 'yc_live_goodkey_1234567890',
    enc: 'plain',
    apiProfile: 'desktop',
    label: 'ui-check',
    savedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({ version: 1, printHeader: '云仓测试抬头', printFooter: '测试落款', operator: '张三' }));

  const args = [
    '.', '--smoke-ui',
    '--user-data-dir=' + dir,
    '--eval-file=' + path.join(__dirname, 'eval', 'ui-check.js'),
    '--shot=' + path.join(dir, 'ui.png'),
  ];
  // 注意：DSH / 某些终端会带 ELECTRON_RUN_AS_NODE=1，那会让 Electron 退化成纯 Node，
  // app / ipcMain 全是 undefined，必须在这一层摘掉。
  const env = Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '' });
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), args, { cwd: ROOT, env });

  let out = '';
  child.stdout.on('data', (c) => { out += c.toString(); });
  child.stderr.on('data', (c) => { out += c.toString(); });

  const code = await new Promise((resolve) => child.on('exit', resolve));
  server.close();

  const line = out.split('\n').find((l) => l.startsWith('SMOKE_EVAL '));
  const uiLine = out.split('\n').find((l) => l.startsWith('SMOKE_UI '));
  if (!line) {
    fail('渲染层脚本没有返回结果（exit=' + code + '）\n' + out.slice(-3000));
    return;
  }
  const r = JSON.parse(line.slice('SMOKE_EVAL '.length));
  const checks = [
    ['渲染层没有未捕获异常', r.errors.length === 0, JSON.stringify(r.errors)],
    ['连上 mock 并进到工作台', r.steps.view === 'workbench', String(r.steps.view)],
    ['服务端能力齐全时不出现「版本偏旧」横幅', r.steps.oldServerBanner === false, String(r.steps.oldServerBanner)],
    ['单据记录有数据行', Number(r.steps.orderRows) > 0, String(r.steps.orderRows)],
    ['单据筛选控件齐全', r.steps.orderToolbar === true, String(r.steps.orderToolbar)],
    ['「查看」能打开详情（0.5.8 会抛 t is not defined）', r.steps.dialogTitle && r.steps.dialogRows > 0, JSON.stringify([r.steps.dialogTitle, r.steps.dialogRows])],
    ['单张过账给出反馈', !!r.steps.toast, String(r.steps.toast)],
    ['勾选行生效', Number(r.steps.selectedCount) >= 1, String(r.steps.selectedCount)],
    ['设置页有服务端诊断卡片', r.steps.diagCard === true, String(r.steps.diagCard)],
    ['设置页有打印设置卡片', r.steps.prefsCard === true, String(r.steps.prefsCard)],
    ['页脚显示版本 + SDK 版本', /v\d+\.\d+\.\d+/.test(String(r.steps.version)) && /SDK 1\.1\.0/.test(String(r.steps.version)), String(r.steps.version)],
    ['0.5.8 第 1 条：入库货位是四段下拉且带 boxId/boxCode', Number(r.steps.boxSelects) > 0 && (r.steps.boxOptions || []).some(function (v) { return /\|[A-Za-z0-9]+-\d+-\d+-\d+$/.test(v); }), JSON.stringify(r.steps.boxOptions)],
    ['0.5.8 第 2 条：入库类型 6 种', Number(r.steps.inboundTypeCount) === 6, JSON.stringify(r.steps.inboundTypes)],
    ['0.5.8 第 3 条：小窗口内容区可滚动', String(r.steps.contentOverflow).indexOf('auto') >= 0 || String(r.steps.contentOverflow).indexOf('scroll') >= 0, String(r.steps.contentOverflow)],
    ['0.5.8 第 6 条：调拨发运按钮可用且调用成功', r.steps.transferSendBtn === true && /发运/.test(String(r.steps.transferToast)), JSON.stringify([r.steps.transferSendBtn, r.steps.transferToast])],
    ['0.5.8 第 4 条：盘点录入实盘能拉出明细', r.steps.countBtn === true && Number(r.steps.countRows) > 0 && r.steps.countSettleBtn === true, JSON.stringify([r.steps.countBtn, r.steps.countRows, r.steps.countSettleBtn])],
    ['0.5.8 第 5 条：打印带抬头/合计/签字栏', r.steps.printCapture && r.steps.printCapture.hasHeader && r.steps.printCapture.hasSign && r.steps.printCapture.hasTotal, JSON.stringify(r.steps.printCapture)],
  ];
  let bad = 0;
  for (const [name, ok, detail] of checks) {
    if (ok) console.log('PASS ' + name);
    else { bad++; console.log('FAIL ' + name + ' :: ' + detail); }
  }
  if (uiLine) console.log(uiLine.slice(0, 400));
  console.log(bad ? ('UI_CHECK_FAILED ' + bad) : 'UI_CHECK_OK');
  if (bad) process.exitCode = 1;
})().catch((e) => {
  console.error('FAIL 自检脚本异常：' + ((e && e.stack) || e));
  process.exitCode = 1;
});
