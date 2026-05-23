import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import type { Role } from '../auth/rbac.types';

const ASSIGNABLE_ROLES = ['owner', 'manager', 'cashier', 'waiter'] as const;
const STATUS_VALUES = ['active', 'disabled'] as const;
const NO_XSS = /^[^<>]*$/;

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 30)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字与下划线' })
  username!: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 64)
  password!: string;

  @IsString()
  @IsIn(ASSIGNABLE_ROLES as unknown as string[])
  role!: Role;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @Matches(NO_XSS)
  nickname?: string;
}

export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  @Matches(NO_XSS)
  nickname?: string;

  @IsString()
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES as unknown as string[])
  role?: Role;

  @IsString()
  @IsOptional()
  @IsIn(STATUS_VALUES as unknown as string[])
  status?: 'active' | 'disabled';
}

export class ListEmployeeQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES as unknown as string[])
  role?: Role;

  @IsString()
  @IsOptional()
  @IsIn(['active', 'disabled', 'deleted'])
  status?: 'active' | 'disabled' | 'deleted';

  @IsString()
  @IsOptional()
  @MaxLength(30)
  username?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsIn([10, 20, 50])
  @IsOptional()
  pageSize?: 10 | 20 | 50;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @Length(8, 64)
  oldPassword!: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 64)
  newPassword!: string;
}
