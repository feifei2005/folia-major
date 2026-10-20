// 当前文件：NeteaseCloudMusicApiEnhanced（NCM）在 EdgeOne 云函数上的适配层。
//
// 与上游 server.js 只有“如何发现路由”不同：server.js 用 fs.readdir 扫描 module/ 目录，打包后没有这个目录，
// 所以这里静态列出 Folia 客户端实际会调的路由（src/services/onlineMusic/netease/netease.ts 的 fetchWithCreds）。
// 其余语义照抄 server.js：query/body 合并、字符串 cookie 转对象、注入 request 的 ip、
// 模块返回的 status/body/cookie 原样落成响应，模块抛出的 {status, body, cookie} 也原样透传。
//
// 启动顺序见 neteaseBootstrap.ts：/tmp/anonymous_token 必须在 util/request.js 求值前存在。
// xeapi 公钥只在 /register/anonimous 与 /song/url/v1 需要，首个这类请求时从网易拉一次写进 /tmp。

import album from '@neteasecloudmusicapienhanced/api/module/album.js';
import album_detail_dynamic from '@neteasecloudmusicapienhanced/api/module/album_detail_dynamic.js';
import album_new from '@neteasecloudmusicapienhanced/api/module/album_new.js';
import album_sub from '@neteasecloudmusicapienhanced/api/module/album_sub.js';
import album_sublist from '@neteasecloudmusicapienhanced/api/module/album_sublist.js';
import artist_album from '@neteasecloudmusicapienhanced/api/module/artist_album.js';
import artist_detail from '@neteasecloudmusicapienhanced/api/module/artist_detail.js';
import artist_songs from '@neteasecloudmusicapienhanced/api/module/artist_songs.js';
import artist_top_song from '@neteasecloudmusicapienhanced/api/module/artist_top_song.js';
import cloud_lyric_get from '@neteasecloudmusicapienhanced/api/module/cloud_lyric_get.js';
import cloudsearch from '@neteasecloudmusicapienhanced/api/module/cloudsearch.js';
import fm_trash from '@neteasecloudmusicapienhanced/api/module/fm_trash.js';
import history_recommend_songs from '@neteasecloudmusicapienhanced/api/module/history_recommend_songs.js';
import history_recommend_songs_detail from '@neteasecloudmusicapienhanced/api/module/history_recommend_songs_detail.js';
import homepage_block_page from '@neteasecloudmusicapienhanced/api/module/homepage_block_page.js';
import like from '@neteasecloudmusicapienhanced/api/module/like.js';
import likelist from '@neteasecloudmusicapienhanced/api/module/likelist.js';
import login_qr_check from '@neteasecloudmusicapienhanced/api/module/login_qr_check.js';
import login_qr_create from '@neteasecloudmusicapienhanced/api/module/login_qr_create.js';
import login_qr_key from '@neteasecloudmusicapienhanced/api/module/login_qr_key.js';
import login_status from '@neteasecloudmusicapienhanced/api/module/login_status.js';
import logout from '@neteasecloudmusicapienhanced/api/module/logout.js';
import lyric_new from '@neteasecloudmusicapienhanced/api/module/lyric_new.js';
import personal_fm from '@neteasecloudmusicapienhanced/api/module/personal_fm.js';
import personal_fm_mode from '@neteasecloudmusicapienhanced/api/module/personal_fm_mode.js';
import personalized from '@neteasecloudmusicapienhanced/api/module/personalized.js';
import playlist_detail from '@neteasecloudmusicapienhanced/api/module/playlist_detail.js';
import playlist_detail_dynamic from '@neteasecloudmusicapienhanced/api/module/playlist_detail_dynamic.js';
import playlist_subscribe from '@neteasecloudmusicapienhanced/api/module/playlist_subscribe.js';
import playlist_track_all from '@neteasecloudmusicapienhanced/api/module/playlist_track_all.js';
import playlist_tracks from '@neteasecloudmusicapienhanced/api/module/playlist_tracks.js';
import recommend_resource from '@neteasecloudmusicapienhanced/api/module/recommend_resource.js';
import recommend_songs from '@neteasecloudmusicapienhanced/api/module/recommend_songs.js';
import recommend_songs_dislike from '@neteasecloudmusicapienhanced/api/module/recommend_songs_dislike.js';
import register_anonimous from '@neteasecloudmusicapienhanced/api/module/register_anonimous.js';
import scrobble_v1 from '@neteasecloudmusicapienhanced/api/module/scrobble_v1.js';
import simi_song from '@neteasecloudmusicapienhanced/api/module/simi_song.js';
import song_chorus from '@neteasecloudmusicapienhanced/api/module/song_chorus.js';
import song_copyright_rcmd from '@neteasecloudmusicapienhanced/api/module/song_copyright_rcmd.js';
import song_detail from '@neteasecloudmusicapienhanced/api/module/song_detail.js';
import song_url_v1 from '@neteasecloudmusicapienhanced/api/module/song_url_v1.js';
import top_playlist from '@neteasecloudmusicapienhanced/api/module/top_playlist.js';
import top_song from '@neteasecloudmusicapienhanced/api/module/top_song.js';
import toplist from '@neteasecloudmusicapienhanced/api/module/toplist.js';
import user_account from '@neteasecloudmusicapienhanced/api/module/user_account.js';
import user_cloud from '@neteasecloudmusicapienhanced/api/module/user_cloud.js';
import user_cloud_detail from '@neteasecloudmusicapienhanced/api/module/user_cloud_detail.js';
import user_playlist from '@neteasecloudmusicapienhanced/api/module/user_playlist.js';
import { cookieToJson, generateDeviceId, generateRandomChineseIP } from '@neteasecloudmusicapienhanced/api/util/index.js';
import ncmRequest from '@neteasecloudmusicapienhanced/api/util/request.js';
import { getXeapiPublicKey } from '@neteasecloudmusicapienhanced/api/util/xeapiKey.js';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NETEASE_API_PREFIX = '/api/netease';

