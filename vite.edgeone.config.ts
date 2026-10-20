import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const stub = (name: string): string => fileURLToPath(new URL(`./edgeone/stubs/${name}`, import.meta.url));

// 当前文件：把 edgeone/index.ts 连同它的全部依赖打成一个自包含 ESM 文件，供 EdgeOne 云函数使用。
// 产物先落成 bundle.js，再由 edgeone/prepare.mjs 改名成 catch-all 路由需要的 [[default]].js。
export default defineConfig({
    resolve: {
        alias: [
            // NCM 在模块顶层 require 它，但 Folia 从不使用 unblock；本机也没装这个包。
            { find: '@neteasecloudmusicapienhanced/unblockmusic-utils', replacement: stub('unblockmusic.ts') },
            // 只被 NCM 的 checkToken 路径使用，云函数的请求都不带 checkToken。
            { find: /^jsdom$/, replacement: stub('jsdom.ts') },
        ],
    },
    // noExternal 让 @google/genai 与 qq-music-api 一起进包：云函数只需一个文件，不依赖平台是否装依赖。
    ssr: { noExternal: true },
    // 云函数不需要 public/ 里的静态资源；不关掉的话它们会被倒进 cloud-functions/api。
    publicDir: false,
    build: {
        ssr: 'edgeone/index.ts',
        outDir: 'cloud-functions/api',
        emptyOutDir: true,
        minify: false,
        target: 'node20',
        rollupOptions: {
            output: {
                format: 'es',
                entryFileNames: 'bundle.js',
                // 压成单文件：云函数只上传 [[default]].js，产物里若留下 ./assets/*.js 分片就会在运行时找不到。
                codeSplitting: false,
            },
        },
    },
});
