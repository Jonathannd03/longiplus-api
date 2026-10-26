import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IsString, IsOptional, IsNumber, MinLength, MaxLength, Matches, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { dbOwner } from '../../db/client.js';
import { schoolApplication } from '../../db/schema.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';

export class ApplyDto {
  @IsString() @MinLength(2) @MaxLength(100) schoolName!: string;
  @IsString() @MinLength(2) @MaxLength(100) province!: string;
  @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @IsString() @IsOptional() @MaxLength(200) address?: string;
  @IsString() @MinLength(2) @MaxLength(100) directorName!: string;
  @Matches(/^\+\d{8,15}$/) directorPhone!: string;
  @IsString() @IsOptional() @MaxLength(100) email?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(50_000) estimatedStudents?: number;
}

@Injectable()
export class RegistrationService {
  constructor(@Inject(SMS_SENDER) private readonly sms: SmsSender) {}

  async apply(dto: ApplyDto) {
    const code = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const [row] = await dbOwner
      .insert(schoolApplication)
      .values({
        schoolName: dto.schoolName.trim(),
        province: dto.province.trim(),
        city: dto.city.trim(),
        address: dto.address?.trim() ?? undefined,
        directorName: dto.directorName.trim(),
        directorPhone: dto.directorPhone.trim(),
        email: dto.email?.trim() ?? undefined,
        estimatedStudents: dto.estimatedStudents ?? undefined,
        activationCode: code,
        activationCodeExpiresAt: expiresAt,
        status: 'pending',
      })
      .returning({ id: schoolApplication.id, status: schoolApplication.status });

    const msg = `LongiPlus : Votre demande d'inscription a été reçue. Code de suivi : ${code}. Un agent vous contactera sous 48h.`;
    await this.sms.send(dto.directorPhone.trim(), msg).catch((err: unknown) =>
      console.error('Registration SMS error', err),
    );

    return row!;
  }
}
