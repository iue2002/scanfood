import { IsString, MaxLength, Matches } from 'class-validator';

const NO_XSS = /^[^<>]*$/;

export class PrintReportDto {
  @IsString()
  @MaxLength(200)
  @Matches(NO_XSS)
  title: string;

  @IsString()
  @MaxLength(10000)
  content: string;
}