import { Injectable } from '@nestjs/common';
import type { SmsSender } from './sms-sender.interface.js';

@Injectable()
export class ConsoleSmsService implements SmsSender {
  async send(to: string, message: string): Promise<void> {
    const ts = new Date().toISOString();
    console.log(`[SMS ${ts}] to=${to} | ${message}`);
  }
}
