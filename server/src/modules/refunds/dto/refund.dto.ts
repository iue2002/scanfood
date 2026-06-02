import { IsString, IsNumber, IsNotEmpty, IsEnum, Min, Max, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;

export class CreateRefundDto {
  @IsNumber()
  @Min(1)
  order_id: number;

  @IsNumber()
  @Min(0.01)
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
  // operator_id 已移除：操作人一律从 JWT 注入，不接受前端传入（防伪造操作人）
}
