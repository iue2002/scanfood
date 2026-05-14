import { IsString, IsNumber, IsOptional, IsIn, Min, IsBoolean } from 'class-validator';

export class CreateDishDto {
  @IsNumber()
  category_id: number;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}

export class UpdateDishDto {
  @IsOptional()
  @IsNumber()
  category_id?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @IsIn(['available', 'unavailable'])
  status?: string;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}

export class CreateDishSpecDto {
  @IsNumber()
  dish_id: number;

  @IsString()
  spec_name: string;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
