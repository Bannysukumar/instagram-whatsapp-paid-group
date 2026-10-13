export function classifyLoginSignals({ hasChatList = false, hasQr = false } = {}) {
  if (hasChatList) return 'authenticated';
  if (hasQr) return 'qr_required';
  return 'unknown';
}

export function browserFailureCode(error) {
  const message = String(error?.message || '');
  if (message.includes("Executable doesn't exist") || message.includes('Please run the following command')) {
    return 'browser_not_installed';
  }
  return 'browser_crash';
}
