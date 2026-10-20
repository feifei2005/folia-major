// jsdom 只被 NCM 的 register_checktoken_v2/v3 使用，而 checkToken 需要浏览器环境和易盾 SDK；
// Folia 的请求都不带 checkToken。换成空壳，避免整个 jsdom（含可选原生依赖）被打进云函数。
export class JSDOM {}
export class VirtualConsole {}
export default { JSDOM, VirtualConsole };
