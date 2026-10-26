export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SmsSender');
