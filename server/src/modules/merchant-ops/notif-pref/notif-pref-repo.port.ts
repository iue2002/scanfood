import type { NotifPrefRow, NotifPrefDto } from './notif-pref.types';

/**
 * 通知偏好持久化端口
 */
export interface NotifPrefRepoPort {
  getByUserId(userId: number): Promise<NotifPrefRow | null>;
  upsert(userId: number, dto: NotifPrefDto): Promise<NotifPrefRow>;
}
