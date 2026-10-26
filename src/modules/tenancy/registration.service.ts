import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { dbOwner } from '../../db/client.js';
import { schoolApplication } from '../../db/schema.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';

export interface ApplyDto {
  schoolName: string;
  province: string;
  city: string;
  address?: string;
  directorName: string;
  directorPhone: string;
  email?: string;
  estimatedStudents?: number;
}

@Injectable()
export class RegistrationService {
  constructor(@Inject(SMS_SENDER) private readonly sms: SmsSender) {}

  async apply(dto: ApplyDto) {
    if (!dto.schoolName?.trim()) throw new BadRequestException('schoolName required');
    if (!dto.directorName?.trim()) throw new BadRequestException('directorName required');
    if (!dto.directorPhone?.trim()) throw new BadRequestException('directorPhone required');

    const code = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const [row] = await dbOwner
      .insert(schoolApplication)
      .values({
        schoolName: dto.schoolName.trim(),
        province: dto.province?.trim() ?? '',
        city: dto.city?.trim() ?? '',
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
