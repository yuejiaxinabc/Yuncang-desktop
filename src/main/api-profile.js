'use strict';

/**
 * 接口档位：桌面专用 API 优先，开放接口兜底
 *
 * 桌面专用 API 约定挂在 /api/v1/desktop 下（服务端还没上线时自动退回 /api/v1/open）。
 * 两套的响应信封一致：{ success, data, error }，鉴权都是 Authorization: Bearer <token>。
 * 详细契约见 docs/desktop-api-contract.md。
 */

const PROFILES = {
  desktop: {
    id: 'desktop',
    name: '桌面专用接口',
    base: '/api/v1/desktop',
    me: '/api/v1/desktop/me',
    catalog: '/api/v1/desktop/catalog',
  },
  open: {
    id: 'open',
    name: '开放接口',
    base: '/api/v1/open',
    me: '/api/v1/open/me',
    catalog: '/api/v1/open',
  },
};

function byId(id) {
  return PROFILES[id] || PROFILES.desktop;
}

/**
 * 探测：先试桌面专用接口，404/无此路由再退回开放接口。
 * 返回 { profile, me, catalog, tried: [...] } 或抛错（鉴权类错误直接上抛，不降级）。
 */
async function detect(client, preferred) {
  // 除显式指定 open 外，都按「桌面专用优先、404 回落开放接口」走；
  // 服务端降级/回滚时，配置里记着 desktop 也不会卡死。
  const order = preferred === 'open'
    ? [PROFILES.open]
    : [PROFILES.desktop, PROFILES.open];

  const tried = [];
  for (const p of order) {
    try {
      const me = await client.request(p.me, { timeoutMs: 12000 });
      tried.push({ profile: p.id, status: 200 });
      return { profile: p, me: me.data, tried };
    } catch (e) {
      tried.push({ profile: p.id, status: e.status || e.code });
      // 404/405 是明确的「没这个路由」；被网关/登录页拦住返回 HTML、被 WAF 403/限流 429、后端 5xx
      // 也说明「这个档位不可用」，都应该继续试下一档，而不是直接判死。
      const status = e.status || 0;
      const missingRoute = status === 404 || status === 405 || status >= 500 ||
        e.code === 'NOT_FOUND' || e.code === 'BAD_RESPONSE';
      if (!missingRoute) throw e;
    }
  }
  const err = new Error('服务器上没有可用的桌面接口（/api/v1/desktop）或开放接口（/api/v1/open）');
  err.code = 'NO_API';
  err.tried = tried;
  throw err;
}

module.exports = { PROFILES, byId, detect };
