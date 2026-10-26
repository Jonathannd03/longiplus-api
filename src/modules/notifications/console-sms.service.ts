import { Injectable } from '@nestjs/common';
import type { SmsSender } from './sms-sender.interface.js';

@Injectable()
export class ConsoleSmsService implements SmsSender {
  async send(to: string, message: string): Promise<void> {
    const ts = new Date().toISOString();
    const masked = to.slice(0, 6) + '***' + to.slice(-2);
    const preview = message.length > 40 ? message.slice(0, 40) + '…' : message;
    console.log(`[SMS ${ts}] to=${masked} | ${preview}`);
  }
}
