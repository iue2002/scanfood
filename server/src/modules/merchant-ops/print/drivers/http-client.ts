/**
 * 共享的 driver HTTP 工具：所有云打印 driver 用这一份实现，避免重复
 *
 * 特点：
 * - timeout 包裹（超过即 destroy）
 * - 请求体 utf8 编码
 * - JSON 响应自动解析
 * - 错误统一返回 { ok: false, errorCode, errorMessage }
 */
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface HttpResult<T = any> {
  ok: boolean;
  status?: number;
  body?: T;
  errorCode?: string;
  errorMessage?: string;
}

export function postForm<T = any>(url: string, params: Record<string, string>, timeoutMs: number, headers: Record<string, string> = {}): Promise<HttpResult<T>> {
  const body = new URLSearchParams(params).toString();
  return doRequest<T>(url, 'POST', body, timeoutMs, {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...headers,
  });
}

export function postJson<T = any>(url: string, payload: any, timeoutMs: number, headers: Record<string, string> = {}): Promise<HttpResult<T>> {
  const body = JSON.stringify(payload);
  return doRequest<T>(url, 'POST', body, timeoutMs, {
    'Content-Type': 'application/json',
    ...headers,
  });
}

function doRequest<T>(url: string, method: string, body: string, timeoutMs: number, headers: Record<string, string>): Promise<HttpResult<T>> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (r: HttpResult<T>) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      finish({ ok: false, errorCode: 'INVALID_URL', errorMessage: `bad url: ${url}` });
      return;
    }
    const lib: any = u.protocol === 'https:' ? https : http;
    const buf = Buffer.from(body, 'utf8');
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          ...headers,
          'Content-Length': buf.length,
        },
        timeout: timeoutMs,
      },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = text;
          if (text && (text.startsWith('{') || text.startsWith('['))) {
            try { parsed = JSON.parse(text); } catch { /* leave as text */ }
          }
          finish({ ok: true, status: res.statusCode, body: parsed });
        });
        res.on('error', (err: Error) => {
          finish({ ok: false, errorCode: 'NETWORK_ERROR', errorMessage: err.message });
        });
      },
    );
    req.on('error', (err: Error) => {
      finish({ ok: false, errorCode: 'NETWORK_ERROR', errorMessage: err.message });
    });
    req.on('timeout', () => {
      try { req.destroy(new Error('request timeout')); } catch { /* ignore */ }
      finish({ ok: false, errorCode: 'UPSTREAM_TIMEOUT', errorMessage: 'request timeout' });
    });
    req.write(buf);
    req.end();
  });
}
