import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RefreshLicenseDto {
  @IsUUID()
  challengeId!: string;

  @IsUUID()
  installationId!: string;

  @IsInt()
  @Min(0)
  currentRevision!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  appVersion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  proof!: string;
}
