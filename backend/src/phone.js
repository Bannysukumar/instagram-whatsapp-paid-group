import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw.startsWith('+')) {
    return {
      ok: false,
      message: 'Enter the WhatsApp number with a country code, for example +91 98765 43210.',
    };
  }
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isValid()) {
    return {
      ok: false,
      message: 'That phone number is not valid. Include the country code and check the digits.',
    };
  }
  return { ok: true, e164: parsed.number };
}

export function maskPhone(e164) {
  const value = String(e164 || '');
  if (value.length < 8) return '***';
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(2, value.length - 7))}${value.slice(-4)}`;
}
