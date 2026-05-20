import { IsString, IsOptional, IsIn, MinLength, MaxLength, Matches } from 'class-validator';

// 用户名：3-20位，仅允许字母数字下划线连字符，防 NoSQL 注入
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
// 防 XSS：禁止 <> 标签
const NO_XSS = /^[^<>]*$/;

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(USERNAME_PATTERN, { message: '用户名只能包含字母、数字、下划线、连字符' })
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(USERNAME_PATTERN, { message: '用户名只能包含字母、数字、下划线、连字符' })
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsIn(['customer', 'admin', 'staff'])
  role: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(NO_XSS, { message: '昵称包含非法字符' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatar_url?: string;
}

export class WechatLoginDto {
  @IsString()
  @MaxLength(256)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(NO_XSS, { message: '昵称包含非法字符' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatar_url?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(NO_XSS, { message: '昵称包含非法字符' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatar_url?: string;
}

export class BindTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(USERNAME_PATTERN, { message: '桌号只能包含字母、数字、下划线、连字符' })
  tableNumber: string;
}
