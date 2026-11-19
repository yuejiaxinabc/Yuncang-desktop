'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程的能力白名单：配置读写、连接、接口调用。
 * 明文密钥不上桥——界面只看脱敏串。
 */
contextBridge.exposeInMainWorld('cw', {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    uninstall: () => ipcRenderer.invoke('app:uninstall'),
  },
  config: {
    status: () => ipcRenderer.invoke('config:status'),
    test: (payload) => ipcRenderer.invoke('config:test', payload),
    save: (payload) => ipcRenderer.invoke('config:save', payload),
    clear: () => ipcRenderer.invoke('config:clear'),
    reveal: () => ipcRenderer.invoke('config:reveal'),
  },
  session: {
    connect: () => ipcRenderer.invoke('session:connect'),
  },
  ent: {
    captcha: (payload) => ipcRenderer.invoke('ent:captcha', payload),
    login: (payload) => ipcRenderer.invoke('ent:login', payload),
    logout: () => ipcRenderer.invoke('ent:logout'),
  },
  api: {
    call: (payload) => ipcRenderer.invoke('api:call', payload),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    save: (payload) => ipcRenderer.invoke('prefs:save', payload),
  },
  drafts: {
    list: () => ipcRenderer.invoke('drafts:list'),
    add: (payload) => ipcRenderer.invoke('drafts:add', payload),
    remove: (id) => ipcRenderer.invoke('drafts:remove', id),
    clear: () => ipcRenderer.invoke('drafts:clear'),
    touch: (payload) => ipcRenderer.invoke('drafts:touch', payload),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: (payload) => ipcRenderer.invoke('update:install', payload),
    onProgress: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('update:progress', h);
      return () => ipcRenderer.removeListener('update:progress', h);
    },
  },
  template: {
    save: (payload) => ipcRenderer.invoke('template:save', payload),
    fetch: () => ipcRenderer.invoke('template:fetch'),
  },
  import: {
    upload: (payload) => ipcRenderer.invoke('import:upload', payload),
  },
  file: {
    pickCsv: () => ipcRenderer.invoke('file:pick-csv'),
    saveCsv: (payload) => ipcRenderer.invoke('file:save-csv', payload),
    pickTable: () => ipcRenderer.invoke('file:pick-table'),
    saveTable: (payload) => ipcRenderer.invoke('file:save-table', payload),
  },
});
