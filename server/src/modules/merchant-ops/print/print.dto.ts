import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ALL_TEMPLATE_FIELDS } from './print.types';

const PROVIDERS = ['FEIE', 'BLUETOOTH', 'BROWSER'] as const;
const ROLES = ['CASHIER', 'KITCHEN', 'BOTH'] as const;
const WIDTHS = ['58mm', '80mm'] as const;

export class CreatePrinterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsIn(PROVIDERS as unknown as string[])
  provider!: typeof PROVIDERS[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  device_sn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_key_plain?: string;

  @IsOptional()
  @IsString()
  @IsIn(ROLES as unknown as string[])
  role?: typeof ROLES[number];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_print?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_print_add_more?: boolean;

  @IsOptional()
  @IsInt()
  template_id?: number;
}

export class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @IsIn(PROVIDERS as unknown as string[]) provider?: typeof PROVIDERS[number];
  @IsOptional() @IsString() @MaxLength(64) device_sn?: string | null;
  @IsOptional() @IsString() @MaxLength(255) device_key_plain?: string | null;
  @IsOptional() @IsString() @IsIn(ROLES as unknown as string[]) role?: typeof ROLES[number];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() auto_print?: boolean;
  @IsOptional() @IsBoolean() auto_print_add_more?: boolean;
  @IsOptional() @IsInt() template_id?: number | null;
}

export class CreateTemplateDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(8)
  @IsIn(ALL_TEMPLATE_FIELDS as unknown as string[], { each: true })
  fields_json!: string[];

  @IsOptional()
  @IsString()
  @IsIn(WIDTHS as unknown as string[])
  width?: typeof WIDTHS[number];
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(8)
  @IsIn(ALL_TEMPLATE_FIELDS as unknown as string[], { each: true })
  fields_json?: string[];

  @IsOptional()
  @IsString()
  @IsIn(WIDTHS as unknown as string[])
  width?: typeof WIDTHS[number];
}
