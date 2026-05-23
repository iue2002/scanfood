import type { SoundCatalog, SoundEntry } from './notif-pref.types';

/**
 * 内置音色清单（R9.4）
 *
 * 实际生产建议把 mp3 上传到 TOS 后把 URL 替换进来；当前默认走 admin-web 静态目录的相对路径，
 * 部署时只需要把同名文件放在 admin-web/public/sounds/ 即可工作（开发期免依赖外部存储）。
 *
 * 也可以通过环境变量 NOTIF_SOUND_BASE_URL 指向 TOS 域名（含尾部 /），生效后即用 TOS URL。
 */

const BASE = (process.env.NOTIF_SOUND_BASE_URL || '/sounds/').replace(/\/?$/, '/');

export const BUILTIN_SOUND_ENTRIES: SoundEntry[] = [
  { id: 'default', label: '默认提示音', url: `${BASE}default.mp3`, durationMs: 1500 },
  { id: 'ding', label: '清脆铃声', url: `${BASE}ding.mp3`, durationMs: 800 },
  { id: 'bell', label: '柜台铃声', url: `${BASE}bell.mp3`, durationMs: 1200 },
  { id: 'chime', label: '风铃', url: `${BASE}chime.mp3`, durationMs: 2000 },
  { id: 'alert', label: '紧急警报', url: `${BASE}alert.mp3`, durationMs: 1500 },
];

export const BUILTIN_SOUND_CATALOG: SoundCatalog = {
  ids: BUILTIN_SOUND_ENTRIES.map((e) => e.id),
  entries: BUILTIN_SOUND_ENTRIES,
};
