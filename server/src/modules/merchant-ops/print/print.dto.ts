import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ALL_TEMPLATE_FIELDS } from './print.types';

const PROVIDERS = ['FEIE', 'YLY', 'ZYY', 'XPRINTER', 'BLUETOOTH', 'BROWSER'] as const;
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


// ============================================================
// 高度定制化打印方案 DTO
// ============================================================

export class PrintPlanSliceDto {
  @IsInt()
  @Min(1)
  printer_id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  template_id?: number | null;

  @IsOptional()
  @IsString()
  @IsIn(ROLES as unknown as string[])
  printer_role_snapshot?: typeof ROLES[number];

  /** 分类 id 数组；null/[] = catch-all 兜底切片 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  category_ids?: number[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

export class PrintPlanUpsertBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default_dine_in?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default_takeaway?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrintPlanSliceDto)
  slices!: PrintPlanSliceDto[];
}

export class SelectivePrintDto {
  @IsInt() @Min(1) printer_id!: number;

  @IsOptional() @IsInt() @Min(1) template_id?: number | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selected_item_ids!: number[];

  @IsOptional() @IsString() @MaxLength(100) label?: string;
}


export class PrintReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  lines!: string[];
}
