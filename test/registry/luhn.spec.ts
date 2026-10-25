import { describe, it, expect } from 'vitest';
import { computeCheckDigit, generateCode, validateCode } from '../../src/modules/registry/luhn.js';

describe('Luhn check digit', () => {
  it('generates a valid 9-digit code for a known payload', () => {
    const payload = '12345678';
    const code = generateCode(payload);
    expect(code).toHaveLength(9);
    expect(validateCode(code)).toBe(true);
  });

  it('check digit is correct for 12345678 → 2', () => {
    // Verify manually: positions from right 9..2, doubled at even positions (8,6,4,2)
    // d1=1(9,odd,1), d2=2(8,even,4), d3=3(7,odd,3), d4=4(6,even,8), d5=5(5,odd,5),
    // d6=6(4,even,3), d7=7(3,odd,7), d8=8(2,even,7) → sum=38 → (10-8)%10=2
    expect(computeCheckDigit('12345678')).toBe(2);
    expect(validateCode('123456782')).toBe(true);
  });

  it('validates all generated codes as valid', () => {
    for (const payload of ['10000000', '10000001', '99999998', '55512345', '00000001']) {
      const code = generateCode(payload);
      expect(validateCode(code)).toBe(true);
    }
  });

  it('rejects codes with a single digit changed (typing error detection)', () => {
    const code = generateCode('12345678'); // 123456782
    // Flip the last payload digit: 12345679 → different check digit
    const altered = code.slice(0, 7) + '9' + code[8];
    expect(validateCode(altered)).toBe(false);
  });

  it('rejects codes with transposed adjacent digits', () => {
    const code = generateCode('12345678'); // 123456782
    // Transpose digits 1 and 2: 213456782
    const transposed = '2' + '1' + code.slice(2);
    expect(validateCode(transposed)).toBe(false);
  });

  it('rejects codes shorter or longer than 9 digits', () => {
    expect(validateCode('12345678')).toBe(false);
    expect(validateCode('1234567890')).toBe(false);
  });

  it('rejects non-numeric codes', () => {
    expect(validateCode('12345678X')).toBe(false);
  });

  it('throws for payload that is not 8 digits', () => {
    expect(() => computeCheckDigit('1234567')).toThrow();
    expect(() => computeCheckDigit('123456789')).toThrow();
    expect(() => computeCheckDigit('1234567a')).toThrow();
  });
});
