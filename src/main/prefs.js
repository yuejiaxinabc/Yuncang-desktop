'use strict';

/**
 * 本机偏好（不是凭据，随便丢也无所谓）
 *
 * 现在只放三样：
 *   - printHeader：单据打印的抬头（公司 / 门店名）
 *   - printFooter：页脚落款
 *   - operator：制单人，打印时签到单据上
 *
 * 位置：%APPDATA%\云仓客户端\prefs.json（macOS ~/Library/Application Support/云仓客户端/）
 * 与 config.json 分开存：改偏好不该动到密钥文件，清配置也不该把抬头一起清掉。
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'prefs.json';
const DEFAULTS = { printHeader: '云仓', printFooter: '云仓 · 开源仓储管理系统', operator: '' };
const MAX_LEN = 60;

function file(userDataDir) {
  return path.join(userDataDir, FILE);
}

function trim(v, fallback) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim();
  if (!s) return fallback;
  return s.slice(0, MAX_LEN);
}

function read(userDataDir) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(userDataDir), 'utf8')) || {};
  } catch (e) {
    raw = {};
  }
  return {
    printHeader: trim(raw.printHeader, DEFAULTS.printHeader),
    printFooter: trim(raw.printFooter, DEFAULTS.printFooter),
    operator: trim(raw.operator, DEFAULTS.operator),
    file: file(userDataDir),
    defaults: DEFAULTS,
  };
}

function write(userDataDir, input) {
  const dir = userDataDir;
  fs.mkdirSync(dir, { recursive: true });
  const current = read(dir);
  const payload = {
    version: 1,
    printHeader: trim(input && input.printHeader !== undefined ? input.printHeader : current.printHeader, DEFAULTS.printHeader),
    printFooter: trim(input && input.printFooter !== undefined ? input.printFooter : current.printFooter, DEFAULTS.printFooter),
    operator: trim(input && input.operator !== undefined ? input.operator : current.operator, DEFAULTS.operator),
    savedAt: new Date().toISOString(),
  };
  const target = file(dir);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, target);
  return read(dir);
}

module.exports = { read, write, file, DEFAULTS };
