// 当前文件：站点访问门。未持有效签名 cookie 的请求看不到首页，也调不到 /api/* 与 /theme。
// 放在 middleware 而不是云函数里，是因为静态资源优先级高于云函数路由：首页根本不会经过 cloud-functions。

const COOKIE_NAME = 'folia_access';
const LOGIN_PATH = '/login';

// 签名消息前缀：把用途写进 HMAC 输入，避免同一密钥在别的场景下签出可互换的令牌。
const TOKEN_SCOPE = 'folia-access:';
const DEFAULT_TTL_DAYS = 30;

const encoder = new TextEncoder();

const hex = (buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

const sign = async (secret, expiry) => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${TOKEN_SCOPE}${expiry}`)));
};

// 两边都走一次哈希：长度固定，比较不会因位数不同提前返回而泄漏信息。
const constantTimeEqual = async (a, b) => {
    const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
    const ba = new Uint8Array(da);
    const bb = new Uint8Array(db);
    let diff = 0;
    for (let i = 0; i < ba.length; i += 1) diff |= ba[i] ^ bb[i];
    return diff === 0;
};

const cookieValue = (request) => {
    const header = request.headers.get('cookie') || '';
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        if (part.slice(0, index).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(index + 1).trim());
    }
    return '';
};

const parseToken = (token) => {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const expiry = Number(token.slice(0, dot));
    if (!Number.isFinite(expiry)) return null;
    return { expiry, signature: token.slice(dot + 1) };
};

const isAuthenticated = async (request, secret) => {
    const parsed = parseToken(cookieValue(request));
    if (!parsed) return false;
    if (parsed.expiry < Date.now()) return false;
    return (await sign(secret, parsed.expiry)) === parsed.signature;
};

const isProtectedPath = (pathname) => pathname.startsWith('/api/') || pathname === '/theme' || pathname.startsWith('/theme/');

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

const notConfigured = (pathname) => isProtectedPath(pathname)
    ? json({ error: '访问门未配置：控制台需要 SITE_PASSWORD 与 AUTH_SECRET' }, 503)
    : new Response('访问门未配置：请在 EdgeOne Makers 控制台设置 SITE_PASSWORD 与 AUTH_SECRET。', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

// 只放行站内路径：否则 `?next=https://evil/` 会把刚登录成功的人（连同 cookie）送到外部站点。
const safeReturnTo = (raw) => {
    if (typeof raw !== 'string' || raw.length === 0) return '/';
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
    return raw;
};

const loginPage = (error) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Folia</title>
<style>
html,body{height:100%}
body{margin:0;background:#09090b;color:#fafafa;font:16px/1.5 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center}
form{width:min(340px,86vw);display:flex;flex-direction:column;gap:14px}
h1{font-size:15px;font-weight:500;letter-spacing:.14em;margin:0 0 6px;opacity:.62;text-transform:uppercase}
input{background:#18181b;border:1px solid #3f3f46;border-radius:10px;color:#fff;padding:13px 14px;font:inherit;outline:none}
input:focus{border-color:#71717a}
button{background:#fafafa;color:#09090b;border:0;border-radius:10px;padding:13px;font:inherit;font-weight:600;cursor:pointer}
p{margin:0;font-size:14px;color:#f87171;min-height:20px}
</style></head>
<body><form method="POST" action="${LOGIN_PATH}">
<h1>Folia</h1>
<p>${error || '&nbsp;'}</p>
<input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus>
<button type="submit">进入</button>
</form></body></html>`;

const issueCookie = async (secret, ttlDays) => {
    const expiry = Date.now() + ttlDays * 86_400_000;
    return `${COOKIE_NAME}=${expiry}.${await sign(secret, expiry)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round((expiry - Date.now()) / 1000)}`;
};

export async function middleware(context) {
    const { request } = context;
    const env = context.env || {};
    const password = env.SITE_PASSWORD;
    const secret = env.AUTH_SECRET;
    const url = new URL(request.url);

    if (!password || !secret) return notConfigured(url.pathname);

    if (url.pathname === LOGIN_PATH) {
        if (request.method !== 'POST') return new Response(loginPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });

        // 同站检查：跨站表单也能提交，这里挡掉不带浏览器同站信号的构造请求。
        const site = request.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'Forbidden' }, 403);

        const form = await request.formData().catch(() => null);
        const given = form ? String(form.get('password') || '') : '';
        const ttlDays = Number(env.AUTH_TTL_DAYS) > 0 ? Number(env.AUTH_TTL_DAYS) : DEFAULT_TTL_DAYS;

        if (!given || !(await constantTimeEqual(given, password))) {
            return new Response(loginPage('密码不对'), {
                status: 401,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        }

        return new Response(null, {
            status: 302,
            headers: {
                location: safeReturnTo(url.searchParams.get('next')),
                'set-cookie': await issueCookie(secret, ttlDays),
                'cache-control': 'no-store',
            },
        });
    }

    if (await isAuthenticated(request, secret)) return context.next();

    if (isProtectedPath(url.pathname)) {
        return json({ error: 'Unauthorized' }, 401, { 'www-authenticate': 'cookie' });
    }

    return context.redirect(`${LOGIN_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
}
