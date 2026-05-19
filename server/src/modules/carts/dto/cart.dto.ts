import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCartDto {
  @IsNumber()
  table_id: number;

  @IsArray()
  items: Array<{
    dish_id: number;
    spec_id?: number;
    dish_name: string;
    spec_name?: string;
    quantity: number;
    price: number;
    added_by_user_id?: number;
    added_by_nickname?: string;
  }>;

  @IsNumber()
  @IsOptional()
  user_id?: number;

  @IsString()
  @IsOptional()
  remark?: string;
}
