const base = import.meta.env.VITE_API_URL || '';

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('wg_admin_token');
  if (token && path.startsWith('/api/admin') && !path.endsWith('/login')) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Request failed.');
    error.code = data.error?.code;
    error.fields = data.error?.fields;
    error.registrationId = data.error?.registrationId;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function formatMoney(amount, currency) {
  if (!amount || !currency) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency}`;
  }
}

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
    document.body.appendChild(script);
  });
}
