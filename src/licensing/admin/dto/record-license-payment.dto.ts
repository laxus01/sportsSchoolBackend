import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class RecordLicensePaymentDto {
  @IsIn(['SUBSCRIPTION_RENEWAL', 'PERPETUAL_LICENSE'])
  paymentType!: 'SUBSCRIPTION_RENEWAL' | 'PERPETUAL_LICENSE';

  @IsInt()
  @Min(1)
  amountCop!: number;

  @IsIn(['COP'])
  currency!: 'COP';

  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'])
  paymentMethod!: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodStartDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodEndDate?: string;
}
