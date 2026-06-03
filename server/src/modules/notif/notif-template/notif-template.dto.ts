import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIn, IsArray } from 'class-validator';

const VALID_EVENTS = ['NEW_ORDER', 'ADD_ITEM', 'REFUND'];
const VALID_CHANNELS = ['dingtalk', 'wecom', 'feishu', 'email'];

export class UpsertNotifTemplateDto {
  @IsString() @IsNotEmpty() @IsIn(VALID_EVENTS)
  event_type!: string;

  @IsString() @IsNotEmpty() @IsIn(VALID_CHANNELS)
  channel!: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  title_template!: string;

  @IsString() @IsNotEmpty() @MaxLength(10000)
  body_template!: string;

  @IsOptional() @IsString() @MaxLength(50000)
  html_template?: string | null;
}

export class DeleteNotifTemplateDto {
  @IsString() @IsNotEmpty() @IsIn(VALID_EVENTS)
  event_type!: string;

  @IsString() @IsNotEmpty() @IsIn(VALID_CHANNELS)
  channel!: string;
}

export class PreviewNotifTemplateDto {
  @IsString() @IsNotEmpty() @IsIn(VALID_EVENTS)
  event_type!: string;

  @IsString() @IsNotEmpty() @IsIn(VALID_CHANNELS)
  channel!: string;

  @IsString() @IsOptional()
  title_template?: string;

  @IsString() @IsOptional()
  body_template?: string;

  @IsOptional() @IsString()
  html_template?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  allowed_variables?: string[];
}
