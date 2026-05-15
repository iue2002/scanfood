import { IsString, IsNumber, IsOptional, IsNotEmpty, IsEnum } from 'class-validator';

export class CreateRefundDto {
  @IsNumber()
  order_id: number;

  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class UpdateRefundStatusDto {
  @IsString()
  @IsEnum(['approved', 'rejected'])
  status: string;

  @IsNumber()
  @IsOptional()
  operator_id?: number;
}
