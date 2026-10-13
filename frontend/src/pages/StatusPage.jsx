import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../components/Layout.jsx';
import { StatusCard } from '../components/StatusCard.jsx';
import { api, formatMoney, loadRazorpay } from '../services/api.js';

export function StatusPage() {
  const { id } = useParams();
  const [registration, setRegistration] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  async function refresh() {
    const data = await api(`/api/registrations/${id}`);
    setRegistration(data.registration);
    return data.registration;
  }

  useEffect(() => {
    let stopped = false;
    api('/api/config')
      .then((value) => { if (!stopped) setConfig(value); })
      .catch(() => { if (!stopped) setConfig({ paymentsEnabled: false }); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    let timer;
    let stopped = false;
    async function tick() {
      try {
        const data = await api(`/api/registrations/${id}`);
        if (stopped) return;
        setRegistration(data.registration);
        if (data.registration.status === 'processing') timer = setTimeout(tick, 2000);
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  async function pay() {
    setPaying(true);
    setError('');
    try {
      const order = await api('/api/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({ registrationId: id }),
      });
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const checkout = new window.Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: 'Group access',
          description: 'Membership registration',
          handler: async (response) => {
            try {
              await api('/api/payments/verify', {
                method: 'POST',
                body: JSON.stringify({
                  registrationId: id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) },
        });
        checkout.open();
      });
      let current = await refresh();
      for (let attempt = 0; attempt < 15 && current.status === 'processing'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        current = await refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  return (
    <Layout>
      <h1>Registration status</h1>
      {error && <p className="form-error">{error}</p>}
      <StatusCard
        registration={registration}
        paymentsEnabled={Boolean(config?.paymentsEnabled)}
        amountLabel={formatMoney(config?.paymentAmount, config?.paymentCurrency)}
        onPay={pay}
        paying={paying}
      />
    </Layout>
  );
}
