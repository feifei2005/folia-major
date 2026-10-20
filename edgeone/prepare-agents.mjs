// 当前文件：把 agents/ 与它依赖的 shared/ 放进 dist，交给 Makers 部署时的构建步骤编译。
// 不在本地预构建 .edgeone/agent-node：直接上传目录里的预构建产物不会被平台识别。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

if (!fs.existsSync(distDir)) {
    console.error('[edgeone] 缺少 dist/，请先执行 vite build');
    process.exit(1);
}

for (const name of ['agents', 'shared']) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) {
        console.error(`[edgeone] 缺少 ${name}/`);
        process.exit(1);
    }
    const target = path.join(distDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
    console.log(`[edgeone] ${name}/ → dist/${name}/`);
}

fs.rmSync(path.join(distDir, '.edgeone'), { recursive: true, force: true });
