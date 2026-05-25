/**
 * SMTP 配置 DTO
 *
 * 双模式：
 *   - mode='platform'：使用 .env 里的 SMTP_PLATFORM_*（不填具体字段）
 *   - mode='custom'：店主自己配（host/port/user/pass/from 必填）
 *
 * 写入时密码会经 AES-256-GCM 加密存进 store_settings.smtp_pass_enc
 */
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';

export class UpdateSmtpDto {
  @IsIn(['platform', 'custom'])
  mode!: 'platform' | 'custom';

  /** mode=custom 时必填 */
  @ValidateIf((o) => o.mode === 'custom')
  @IsString()
  @MaxLength(255)
  host?: string;

  @ValidateIf((o) => o.mode === 'custom')
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ValidateIf((o) => o.mode === 'custom')
  @IsString()
  @MaxLength(255)
  user?: string;

  /**
   * 明文密码：可选（如果未填写表示沿用旧密码）。
   * 后端会用 AES-256-GCM 加密后存入 smtp_pass_enc。
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pass?: string;

  @ValidateIf((o) => o.mode === 'custom')
  @IsEmail({}, { message: 'from 必须是合法邮箱地址' })
  @MaxLength(255)
  from?: string;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;
}
