export function buildPaymentRecord({ paymentId, orderId, registrationId, amount, currency, source }) {
  return { paymentId, orderId, registrationId, amount, currency, source };
}
