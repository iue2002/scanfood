import { IsString, IsNumber, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  table_number: string;

  @IsNumber()
  capacity: number;
}

export class UpdateTableDto {
  @IsString()
  @IsOptional()
  table_number?: string;

  @IsNumber()
  @IsOptional()
  capacity?: number;
}
