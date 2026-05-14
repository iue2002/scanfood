import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class RegisterDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn(['customer', 'admin', 'staff'])
  role: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class WechatLoginDto {
  @IsString()
  code: string; // 微信登录code
}