type NcmAnswer = {
    status?: number;
    body?: any;
    cookie?: string[] | string;
    redirectUrl?: string;
};

type NcmQuery = Record<string, any>;

type NcmModule = (query: NcmQuery, request: (...args: any[]) => Promise<NcmAnswer>) => Promise<NcmAnswer>;

const MODULES: Record<string, NcmModule> = {
    '/album': album,
    '/album/detail/dynamic': album_detail_dynamic,
    '/album/new': album_new,
    '/album/sub': album_sub,
    '/album/sublist': album_sublist,
    '/artist/album': artist_album,
    '/artist/detail': artist_detail,
    '/artist/songs': artist_songs,
    '/artist/top/song': artist_top_song,
    '/cloud/lyric/get': cloud_lyric_get,
    '/cloudsearch': cloudsearch,
    '/fm_trash': fm_trash,
    '/history/recommend/songs': history_recommend_songs,
    '/history/recommend/songs/detail': history_recommend_songs_detail,
    '/homepage/block/page': homepage_block_page,
    '/like': like,
    '/likelist': likelist,
    '/login/qr/check': login_qr_check,
    '/login/qr/create': login_qr_create,
    '/login/qr/key': login_qr_key,
    '/login/status': login_status,
    '/logout': logout,
    '/lyric/new': lyric_new,
    '/personal_fm': personal_fm,
    '/personal/fm/mode': personal_fm_mode,
    '/personalized': personalized,
    '/playlist/detail': playlist_detail,
    '/playlist/detail/dynamic': playlist_detail_dynamic,
    '/playlist/subscribe': playlist_subscribe,
    '/playlist/track/all': playlist_track_all,
    '/playlist/tracks': playlist_tracks,
    '/recommend/resource': recommend_resource,
    '/recommend/songs': recommend_songs,
    '/recommend/songs/dislike': recommend_songs_dislike,
    '/register/anonimous': register_anonimous,
    '/scrobble/v1': scrobble_v1,
    '/simi/song': simi_song,
    '/song/chorus': song_chorus,
    '/song/copyright/rcmd': song_copyright_rcmd,
    '/song/detail': song_detail,
    '/song/url/v1': song_url_v1,
    '/top/playlist': top_playlist,
    '/top/song': top_song,
    '/toplist': toplist,
    '/user/account': user_account,
    '/user/cloud': user_cloud,
    '/user/cloud/detail': user_cloud_detail,
    '/user/playlist': user_playlist,
};

// 复刻 server.js 的随机中国 IP：/song/url/v1 带 randomCNIP=true，request.js 直接取 global.cnIp。
const globalState = globalThis as typeof globalThis & { cnIp?: string; deviceId?: string };
if (!globalState.cnIp) globalState.cnIp = generateRandomChineseIP();

const xeapiKeyPath = join(tmpdir(), 'xeapi_public_key');
let xeapiKeyPromise: Promise<void> | null = null;

