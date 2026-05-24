import { IsString, IsNumber, IsOptional, IsNotEmpty, IsBoolean, IsInt, Min, Max, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;

export class CreateDishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  name: string;

  @IsNumber()
  @Min(1)
  category_id: number;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  image_url?: string;

  /** 必选菜品：true 时顾客下单未点会被拒 */
  @IsBoolean()
  @IsOptional()
  is_required?: boolean;

  /** 最少点餐数量：≥ 1（默认 1） */
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(999)
  min_quantity?: number;
}

export class UpdateDishDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(NO_XSS)
  name?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  category_id?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(999999)
  price?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  image_url?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsBoolean()
  @IsOptional()
  is_required?: boolean;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(999)
  min_quantity?: number;
}

export class CreateDishSpecDto {
  @IsNumber()
  @Min(1)
  dish_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  spec_name: string;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;
}

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  name: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(999)
  sort_order?: number;
}
