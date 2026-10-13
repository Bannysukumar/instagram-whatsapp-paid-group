import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskPhone, normalizePhone } from '../src/phone.js';

describe('phone numbers', () => {
  it('normalizes international numbers to E.164', () => {
    assert.equal(normalizePhone('+1 (415) 555-0100').e164, '+14155550100');
    assert.equal(normalizePhone('+44 7911 123456').e164, '+447911123456');
    assert.equal(normalizePhone('+91 98765 43210').e164, '+919876543210');
  });

  it('rejects numbers without a country code or with bad digits', () => {
    assert.equal(normalizePhone('4155550100').ok, false);
    assert.equal(normalizePhone('+123').ok, false);
    assert.equal(normalizePhone('').ok, false);
  });

  it('masks the middle of a number', () => {
    const masked = maskPhone('+14155550100');
    assert.equal(masked.startsWith('+14'), true);
    assert.equal(masked.endsWith('0100'), true);
    assert.equal(masked.includes('5555'), false);
  });
});
