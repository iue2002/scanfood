import { IsString, IsNumber, IsOptional, IsNotEmpty, IsEnum, Min, Max, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;

export class CreateRefundDto {
  @IsNumber()
  @Min(1)
  order_id: number;

  @IsNumber()
  @Min(0)
  @Max(999999)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(NO_XSS)
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
