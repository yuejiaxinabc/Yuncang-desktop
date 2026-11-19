'use strict';

/**
 * 更新检查自检：起一个本地「假更新中心」，验证 v2 清单解析、多源测速、版本比较、灰度、校验。
 *   node test/update-check.js
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 9977;
const artifact = path.join(os.tmpdir(), 'yc-fake-setup.exe');
fs.writeFileSync(artifact, Buffer.from('FAKE-INSTALLER-'.repeat(100)));

const sha = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const manifestV2 = {
  schema: 2,
  product: 'yuncang-desktop',
  channel: 'stable',
  latest: {
    platform: 'win-x64',
    version: '0.5.0',
    minVersion: '0.3.0',
    mandatory: false,
    notes: '本版本修复了\n1. 更新链路',
    size: fs.statSync(artifact).size,
    sha256: sha,
    sources: ['http://127.0.0.1:' + PORT + '/dl/slow.exe', 'http://127.0.0.1:' + PORT + '/dl/win-x64.exe'],
    rollout: { percent: 100 },
  },
  history: [],
};
const legacy = { version: '0.4.9', notes: '旧接口', sha256: sha, size: 10, sources: ['http://127.0.0.1:' + PORT + '/dl/win-x64.exe'] };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/v2/manifest') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(manifestV2)); }
  if (u === '/api/version') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(legacy)); }
  if (u === '/dl/win-x64.exe') {
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': 10 }); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(fs.readFileSync(artifact));
  }
  if (u === '/dl/slow.exe') {
    if (req.method === 'HEAD') { setTimeout(() => { res.writeHead(200, { 'content-length': 10 }); res.end(); }, 300); return; }
    setTimeout(() => { res.writeHead(200); res.end(fs.readFileSync(artifact)); }, 300);
    return;
  }
  res.writeHead(404); res.end('nope');
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  process.env.YC_UPDATE_HUB = 'http://127.0.0.1:' + PORT;
  process.env.YC_UPDATE_COS = 'http://127.0.0.1:' + PORT;
  const upd = require('../src/main/update');

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
  };

  const r = await upd.check('0.4.1', { installId: 'dev-1', platform: 'win-x64' });
  check('清单可读且识别为新版本', r.ok && r.hasUpdate, JSON.stringify(r).slice(0, 200));
  check('v2 优先于 v1（latest 取 0.5.0）', r.latest === '0.5.0', r.latest);
  check('版本比较正确', upd.cmp('0.5.0', '0.4.9') === 1 && upd.cmp('0.4.1', '0.5.0') === -1);
  check('多源已按测速排序（快源在前）', r.sources.length === 2 && r.sources[0].url.indexOf('win-x64') >= 0, JSON.stringify(r.sources));
  check('平台键正确', /^(win|mac|linux)-(x64|arm64)$/.test(r.platform), r.platform);

  const same = await upd.check('0.5.0', { installId: 'dev-1', platform: 'win-x64' });
  check('同版本不提示更新', same.ok && !same.hasUpdate);

  const got = await upd.download(r.sources[0].url, sha, () => {});
  check('下载并校验 sha256', got.bytes > 0 && fs.existsSync(got.file));

  let bad = false;
  try { await upd.download(r.sources[0].url, 'deadbeef', () => {}); } catch (e) { bad = /校验失败/.test(e.message); }
  check('sha256 不符时拒绝并删包', bad);

  manifestV2.latest.rollout = { percent: 0 };
  const g2 = await upd.check('0.4.1', { installId: 'x', platform: 'win-x64' });
  check('灰度 0% 时不放量', g2.waitingRollout === true && g2.hasUpdate === false);

  server.close();
  fs.rmSync(artifact, { force: true });
  console.log('\n' + pass + '/' + (pass + fail) + ' 项通过');
  process.exit(fail ? 1 : 0);
})();
