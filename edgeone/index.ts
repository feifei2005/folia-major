// 当前文件：EdgeOne Makers 云函数入口，把 /api/* 各条路由分发给对应的 handler。
// 必须排在任何 NCM 模块之前：它负责在 util/request.js 求值前创建 /tmp/anonymous_token。
import './neteaseBootstrap.ts';
import { QQ_API_PREFIX, handleQq, type QqServerlessEnv } from '../worker/qq.ts';
import { handleGenerateTheme } from '../worker/generate-theme.ts';
import { handleGenerateOpenAITheme } from '../worker/generate-theme_openai.ts';
import { handleLyricProxy } from './lyricProxy.ts';
import { handleSegmentLyrics, type SegmentLyricsEnv } from '../worker/segment-lyrics.ts';
import { KUGOU_API_PREFIX, handleKugou } from './kugou.ts';
import { NETEASE_API_PREFIX, handleNetease } from './netease.ts';

// QQ_QR_CHANNEL 故意不在这里：它靠 Cloudflare Durable Object 持有 MQTT 长连接，EdgeOne 没有对等原语，
// 所以 EdgeOne 的能力等同 Vercel —— 微信扫码 + 手机 QQ 扫码（QQ 互联网页登录），没有 QQ 音乐 App 扫码。
type Env = QqServerlessEnv & SegmentLyricsEnv;

type EdgeOneContext = {
    request: Request;
    env?: Record<string, string | undefined>;
    clientIp?: string;
};

// Edge Functions 只给 context.env，Cloud Functions（Node 运行时）走 process.env；合并两边，一个入口两个运行时都能跑。
const readEnv = (context: EdgeOneContext): Env => ({ ...process.env, ...context.env }) as Env;

const jsonError = (status: number, message: string): Response => new Response(
    JSON.stringify({ code: status, message }),
    { status, headers: { 'content-type': 'application/json; charset=utf-8' } },
);

// 带 body 的请求先把正文读成 Uint8Array 再往下转交：EdgeOne 的 Request 在把 stream body 转发/clone 时
// 会抛 `TypeError: Cannot read properties of undefined (reading 'aborted')`。
// QQ 的写入路由（收藏、加歌单、登录续期）都是 POST + JSON，必须走这一步。
const withMaterializedBody = async (request: Request): Promise<Request> => {
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return request;
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: new Uint8Array(await request.arrayBuffer()),
    });
};

// 具名导出 onRequest：Cloud Functions 靠它注册 all-method handler。
// default 导出是留给 Express/Koa 实例的（builder 见到 `export default app` 才按框架应用识别），这里不能占。
export async function onRequest(context: EdgeOneContext): Promise<Response> {
    const { request } = context;
    const env = readEnv(context);
    const url = new URL(request.url);

    if (url.pathname === '/api/generate-theme') {
        return handleGenerateTheme(request, env);
    }

    if (url.pathname === '/api/generate-theme_openai') {
        return handleGenerateOpenAITheme(request, env);
    }

    if (url.pathname === '/api/lyric-proxy') {
        return handleLyricProxy(request);
    }

    if (url.pathname === '/api/segment-lyrics') {
        return handleSegmentLyrics(request, env);
    }

    // 与 worker/index.ts 同构：QQ 路由自己兜异常，免得它把同一次请求里的静态资源一起带下去。
    if (url.pathname === QQ_API_PREFIX || url.pathname.startsWith(`${QQ_API_PREFIX}/`)) {
        try {
            return await handleQq(await withMaterializedBody(request), env);
        } catch (error) {
            console.error('[edgeone] qq serverless route failed:', error);
            return jsonError(502, 'QQ serverless route failed');
        }
    }

    if (url.pathname === KUGOU_API_PREFIX || url.pathname.startsWith(`${KUGOU_API_PREFIX}/`)) {
        try {
            return await handleKugou(request, context.clientIp);
        } catch (error) {
            console.error('[edgeone] kugou route failed:', error);
            return jsonError(502, 'KuGou route failed');
        }
    }

    if (url.pathname === NETEASE_API_PREFIX || url.pathname.startsWith(`${NETEASE_API_PREFIX}/`)) {
        try {
            return await handleNetease(request, context.clientIp);
        } catch (error) {
            console.error('[edgeone] netease route failed:', error);
            return jsonError(502, 'NetEase route failed');
        }
    }

    return jsonError(404, 'Not Found');
}
