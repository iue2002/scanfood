/**
 * Feature: merchant-ops-center, Property 1: 权限矩阵全覆盖与决策一致
 * Validates: Requirements 1.2, 1.3, 1.5, 1.6, 2.7
 *
 * 性质：
 *  - 矩阵覆盖性：每一个声明的 AuditAction 都必须在 PERMISSION_MATRIX 中有非空集合
 *  - 决策一致性：isAllowed(role, action) 的结果完全等于 matrix[action].has(role)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PERMISSION_MATRIX, isAllowed } from "./permission-matrix";
import { ALL_AUDIT_ACTIONS, ALL_ROLES } from "./rbac.types";
import type { AuditAction, Role } from "./rbac.types";

describe("Feature: merchant-ops-center, Property 1: permission matrix totality & consistency", () => {
  it("matrix coverage: every declared AuditAction has a non-empty Role set", () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      const allowed = PERMISSION_MATRIX[action];
      expect(allowed, `${action} should have an entry`).toBeDefined();
      expect(
        allowed.size,
        `${action} should have at least one allowed role`,
      ).toBeGreaterThan(0);
    }
  });

  it("decision consistency: isAllowed(role, action) === matrix[action].has(role) for all (role, action) pairs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Role>(...ALL_ROLES),
        fc.constantFrom<AuditAction>(...ALL_AUDIT_ACTIONS),
        (role, action) => {
          const matrixSays = PERMISSION_MATRIX[action]?.has(role) ?? false;
          const fnSays = isAllowed(role, action);
          return matrixSays === fnSays;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("isAllowed returns false for null/undefined role on every action", () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      expect(isAllowed(null, action)).toBe(false);
      expect(isAllowed(undefined, action)).toBe(false);
    }
  });

  it("admin behaves as superset of owner: every action owner can do, admin can also do", () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      const allowed = PERMISSION_MATRIX[action];
      if (allowed.has("owner")) {
        expect(
          allowed.has("admin"),
          `${action}: admin should have at least owner's privileges`,
        ).toBe(true);
      }
    }
  });

  it("customer cannot execute any back-office permission action", () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      expect(
        isAllowed("customer", action),
        `${action}: customer should be denied`,
      ).toBe(false);
    }
  });

  it("cashier and waiter only keep daily operation permissions", () => {
    expect(isAllowed("cashier", "ORDER_READ")).toBe(true);
    expect(isAllowed("cashier", "ORDER_ADD_ITEM")).toBe(true);
    expect(isAllowed("cashier", "ORDER_CHECKOUT")).toBe(true);
    expect(isAllowed("cashier", "TABLE_READ")).toBe(true);
    expect(isAllowed("cashier", "MENU_ITEM_UPDATE")).toBe(false);
    expect(isAllowed("cashier", "STATISTICS_READ")).toBe(false);

    expect(isAllowed("waiter", "ORDER_READ")).toBe(true);
    expect(isAllowed("waiter", "ORDER_MARK_SERVED")).toBe(true);
    expect(isAllowed("waiter", "ORDER_CHECKOUT")).toBe(false);
    expect(isAllowed("waiter", "MENU_ITEM_UPDATE")).toBe(false);
  });
});
