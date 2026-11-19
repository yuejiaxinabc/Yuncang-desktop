#!/usr/bin/env node
'use strict';

/**
 * 生成更新清单（配合 docs/UPDATE-CENTER-PLAN.md）
 *
 * 用法：
 *   node scripts/make-manifest.js --version 0.5.0 --file ./云仓-0.5.0-x64.exe \
 *     --notes "本版本修复了\n1. …" --base https://updata-1307293667.cos.ap-beijing.myqcloud.com
 *
 * 产物：manifest.json（写到 stdout 或 --out 指定路径）
 * 上传：
 *   apps/yuncang-desktop/stable/win-x64/manifest.json
 *   apps/yuncang-desktop/stable/0.5.0/win-x64.exe
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const version = arg('version');
const file = arg('file');
const notes = arg('notes', '');
const product = arg('product', 'yuncang-desktop');
const channel = arg('channel', 'stable');
const platform = arg('platform', process.platform === 'win32' ? 'win-x64' : (process.platform === 'darwin' ? 'mac-arm64' : 'linux-x64'));
const base = arg('base', 'https://updata-1307293667.cos.ap-beijing.myqcloud.com');
const out = arg('out', '');

if (!version || !file) {
  console.error('缺少 --version 或 --file');
  process.exit(1);
}

const size = fs.statSync(file).size;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const name = path.basename(file);
const key = ['apps', product, channel, version, name].join('/');
// 对象存储只剩北京一个桶（南京、成都 2026-11 停用）
const regions = [
  'https://updata-1307293667.cos.ap-beijing.myqcloud.com',
];

const manifest = {
  schema: 2,
  product,
  channel,
  generatedAt: new Date().toISOString(),
  latest: {
    platform,
    version,
    minVersion: arg('min', ''),
    mandatory: process.argv.includes('--mandatory'),
    publishedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    notes: notes.replace(/\\n/g, '\n'),
    size,
    sha256,
    sources: regions.map((r) => r + '/' + key).concat([base + '/' + key]).filter((v, i, a) => a.indexOf(v) === i),
    rollout: { percent: Number(arg('percent', '100')) },
  },
  history: [],
};

const json = JSON.stringify(manifest, null, 2);
if (out) {
  fs.writeFileSync(out, json + '\n');
  console.error('written ' + out + ' (' + size + ' bytes, sha256 ' + sha256.slice(0, 12) + '…)');
} else {
  process.stdout.write(json + '\n');
}
