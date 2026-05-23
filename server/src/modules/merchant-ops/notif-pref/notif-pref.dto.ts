import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
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
}
