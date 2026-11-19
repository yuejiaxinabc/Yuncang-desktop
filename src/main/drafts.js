'use strict';

/**
 * 作业草稿箱：断网 / 服务端 5xx 时不让这一单白填
 *
 * 为什么要有：仓库现场 Wi-Fi 断、服务端重启、超时，这三种情况提交会失败。
 * 失败的作业如果只在界面上报一行红字，用户要么重填，要么凭记忆再录一遍；
 * 而重录最怕的就是「其实上一次已经落库了」，变成重复入库。
 *
 * 做法：
 *   1. 提交失败且错误属于可重试类（NETWORK / TIMEOUT / SERVER_ERROR）时，把整份请求体、
 *      目标接口、幂等键、标签一起存到本机 drafts.json；
 *   2. 重放时原样带上当天那个幂等键 —— 服务端 24 小时内同一个 key 只执行一次，
 *      所以「上一次其实成功了」的情况不会重复入账，只会拿回同一张单；
 *   3. 重放成功就从这个队列里删掉，失败就留着，等下次。
 *
 * 上限 50 条，先进先出丢最老的，避免无限长。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = 'drafts.json';
const MAX = 50;

function file(userDataDir) {
  return path.join(userDataDir, FILE);
}

function readAll(userDataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(file(userDataDir), 'utf8'));
    const items = j && Array.isArray(j.items) ? j.items : [];
    return items.filter((x) => x && typeof x === 'object' && x.id && x.path);
  } catch (e) {
    return [];
  }
}

function writeAll(userDataDir, items) {
  const dir = userDataDir;
  fs.mkdirSync(dir, { recursive: true });
  const target = file(dir);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: items.slice(0, MAX), savedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, target);
  return items.slice(0, MAX);
}

function newId() {
  return 'd' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

/** 存一单；同一幂等键重复存会覆盖（避免用户连点两下存两条） */
function add(userDataDir, draft) {
  const d = draft || {};
  const pathname = String(d.path || '');
  if (!pathname.startsWith('/api/v1/')) return { ok: false, error: '草稿只接受云仓接口路径' };
  const items = readAll(userDataDir);
  const idem = String(d.idempotencyKey || '');
  const at = new Date().toISOString();
  const entry = {
    id: String(d.id || newId()),
    kind: String(d.kind || 'job'),
    label: String(d.label || d.kind || '作业').slice(0, 80),
    path: pathname,
    method: String(d.method || 'POST').toUpperCase(),
    body: d.body && typeof d.body === 'object' ? d.body : {},
    idempotencyKey: idem,
    attempts: Number(d.attempts || 0) || 0,
    lastError: String(d.lastError || '').slice(0, 300),
    createdAt: at,
    updatedAt: at,
  };
  const existing = idem ? items.findIndex((x) => x.idempotencyKey === idem) : -1;
  if (existing >= 0) {
    entry.id = items[existing].id;
    entry.createdAt = items[existing].createdAt;
    items[existing] = entry;
  } else {
    items.unshift(entry);
  }
  const saved = writeAll(userDataDir, items);
  return { ok: true, item: entry, count: saved.length };
}

function remove(userDataDir, id) {
  const items = readAll(userDataDir);
  const next = items.filter((x) => x.id !== String(id));
  writeAll(userDataDir, next);
  return { ok: true, removed: items.length - next.length, count: next.length };
}

function clear(userDataDir) {
  const n = readAll(userDataDir).length;
  writeAll(userDataDir, []);
  return { ok: true, removed: n, count: 0 };
}

function touch(userDataDir, id, error) {
  const items = readAll(userDataDir);
  const it = items.find((x) => x.id === String(id));
  if (!it) return { ok: false, error: '草稿不存在' };
  it.attempts = Number(it.attempts || 0) + 1;
  it.lastError = String(error || '').slice(0, 300);
  it.updatedAt = new Date().toISOString();
  writeAll(userDataDir, items);
  return { ok: true, item: it };
}

module.exports = { readAll, add, remove, clear, touch, file, MAX };
