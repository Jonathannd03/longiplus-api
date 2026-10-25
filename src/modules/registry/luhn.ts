function luhnDouble(d: number): number {
  const v = d * 2;
  return v >= 10 ? v - 9 : v;
}

/**
 * Compute Luhn check digit for an 8-digit payload string.
 * In the final 9-digit code, positions from right are 9..1.
 * Payload digits occupy positions 9..2; check digit is at position 1.
 * Positions 8, 6, 4, 2 (even) are doubled → payload indices 1, 3, 5, 7.
 */
export function computeCheckDigit(payload: string): number {
  if (payload.length !== 8 || !/^\d{8}$/.test(payload)) {
    throw new Error('Payload must be exactly 8 digits');
  }
  const digits = payload.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const posFromRight = 9 - i; // 9 down to 2
    sum += posFromRight % 2 === 0 ? luhnDouble(digits[i]!) : digits[i]!;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateCode(payload: string): string {
  return payload + computeCheckDigit(payload);
}

export function validateCode(code: string): boolean {
  if (!/^\d{9}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const posFromRight = 9 - i; // 9 down to 1
    sum += posFromRight % 2 === 0 ? luhnDouble(digits[i]!) : digits[i]!;
  }
  return sum % 10 === 0;
}
