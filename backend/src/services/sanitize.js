export function sanitizeName(input) {
  const name = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,79}$/u.test(name)) {
    return {
      ok: false,
      message: 'Enter your full name using letters, spaces, hyphens, or apostrophes (2–80 characters).',
    };
  }
  return { ok: true, name };
}

export function sanitizeEmail(input) {
  if (input == null || String(input).trim() === '') return { ok: true, email: null };
  const email = String(input).trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address or leave it blank.' };
  }
  return { ok: true, email };
}