const ensureXeapiKey = (): Promise<void> => {
    if (existsSync(xeapiKeyPath)) return Promise.resolve();
    if (!xeapiKeyPromise) {
        // 上游 generateConfig 先用 register_anonimous 设好 deviceId 再取公钥；这里不能注册（注册本身就要公钥），
        // 但 /api/bsr/sk/get 对空 deviceId 只回一个没有 sk 的壳，所以先自己生成一个。
        if (!globalState.deviceId) globalState.deviceId = generateDeviceId();
        const pending = getXeapiPublicKey({}, globalState.deviceId)
            .then((key: unknown) => {
                writeFileSync(xeapiKeyPath, JSON.stringify(key), 'utf-8');
            })
            .catch((error: unknown) => {
                console.error('[edgeone] could not fetch the NetEase xeapi public key:', error);
            })
            .finally(() => {
                xeapiKeyPromise = null;
            });
        xeapiKeyPromise = pending;
        return pending;
    }
    return xeapiKeyPromise;
};

const safeDecode = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

// server.js 用的解码器对坏编码原样返回；decodeURIComponent 抛错时同样保留原值。
const parseCookieHeader = (header: string | null): Record<string, string> => {
    const cookies: Record<string, string> = {};
    (header || '').split(/;\s+|(?<!\s)\s+$/g).forEach(pair => {
        const separator = pair.indexOf('=');
        if (separator < 1 || separator === pair.length - 1) return;
        cookies[safeDecode(pair.slice(0, separator)).trim()] = safeDecode(pair.slice(separator + 1)).trim();
    });
    return cookies;
};

const queryFromUrl = (url: URL): NcmQuery => {
    const query: NcmQuery = {};
    url.searchParams.forEach((value, key) => {
        query[key] = value;
    });
    if (typeof query.cookie === 'string') query.cookie = cookieToJson(safeDecode(query.cookie));
    return query;
};

const materializeQuery = async (request: Request, query: NcmQuery): Promise<NcmQuery> => {
    if (request.method === 'GET' || request.method === 'HEAD') return query;
    const contentType = request.headers.get('content-type') || '';
    const text = await request.text();
    if (!text) return query;
    let body: NcmQuery = {};
    try {
        if (contentType.includes('application/json')) {
            body = JSON.parse(text);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            new URLSearchParams(text).forEach((value, key) => {
                body[key] = value;
            });
        }
    } catch {
        body = {};
    }
    if (typeof body.cookie === 'string') body.cookie = cookieToJson(safeDecode(body.cookie));
    return { ...query, ...body };
};

const appendAnswer = (answer: NcmAnswer, headers: Headers): Response => {
    if (answer.redirectUrl) {
        headers.set('location', answer.redirectUrl);
        return new Response(null, { status: answer.status || 302, headers });
    }
    const cookies = answer.cookie;
    if (Array.isArray(cookies)) {
        cookies.forEach(cookie => headers.append('set-cookie', `${cookie}; SameSite=None; Secure`));
    } else if (typeof cookies === 'string' && cookies) {
        headers.append('set-cookie', `${cookies}; SameSite=None; Secure`);
    }
    return new Response(JSON.stringify(answer.body ?? null), {
        status: answer.status || 200,
        headers,
    });
};

export const handleNetease = async (request: Request, clientIp?: string): Promise<Response> => {
    const url = new URL(request.url);
    const route = url.pathname.slice(NETEASE_API_PREFIX.length).replace(/\/+$/, '') || '/';
    const module = MODULES[route];
    if (!module) {
        return new Response(JSON.stringify({ code: 404, data: null, msg: 'Not Found' }), {
            status: 404,
            headers: { 'content-type': 'application/json; charset=utf-8' },
        });
    }

    if (route === '/register/anonimous' || route === '/song/url/v1') await ensureXeapiKey();

    const query = await materializeQuery(request, queryFromUrl(url));
    // server.js: Object.assign({}, {cookie: req.cookies}, req.query, req.body) —— 显式传进来的 cookie 覆盖请求头里的。
    const merged: NcmQuery = { cookie: parseCookieHeader(request.headers.get('cookie')), ...query };

    const runRequest = (uri: string, data: any, options: any = {}) => {
        const ip = options.randomCNIP ? globalState.cnIp : (clientIp || globalState.cnIp);
        return ncmRequest(uri, data, { ...options, ip });
    };

    try {
        const answer = await module(merged, runRequest);
        return appendAnswer(answer, new Headers({ 'content-type': 'application/json; charset=utf-8' }));
    } catch (error: any) {
        // 与 server.js 的 catch 相同：模块抛出的对象带 status/body/cookie，body 缺失才算 404。
        if (!error?.body) {
            return new Response(JSON.stringify({ code: 404, data: null, msg: 'Not Found' }), {
                status: 404,
                headers: { 'content-type': 'application/json; charset=utf-8' },
            });
        }
        if (error.body.code == '301') error.body.msg = '需要登录';
        const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
        if (typeof error.cookie === 'string' && error.cookie) headers.append('set-cookie', error.cookie);
        return new Response(JSON.stringify(error.body), {
            status: error.status || 200,
            headers,
        });
    }
};
