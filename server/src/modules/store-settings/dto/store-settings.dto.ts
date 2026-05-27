import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateStoreSettingsDto {
  @IsString()
  @MaxLength(100)
  @Matches(NO_XSS)
  store_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  store_avatar?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM)
  pickup_reset_time?: string;
}