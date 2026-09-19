const { PostgrestClient } = require('@supabase/postgrest-js');

/**
 * 获取 Postgrest 客户端
 * 解决 Header 中文字符集导致的 ISO-8859-1 编码报错问题
 * 前端使用 btoa(unescape(encodeURIComponent(JSON.stringify(config)))) 编码
 */
const getPostgrestClient = (req) => {
  let token = '';
  let schema = 'public';

  const configHeader = req.headers['oneday-config'];
  if (configHeader) {
    try {
      let decodedStr = '';
      const trimmed = configHeader.trim();

      if (trimmed.startsWith('{')) {
        decodedStr = trimmed;
      } else {
        // 解码 Base64 -> URL 编码 -> UTF-8
        const binary = Buffer.from(trimmed, 'base64').toString('binary');
        decodedStr = decodeURIComponent(Array.from(binary).map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      }

      const config = JSON.parse(decodedStr);
      token = config.database_config?.token || config.jwtToken?.access_token;
      schema = config.database_config?.schema || 'public';
    } catch (e) {
      console.error('[Database Config Sync Failed]:', e.message);
    }
  }

  // 降级鉴权方案
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2) token = parts[1];
  }

  if (!token && req.auth) {
    token = req.auth.access_token || req.auth.token;
  }

  const REST_URL = 'https://1d.alibaba-inc.com/database';

  return new PostgrestClient(REST_URL, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    schema: schema
  });
};

module.exports = { getPostgrestClient };
