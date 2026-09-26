import { app } from 'electron';
import path from 'node:path';

/**
 * dsh 数据目录解析：主进程内所有需要定位 ~/.dsh 的模块共用，
 * 保证配置写入与引擎启动使用同一数据根，DSH_HOME 重定向时两者一致。
 */

/** dsh 数据根目录：优先 DSH_HOME 环境变量，否则用户主目录下的 .dsh。 */
export function resolveDshHome(): string {
  return process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh');
}

/** 青梧专属 dsh profile 目录（~/.dsh/profiles/qingwu）。 */
export function resolveQingwuProfileDir(): string {
  return path.join(resolveDshHome(), 'profiles', 'qingwu');
}
