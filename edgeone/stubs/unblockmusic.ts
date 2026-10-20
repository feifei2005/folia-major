// NCM 的 module/song_url_v1.js 在模块顶层就 require 这个包，本机也没有安装。
// Folia 从不传 unblock=true，云函数只需要让导入成立；真被调用时明确失败，不要伪造一个“解锁成功”的地址。
export async function matchID(): Promise<never> {
    throw new Error('unblockmusic is not available on EdgeOne');
}

export default { matchID };
