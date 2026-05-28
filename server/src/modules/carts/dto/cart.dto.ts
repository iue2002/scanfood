import { IsArray, IsNumber, IsOptional, IsString, IsNotEmpty, IsIn, Min, Max, MaxLength, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const NO_XSS = /^[^<>]*$/;

export class CartItemDto {
  @IsNumber()
  @Min(1)
  dish_id: number;

  @IsNumber()
  @IsOptional()
  spec_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  dish_name: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  spec_name?: string;

  @IsNumber()
  @Min(1)
  @Max(999)
  quantity: number;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;

  @IsNumber()
  @IsOptional()
  added_by_user_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  added_by_nickname?: string;
}

export class CreateCartDto {
  @IsNumber()
  table_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsNumber()
  @IsOptional()
  user_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;
}

// ====== 增量操作流 DTO ======
export class CartOpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  idempotencyKey: string;

  @IsIn(['add', 'remove', 'set'])
  action: 'add' | 'remove' | 'set';

  @IsNumber()
  @Min(1)
  dish_id: number;

  @IsNumber()
  @Min(0)
  @Max(999)
  quantity: number;

  @IsNumber()
  @IsOptional()
  added_by_user_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  added_by_nickname?: string;
}

export class SyncCartOpsDto {
  @IsNumber()
  table_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartOpDto)
  ops: CartOpDto[];

  @IsNumber()
  @IsOptional()
  user_id?: number;
}
