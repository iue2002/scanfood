import { IsString, IsNumber, IsOptional, IsNotEmpty, Min, Max, MaxLength, Matches } from 'class-validator';

const TABLE_NUMBER_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(TABLE_NUMBER_PATTERN, { message: '桌号只能包含字母、数字、下划线、连字符' })
  table_number: string;

  @IsNumber()
  @Min(1)
  @Max(50)
  capacity: number;
}

export class UpdateTableDto {
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(TABLE_NUMBER_PATTERN, { message: '桌号只能包含字母、数字、下划线、连字符' })
  table_number?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(50)
  capacity?: number;
}
