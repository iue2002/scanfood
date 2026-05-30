import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { RegisterDto } from './auth.dto';

async function validateRegister(input: Partial<RegisterDto>) {
  const dto = Object.assign(new RegisterDto(), input);
  return validate(dto);
}

describe('RegisterDto', () => {
  it('允许公开注册省略 role，由服务端固定为 customer', async () => {
    const errors = await validateRegister({
      username: 'customer_1',
      password: '123456',
    });

    expect(errors).toHaveLength(0);
  });

  it('允许公开注册显式传 customer', async () => {
    const errors = await validateRegister({
      username: 'customer_2',
      password: '123456',
      role: 'customer',
    });

    expect(errors).toHaveLength(0);
  });

  it('拒绝公开注册创建后台高权限角色', async () => {
    const errors = await validateRegister({
      username: 'bad_actor',
      password: '123456',
      role: 'admin' as any,
    });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
