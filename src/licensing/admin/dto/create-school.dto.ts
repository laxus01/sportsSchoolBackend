import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSchoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxIdentifier?: string;

  @IsIn(['SUBSCRIPTION', 'PERPETUAL'])
  licenseType!: 'SUBSCRIPTION' | 'PERPETUAL';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidThroughDate?: string;
}
