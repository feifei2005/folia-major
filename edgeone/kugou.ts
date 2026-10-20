// 当前文件：KuGouMusicApi 在 EdgeOne 云函数上的适配层。
//
// 复刻上游 server.js 的请求语义（query 里的 cookie 转成对象、模块返回的 status/body/cookie 原样落成响应），
// 但不走它的启动路径：server.js 与 main.js 都用 fs 扫描 module/ 目录来发现路由，打包成单文件后那个目录不存在。
// 所以路由表在这里静态写死，只收 Folia 客户端实际会调的操作（kugouTransport.ts 的 KUGOU_OPERATIONS）。
//
// 上游没有 /logout（客户端对它的失败是 .catch(() => undefined) 吞掉的），这里照抄它的 404 语义，不自造接口。

import album_detail from 'kugoumusicapi/module/album_detail.js';
import album_songs from 'kugoumusicapi/module/album_songs.js';
import artist_albums from 'kugoumusicapi/module/artist_albums.js';
import artist_audios from 'kugoumusicapi/module/artist_audios.js';
import artist_detail from 'kugoumusicapi/module/artist_detail.js';
import audio from 'kugoumusicapi/module/audio.js';
import everyday_history from 'kugoumusicapi/module/everyday_history.js';
import everyday_recommend from 'kugoumusicapi/module/everyday_recommend.js';
import krm_audio from 'kugoumusicapi/module/krm_audio.js';
import login_qr_check from 'kugoumusicapi/module/login_qr_check.js';
import login_qr_create from 'kugoumusicapi/module/login_qr_create.js';
import login_qr_key from 'kugoumusicapi/module/login_qr_key.js';
import lyric from 'kugoumusicapi/module/lyric.js';
import personal_fm from 'kugoumusicapi/module/personal_fm.js';
import playlist_add from 'kugoumusicapi/module/playlist_add.js';
import playlist_del from 'kugoumusicapi/module/playlist_del.js';
import playlist_detail from 'kugoumusicapi/module/playlist_detail.js';
import playlist_track_all from 'kugoumusicapi/module/playlist_track_all.js';
import playlist_tracks_add from 'kugoumusicapi/module/playlist_tracks_add.js';
import playlist_tracks_del from 'kugoumusicapi/module/playlist_tracks_del.js';
import register_dev from 'kugoumusicapi/module/register_dev.js';
import search from 'kugoumusicapi/module/search.js';
import search_lyric from 'kugoumusicapi/module/search_lyric.js';
import song_climax from 'kugoumusicapi/module/song_climax.js';
import song_url from 'kugoumusicapi/module/song_url.js';
import top_card_youth from 'kugoumusicapi/module/top_card_youth.js';
import user_cloud from 'kugoumusicapi/module/user_cloud.js';
import user_cloud_url from 'kugoumusicapi/module/user_cloud_url.js';
import user_detail from 'kugoumusicapi/module/user_detail.js';
import user_playlist from 'kugoumusicapi/module/user_playlist.js';
import user_vip_detail from 'kugoumusicapi/module/user_vip_detail.js';
import youth_day_vip from 'kugoumusicapi/module/youth_day_vip.js';
import youth_day_vip_upgrade from 'kugoumusicapi/module/youth_day_vip_upgrade.js';
import youth_union_vip from 'kugoumusicapi/module/youth_union_vip.js';
import { cookieToJson } from 'kugoumusicapi/util/index.js';
import { createRequest } from 'kugoumusicapi/util/request.js';

export const KUGOU_API_PREFIX = '/api/kugou';

type KugouAnswer = {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
    cookie?: string[];
};

type KugouModule = (
    params: Record<string, unknown>,
    useAxios: (config: Record<string, unknown>) => Promise<KugouAnswer>,
) => Promise<KugouAnswer>;

const MODULES: Record<string, KugouModule> = {
    album_detail,
    album_songs,
    artist_albums,
    artist_audios,
    artist_detail,
    audio,
    everyday_history,
    everyday_recommend,
    krm_audio,
    login_qr_check,
    login_qr_create,
    login_qr_key,
    lyric,
    personal_fm,
    playlist_add,
    playlist_del,
    playlist_detail,
    playlist_track_all,
    playlist_tracks_add,
    playlist_tracks_del,
    register_dev,
    search,
    search_lyric,
    song_climax,
    song_url,
    top_card_youth,
    user_cloud,
    user_cloud_url,
    user_detail,
    user_playlist,
    user_vip_detail,
    youth_day_vip,
    youth_day_vip_upgrade,
    youth_union_vip,
};

const respond = (body: unknown, status: number, extra?: Record<string, string>): Response => new Response(
    typeof body === 'string' ? body : JSON.stringify(body ?? null),
    { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } },
);

// 上游对未知路由的答复，照抄形状：{ code: 404, data: null, msg: 'Not Found' }。
const notFound = (): Response => respond({ code: 404, data: null, msg: 'Not Found' }, 404);

/**
 * `/api/kugou/login/qr/key` → `login_qr_key`。
 * 反向于客户端 ENDPOINTS 表的推导规则：文件名里的下划线就是路径里的斜杠。
 */
const operationOf = (pathname: string): string => (
    pathname.slice(KUGOU_API_PREFIX.length).replace(/^\/+|\/+$/g, '').replace(/\//g, '_')
);

export async function handleKugou(request: Request, clientIp?: string): Promise<Response> {
    const url = new URL(request.url);
    const moduleFn = MODULES[operationOf(url.pathname)];
    if (!moduleFn) return notFound();

    // server.js 的做法：cookie 字符串先转成对象，其余 query 参数原样进 params。
    // 客户端把登录态放在 ?cookie= 里（不是 Cookie 头），这里必须走同一套解析。
    const rawCookie = url.searchParams.get('cookie') ?? '';
    const params: Record<string, unknown> = {
        cookie: rawCookie ? cookieToJson(rawCookie) : {},
    };
    url.searchParams.forEach((value, key) => {
        if (key !== 'cookie') params[key] = value;
    });

    try {
        const answer = await moduleFn(params, (config) => createRequest({ ...config, ip: clientIp }));
        const headers: Record<string, string> = { ...(answer.headers || {}) };
        // 登录态靠 Set-Cookie 落到浏览器；页面与接口同源，所以用默认的 Lax 就够，
        // 不像上游那样需要 SameSite=None 去应付跨站场景。
        if (Array.isArray(answer.cookie) && answer.cookie.length > 0) {
            headers['set-cookie'] = answer.cookie.map(cookie => `${cookie}; Path=/; SameSite=Lax; Secure`).join(', ');
        }
        return respond(answer.body, answer.status ?? 200, headers);
    } catch (error) {
        // 上游把失败也封成 { status, body, headers } 抛出来；没有 body 的一律按 404 处理。
        const failure = error as KugouAnswer | undefined;
        if (!failure?.body) return notFound();
        return respond(failure.body, failure.status ?? 502, failure.headers || {});
    }
}
