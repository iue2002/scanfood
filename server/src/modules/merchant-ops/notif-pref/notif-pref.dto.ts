import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ALL_DESKTOP_EVENTS } from './notif-pref.types';

export class UpdateNotifPrefDto {
  @IsBoolean()
  sound_enabled!: boolean;

  @IsString()
  @MaxLength(64)
  sound_id!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(ALL_DESKTOP_EVENTS as unknown as string[], { each: true })
  desktop_events!: ('NEW_ORDER' | 'ADD_ITEM' | 'REFUND')[];

  /** 可选：邮件接收地址（空串/null 关闭邮件） */
  @IsOptional()
  @ValidateIf((o) => typeof o.email === 'string' && o.email.length > 0)
  @IsEmail({}, { message: 'email 格式不合法' })
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(ALL_DESKTOP_EVENTS as unknown as string[], { each: true })
  email_events?: ('NEW_ORDER' | 'ADD_ITEM' | 'REFUND')[];
}
