import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const ORDER_STATUSES = ['submitted', 'printed', 'settled', 'cancelled', 'refunded'] as const;

export class ExportOrdersBodyDto {
  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(ORDER_STATUSES as unknown as string[], { each: true })
  status?: typeof ORDER_STATUSES[number][];
}

export class ExportReportBodyDto {
  @IsString()
  @IsIn(['DAILY', 'MONTHLY'])
  type!: 'DAILY' | 'MONTHLY';

  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/, { message: 'date 必须是 YYYY-MM-DD 或 YYYY-MM' })
  date!: string;
}
