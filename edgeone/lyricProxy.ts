// 当前文件：EdgeOne 版歌词/封面代理。语义照抄 worker/lyric-proxy.ts，只有两处按这个运行时改：
//
// 1) 请求体不 clone、一次读成 Uint8Array 再发。EdgeOne 云函数的 Request 上
//    `request.clone().arrayBuffer()` 对带 body 的请求会抛
//    `TypeError: Cannot read properties of undefined (reading 'aborted')`，
//    而 QQ 歌词搜索（POST 到 u.y.qq.com/cgi-bin/musicu.fcg）完全依赖带 body 的代理。
// 2) 白名单补 y.gtimg.cn 与 kgimg.com：封面图走这里（src/services/coverCache.ts 只把这几类域名交给代理），
//    它们不在 *.qq.com / *.kugou.com 之内，漏掉就是 403。

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
    'Access-Control-Allow-Headers': [
        'X-CSRF-Token',
        'X-Requested-With',
        'Accept',
        'Accept-Version',
        'Content-Length',
        'Content-MD5',
        'Content-Type',
        'Date',
        'X-Api-Version',
        'KG-Rec',
        'KG-RC',
        'KG-CLIENTTIMEMS',
        'mid',
        'x-router',
    ].join(', '),
};

const IGNORED_FORWARD_HEADERS = ['host', 'connection', 'content-length', 'origin', 'referer'];

const isAllowedHost = (hostname: string): boolean => (
    hostname === 'qq.com' || hostname.endsWith('.qq.com')
    || hostname === 'y.gtimg.cn'
    || hostname === 'kugou.com' || hostname.endsWith('.kugou.com')
    || hostname === 'kgimg.com' || hostname.endsWith('.kgimg.com')
);

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
});

export async function handleLyricProxy(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const targetUrlStr = new URL(request.url).searchParams.get('url');
    if (!targetUrlStr) return json({ error: 'Missing url parameter' }, 400);

    try {
        const targetUrl = new URL(targetUrlStr);
        if (!isAllowedHost(targetUrl.hostname)) {
            return json({ error: 'Forbidden: Domain not allowed' }, 403);
        }

        const headers = new Headers();
        request.headers.forEach((value, key) => {
            if (!IGNORED_FORWARD_HEADERS.includes(key.toLowerCase())) headers.set(key, value);
        });

        const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);
        const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : undefined;

        const response = await fetch(targetUrl.toString(), { method: request.method, headers, body });
        const responseHeaders = new Headers(response.headers);
        Object.entries(CORS_HEADERS).forEach(([key, value]) => responseHeaders.set(key, value));

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error('[edgeone] lyric proxy failed:', error);
        return json({ error: 'Proxy request failed', details: String(error) }, 500);
    }
}
