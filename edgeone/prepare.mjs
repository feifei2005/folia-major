// 当前文件：把打包好的云函数摆成 EdgeOne 需要的目录形状，并为 direct upload 准备好单个可上传目录。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(root, 'cloud-functions');
const apiDir = path.join(functionsDir, 'api');
const bundlePath = path.join(apiDir, 'bundle.js');
// EdgeOne 的文件式路由里 [[default]] 是 catch-all：/api/qq/login/status 这类多级路径都会进这一个函数。
const catchAllPath = path.join(apiDir, '[[default]].js');

if (!fs.existsSync(bundlePath)) {
    console.error('[edgeone] 缺少云函数产物 cloud-functions/api/bundle.js，请先执行 vite build --config vite.edgeone.config.ts');
    process.exit(1);
}

fs.renameSync(bundlePath, catchAllPath);
console.log(`[edgeone] 云函数入口 → ${path.relative(root, catchAllPath)}`);

// 用 CLI 上传时平台只认被上传目录的根，所以 edgeone.json 与 cloud-functions 必须跟着进 dist。
// dist/package.json 只用来给 builder 一个「这是 Makers 项目、函数按 ESM 载入」的信号：
// 云函数已经是自包含 bundle，所以这里刻意不带 dependencies / engines / scripts —— 根 package.json 是
// Electron 桌面版的清单（原生 tarball 依赖、engines.node>=24），交给 Web 构建器去装必然失败。
const distDir = path.join(root, 'dist');
fs.copyFileSync(path.join(root, 'edgeone.json'), path.join(distDir, 'edgeone.json'));
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({
    name: 'folia-major-web',
    private: true,
    type: 'module',
}, null, 4) + '\n');
fs.cpSync(functionsDir, path.join(distDir, 'cloud-functions'), { recursive: true });
console.log('[edgeone] 已把 edgeone.json、最小 package.json 与 cloud-functions 复制到 dist/');
