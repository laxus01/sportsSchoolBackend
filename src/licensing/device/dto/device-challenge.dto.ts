import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DeviceChallengeDto {
  @IsIn(['activation', 'refresh', 'deactivation'])
  purpose!: 'activation' | 'refresh' | 'deactivation';

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  activationCode?: string;

  @IsOptional()
  @IsUUID()
  installationId?: string;
}
