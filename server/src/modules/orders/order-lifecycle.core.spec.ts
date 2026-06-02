import { describe, it, expect } from 'vitest';
import { OrderLifecycleCore, ORDER_STATUS } from './order-lifecycle.core';

/**
 * P0-3：订单状态流转合法性（canTransition）单测
 *
 * 固化「不允许把已结账/已取消订单改回任意状态」「非法跳转被拒」的核心安全规则。
 */
describe('OrderLifecycleCore.canTransition', () => {
  it('幂等：from === to 一律允许', () => {
    for (const s of Object.values(ORDER_STATUS)) {
      expect(OrderLifecycleCore.canTransition(s, s)).toBe(true);
    }
  });

  it('结账：submitted/printed/unpaid → settled 允许', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.SUBMITTED, ORDER_STATUS.SETTLED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.PRINTED, ORDER_STATUS.SETTLED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.UNPAID, ORDER_STATUS.SETTLED)).toBe(true);
  });

  it('结账：draft → settled 不允许（草稿不能直接结账）', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.DRAFT, ORDER_STATUS.SETTLED)).toBe(false);
  });

  it('取消：未到终态的订单都可取消', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.DRAFT, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.SUBMITTED, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.PRINTED, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.UNPAID, ORDER_STATUS.CANCELLED)).toBe(true);
  });

  it('终态不可再转出：settled/cancelled/refunded → 任意其它态一律拒绝', () => {
    const terminals = [ORDER_STATUS.SETTLED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED];
    const targets = [
      ORDER_STATUS.DRAFT,
      ORDER_STATUS.SUBMITTED,
      ORDER_STATUS.PRINTED,
      ORDER_STATUS.UNPAID,
      ORDER_STATUS.SETTLED,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.REFUNDED,
    ];
    for (const from of terminals) {
      for (const to of targets) {
        if (from === to) continue; // 幂等单独允许
        expect(OrderLifecycleCore.canTransition(from, to)).toBe(false);
      }
    }
  });

  it('打印：仅 submitted → printed 允许', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.SUBMITTED, ORDER_STATUS.PRINTED)).toBe(true);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.UNPAID, ORDER_STATUS.PRINTED)).toBe(false);
  });

  it('不允许通过状态接口手动设置 refunded（由退款模块驱动）', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.SUBMITTED, ORDER_STATUS.REFUNDED)).toBe(false);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.SETTLED, ORDER_STATUS.REFUNDED)).toBe(false);
  });

  it('不允许回退到 draft / submitted', () => {
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.PRINTED, ORDER_STATUS.DRAFT)).toBe(false);
    expect(OrderLifecycleCore.canTransition(ORDER_STATUS.PRINTED, ORDER_STATUS.SUBMITTED)).toBe(false);
  });
});
