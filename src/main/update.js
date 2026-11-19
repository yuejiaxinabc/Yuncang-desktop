'use strict';

/**
 * 客户端自动更新（清单 v2，兼容旧的 v1 /api/version）
 *
 * 多源并发探测：更新中心 + 对象存储三地域，谁快用谁。
 * 清单两种形态：
 *   v2  { schema:2, product, channel, latest:{ version, platform, sha256, size, sources[], notes, mandatory, minVersion, rollout } }
 *   v1  { version, notes, sha256, size, sources[] }（早期 /api/version?channel=desktop）
 * iOS 等禁自更新的平台只做「提示」，由上层决定是否展示按钮。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PRODUCT = 'yuncang-desktop';
const CHANNEL = 'stable';
// 测试/自建环境可用环境变量覆盖
const HUB = process.env.YC_UPDATE_HUB || 'https://update.yuejiaxin.ln.cn';
// 2026-11 起对象存储只保留北京一个桶（南京、成都已停用，回包是 NoSuchBucket 404）。
// 只探活着的源：少两个必然失败的请求，更新检查少等 4 秒。
const COS = (process.env.YC_UPDATE_COS || [
  'https://updata-1307293667.cos.ap-beijing.myqcloud.com',
].join(',')).split(',').filter(Boolean);

function platformOf() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}
function archOf() {
  const a = process.arch;
  if (a === 'x64' || a === 'arm64') return a;
  return 'x64';
}
function platformKey() { return platformOf() + '-' + archOf(); }

function manifestUrls(platform) {
  const p = platform || platformKey();
  const q = '?product=' + PRODUCT + '&platform=' + p + '&channel=' + CHANNEL;
  // 注意：/api/version 是「云仓服务端」的版本接口，不能给桌面端用（会拿到 1.4.x）。
  // 桌面端只认 v2 清单与 COS 上的桌面清单。
  const list = [HUB + '/api/v2/manifest' + q];
  COS.forEach((base) => list.push(base + '/apps/' + PRODUCT + '/' + CHANNEL + '/' + p + '/manifest.json'));
  COS.forEach((base) => list.push(base + '/desktop/setup/latest.json')); // 0.4.x 老布局
  return list;
}

function cmp(a, b) {
  const pa = String(a || '0').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function timedFetch(url, timeoutMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
    const text = await res.text();
    return { url, ok: res.ok, status: res.status, ms: Date.now() - started, text };
  } catch (e) {
    return { url, ok: false, status: 0, ms: Date.now() - started, error: (e && e.message) || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 把 v2 latest 或 v1 平铺结构统一成内部形状 */
function normalize(json, source) {
  if (!json) return null;
  // 产品对不上就丢弃（防止旧接口/别的产品混进来）
  if (json.product && json.product !== PRODUCT) return null;

  if (json.schema === 2 && json.latest && json.latest.version) {
    const l = json.latest;
    return {
      source,
      schema: 2,
      version: l.version,
      notes: l.notes || '',
      sha256: l.sha256 || '',
      size: l.size || 0,
      sources: Array.isArray(l.sources) ? l.sources : [],
      mandatory: !!l.mandatory,
      minVersion: l.minVersion || '',
      rollout: l.rollout || null,
      platform: l.platform || platformKey(),
      raw: json,
    };
  }
  if (json.version) {
    return {
      source,
      schema: 1,
      version: json.version,
      notes: json.notes || '',
      sha256: json.sha256 || '',
      size: json.size || 0,
      sources: Array.isArray(json.sources) ? json.sources : (json.url ? [json.url] : []),
      mandatory: !!json.mandatory,
      minVersion: '',
      rollout: null,
      platform: platformKey(),
      raw: json,
    };
  }
  return null;
}

async function probeAll(platform) {
  const results = await Promise.all(manifestUrls(platform).map((u) => timedFetch(u, 4000)));
  const reachableNotFound = results.filter((r) => r.status === 404).length;
  const out = [];
  for (const r of results) {
    if (!r.ok || !r.text) continue;
    try {
      const m = normalize(JSON.parse(r.text), r.url);
      if (m) out.push({ ms: r.ms, m });
    } catch (e) {}
  }
  out.sort((a, b) => a.ms - b.ms);
  out.reachableNotFound = reachableNotFound;
  return out;
}

