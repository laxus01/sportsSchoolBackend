import { IsObject, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ActivateInstallationDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  installationPublicKeyJwk!: Record<string, string>;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  proof!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  appVersion!: string;
}
