/**
 * Feature: merchant-ops-center, Property 24/25: image cleanup path safety
 * Validates: 资源清理只命中 /uploads/ 下的本地文件，绝不跨目录、不删外部 URL
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as path from 'path';
import { resolveLocalUpload } from './image-cleanup';

const ROOT = path.resolve('/tmp/test-uploads');

describe('Feature: merchant-ops-center, Property 24: resolveLocalUpload accepts only /uploads/* relative paths', () => {
  it('accepts simple /uploads/<file> path', () => {
    const r = resolveLocalUpload('/uploads/abc.png', ROOT);
    expect(r).not.toBeNull();
    expect(r!.url).toBe('/uploads/abc.png');
    expect(r!.absPath).toBe(path.resolve(ROOT, 'abc.png'));
  });

  it('accepts /uploads/sub/<file>', () => {
    const r = resolveLocalUpload('/uploads/menu/img.jpg', ROOT);
    expect(r).not.toBeNull();
    expect(r!.absPath).toBe(path.resolve(ROOT, 'menu/img.jpg'));
  });

  it('rejects null / undefined / empty / whitespace', () => {
    expect(resolveLocalUpload(null, ROOT)).toBeNull();
    expect(resolveLocalUpload(undefined, ROOT)).toBeNull();
    expect(resolveLocalUpload('', ROOT)).toBeNull();
    expect(resolveLocalUpload('   ', ROOT)).toBeNull();
  });

  it('rejects absolute external URLs', () => {
    expect(resolveLocalUpload('http://example.com/foo.png', ROOT)).toBeNull();
    expect(resolveLocalUpload('https://cdn.example.com/foo.png', ROOT)).toBeNull();
    expect(resolveLocalUpload('ftp://x/y', ROOT)).toBeNull();
    expect(resolveLocalUpload('tos://bucket/key', ROOT)).toBeNull();
  });

  it('rejects non-/uploads paths', () => {
    expect(resolveLocalUpload('/etc/passwd', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads', ROOT)).toBeNull();
    expect(resolveLocalUpload('uploads/foo.png', ROOT)).toBeNull();
    expect(resolveLocalUpload('//uploads/foo.png', ROOT)).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(resolveLocalUpload('/uploads/../etc/passwd', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads/sub/../../secret', ROOT)).toBeNull();
    // 拒绝 // 起头的路径（更严格更安全）
    expect(resolveLocalUpload('/uploads//file', ROOT)).toBeNull();
  });

  it('rejects URLs with query / fragment / whitespace / null bytes', () => {
    expect(resolveLocalUpload('/uploads/x.png?token=abc', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads/x.png#frag', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads/x  .png', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads/x\0.png', ROOT)).toBeNull();
    expect(resolveLocalUpload('/uploads/\nfoo.png', ROOT)).toBeNull();
  });

  it('rejects empty filename after prefix', () => {
    expect(resolveLocalUpload('/uploads/', ROOT)).toBeNull();
  });

  // ============================================================
  // PBT：任何输入下，返回非空时 absPath 一定在 ROOT 下，且 url 一定以 /uploads/ 起头
  // ============================================================
  it('Property 24 invariant: returned absPath always inside uploadsRoot', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const r = resolveLocalUpload(raw, ROOT);
        if (r === null) return true;
        // 不变量 1：url 以 /uploads/ 起头
        if (!r.url.startsWith('/uploads/')) return false;
        // 不变量 2：absPath 在 ROOT 下
        const rootAbs = path.resolve(ROOT);
        if (r.absPath !== rootAbs && !r.absPath.startsWith(rootAbs + path.sep)) return false;
        // 不变量 3：absPath 不等于 root 本身（不能删 uploads 目录）
        if (r.absPath === rootAbs) return false;
        return true;
      }),
      { numRuns: 500 },
    );
  });

  // ============================================================
  // PBT：随机生成"试图穿越"的攻击 URL，必须全部被拒
  // ============================================================
  it('Property 25: never accepts paths that try to escape uploadsRoot', () => {
    const traversalArb = fc
      .array(fc.constantFrom('..', 'foo', 'bar'), { minLength: 1, maxLength: 6 })
      .filter((parts) => parts.includes('..'));
    fc.assert(
      fc.property(traversalArb, (parts) => {
        const url = '/uploads/' + parts.join('/');
        const r = resolveLocalUpload(url, ROOT);
        return r === null;
      }),
      { numRuns: 200 },
    );
  });
});
