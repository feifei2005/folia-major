// 当前文件：必须比任何 @neteasecloudmusicapienhanced/api 模块先求值。
// 它们的 util/request.js 在模块顶层同步读取 <tmpdir>/anonymous_token，文件不存在就抛 ENOENT；
// ESM 的静态导入又会先于入口里的语句执行，所以只能把这件事做成“入口第一个导入的副作用模块”。
// 内容留空即可：Folia 客户端在没有账号 cookie 时会先调 /register/anonimous，把返回的 MUSIC_A 随后的请求带上。
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tokenPath = join(tmpdir(), 'anonymous_token');
try {
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, '', 'utf-8');
} catch (error) {
    console.error('[edgeone] could not prepare the NetEase anonymous token file:', error);
}