/** 用 HEAD 测速（不要为了测速把 80MB 包拉下来） */
async function headLatency(url, timeoutMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 3500);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
    return { url, ok: res.ok || res.status === 206, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { url, ok: false, status: 0, ms: Date.now() - started, error: (e && e.message) || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function rankSources(urls) {
  return Promise.all(urls.map((u) => headLatency(u, 3500)))
    .then((list) => list.filter((x) => x.ok).sort((a, b) => a.ms - b.ms));
}

function rolloutHit(manifest, installId) {
  const r = manifest.rollout;
  if (!r || r.percent === undefined || r.percent === null) return true;
  if (r.percent >= 100) return true;
  const h = crypto.createHash('sha256').update(String(installId || '')).digest('hex').slice(0, 8);
  return (parseInt(h, 16) % 100) < Number(r.percent);
}

async function check(currentVersion, opts) {
  const o = opts || {};
  const platform = o.platform || platformKey();
  const probed = await probeAll(platform);
  if (!probed.length) {
    // 源能连通但都没有这个平台/产品的清单 → 不是故障，是「还没发这个平台」
    if (probed.reachableNotFound) {
      return { ok: true, product: PRODUCT, platform, currentVersion, latest: currentVersion, hasUpdate: false, noRelease: true, notes: '', sources: [], message: '这个平台还没有发布版本（' + platform + '）' };
    }
    return { ok: false, error: '所有更新源都不可达（更新中心与对象存储三地域）', tried: manifestUrls(platform) };
  }
  let best = probed[0];
  for (const p of probed) if (cmp(p.m.version, best.m.version) > 0) best = p;

  const m = best.m;
  const newer = cmp(m.version, currentVersion) > 0;
  const inRollout = rolloutHit(m, o.installId);
  const belowMin = m.minVersion ? cmp(currentVersion, m.minVersion) < 0 : false;
  const ranked = m.sources.length ? await rankSources(m.sources) : [];

  return {
    ok: true,
    product: PRODUCT,
    platform,
    currentVersion,
    latest: m.version,
    hasUpdate: newer && inRollout,
    waitingRollout: newer && !inRollout,
    mandatory: m.mandatory || belowMin,
    belowMin,
    notes: m.notes,
    sha256: m.sha256,
    size: m.size,
    schema: m.schema,
    sourceUsed: best.m.source,
    latencyMs: best.ms,
    probes: probed.map((p) => ({ source: p.m.source, version: p.m.version, schema: p.m.schema, ms: p.ms })),
    sources: ranked,
  };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('data', (c) => h.update(c));
    rs.on('error', reject);
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

async function download(url, sha256, onProgress) {
  const dir = path.join(os.tmpdir(), 'yuncang-update');
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(new URL(url).pathname) || '.bin';
  const file = path.join(dir, 'yuncang-setup' + ext);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error('下载失败：HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(file);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    out.write(chunk);
    if (onProgress) onProgress(total ? Math.min(100, Math.round((got / total) * 100)) : 0, got, total);
  }
  await new Promise((r) => out.end(r));
  if (sha256) {
    const gotHash = await sha256File(file);
    if (gotHash.toLowerCase() !== String(sha256).toLowerCase()) {
      try { fs.rmSync(file, { force: true }); } catch (e) {}
      throw new Error('安装包校验失败：期望 ' + String(sha256).slice(0, 12) + '… 实际 ' + gotHash.slice(0, 12) + '…');
    }
  }
  return { file, bytes: got };
}

function runInstaller(file) {
  return new Promise((resolve, reject) => {
    try {
      if (process.platform === 'win32') {
        spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
        return resolve({ started: true, how: 'nsis-silent' });
      }
      if (process.platform === 'darwin' && file.endsWith('.dmg')) {
        spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
        return resolve({ started: true, how: 'dmg-open' });
      }
      spawn('chmod', ['+x', file]).on('exit', () => {
        spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
        resolve({ started: true, how: 'exec' });
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { check, download, runInstaller, cmp, platformKey, PRODUCT, CHANNEL, manifestUrls };
