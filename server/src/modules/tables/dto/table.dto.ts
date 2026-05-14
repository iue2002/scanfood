import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  table_number: string;

  @IsNumber()
  @Min(1)
  capacity: number;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  table_number?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @IsIn(['idle', 'occupied', 'settled'])
  status?: string;
}
