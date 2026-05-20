import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;

export class UpdateStoreSettingsDto {
  @IsString()
  @MaxLength(100)
  @Matches(NO_XSS)
  store_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  store_avatar?: string;
}