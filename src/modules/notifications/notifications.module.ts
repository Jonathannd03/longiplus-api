import { Module } from '@nestjs/common';
import { ConsoleSmsService } from './console-sms.service.js';
import { SMS_SENDER } from './sms-sender.interface.js';

@Module({
  providers: [{ provide: SMS_SENDER, useClass: ConsoleSmsService }],
  exports: [{ provide: SMS_SENDER, useClass: ConsoleSmsService }],
})
export class NotificationsModule {}
