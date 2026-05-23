/**
 * NotifPrefCore：通知偏好领域核心（纯类，无 I/O 依赖）
 *
 * 不变量（来自 design.md / requirements.md）：
 * - I12: desktop_events ⊆ {NEW_ORDER, ADD_ITEM, REFUND}（去重接受）
 * - I12: sound_id 必须在 catalog.ids 中
 *
 * 属性测试目标：
 * - Property 11：通知偏好校验（合法 iff sound_id ∈ catalog.ids ∧ desktop_events ⊆ allowedEvents，且重复元素不影响接受性）
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { NotifPrefRepoPort } from './notif-pref-repo.port';
import type {
  DesktopEvent,
  NotifPrefDto,
  NotifPrefRow,
  SoundCatalog,
  SoundEntry,
} from './notif-pref.types';
import { ALL_DESKTOP_EVENTS, DEFAULT_PREF } from './notif-pref.types';

@Injectable()
export class NotifPrefCore {
  private readonly logger = new Logger(NotifPrefCore.name);

  constructor(
    private readonly repo: NotifPrefRepoPort,
    private readonly soundCatalog: SoundCatalog,
  ) {}

  // ============================================================
  // 静态规则（PBT 直接调用）
  // ============================================================

  /**
   * 校验通知偏好 DTO
   * I12 不变量：sound_id ∈ catalog.ids 且 desktop_events ⊆ {NEW_ORDER, ADD_ITEM, REFUND}
   *
   * @returns { ok: true; normalized: NotifPrefDto } | { ok: false; code: string; reason: string }
   */
  static validate(
    dto: NotifPrefDto,
    catalog: SoundCatalog,
  ):
    | { ok: true; normalized: NotifPrefDto }
    | { ok: false; code: 'NOTIF_PREF_INVALID'; reason: string }
  {
    if (typeof dto !== 'object' || dto === null) {
      return { ok: false, code: 'NOTIF_PREF_INVALID', reason: 'payload 必须是对象' };
    }

    if (typeof dto.sound_enabled !== 'boolean') {
      return { ok: false, code: 'NOTIF_PREF_INVALID', reason: 'sound_enabled 必须是 boolean' };
    }

    if (typeof dto.sound_id !== 'string' || !catalog.ids.includes(dto.sound_id)) {
      return { ok: false, code: 'NOTIF_PREF_INVALID', reason: `sound_id 不在内置音色清单内` };
    }

    if (!Array.isArray(dto.desktop_events)) {
      return { ok: false, code: 'NOTIF_PREF_INVALID', reason: 'desktop_events 必须是数组' };
    }

    // 子集校验 + 类型校验
    const allowed = new Set<string>(ALL_DESKTOP_EVENTS);
    for (const e of dto.desktop_events) {
      if (typeof e !== 'string' || !allowed.has(e)) {
        return {
          ok: false,
          code: 'NOTIF_PREF_INVALID',
          reason: `desktop_events 包含非法事件 ${JSON.stringify(e)}`,
        };
      }
    }

    // 重复元素不影响接受性 → 去重 + 按固定顺序排序，便于幂等
    const dedupSet = new Set<DesktopEvent>(dto.desktop_events as DesktopEvent[]);
    const ordered = ALL_DESKTOP_EVENTS.filter((e) => dedupSet.has(e));

    return {
      ok: true,
      normalized: {
        sound_enabled: dto.sound_enabled,
        sound_id: dto.sound_id,
        desktop_events: ordered,
      },
    };
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * R9.2：返回当前用户偏好；不存在记录时返回默认值（不写库）
   */
  async getOrDefault(userId: number): Promise<NotifPrefRow> {
    const row = await this.repo.getByUserId(userId);
    if (row) return row;
    return {
      user_id: userId,
      sound_enabled: DEFAULT_PREF.sound_enabled,
      sound_id: DEFAULT_PREF.sound_id,
      desktop_events: [...DEFAULT_PREF.desktop_events],
      updated_at: new Date(),
    };
  }

  /**
   * R9.3：upsert 偏好，写入前必校验
   */
  async upsert(userId: number, dto: NotifPrefDto): Promise<NotifPrefRow> {
    const v = NotifPrefCore.validate(dto, this.soundCatalog);
    if (!v.ok) {
      throw new BadRequestException({ code: v.code, msg: v.reason });
    }
    return await this.repo.upsert(userId, v.normalized);
  }

  /**
   * R9.4：返回内置音色清单
   */
  async listSounds(): Promise<SoundEntry[]> {
    return [...this.soundCatalog.entries];
  }
}
