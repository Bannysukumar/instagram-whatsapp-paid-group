import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.jsx';
import { RegisterForm } from '../components/RegisterForm.jsx';
import { api } from '../services/api.js';

export function RegisterPage() {
  const navigate = useNavigate();

  async function handleSubmit(body) {
    const data = await api('/api/registrations', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    navigate(`/status/${data.registration.id}`);
  }

  return (
    <Layout>
      <section className="hero">
        <h1>Request access to the group</h1>
        <p>
          Submit the name and WhatsApp number you want the administrator to use for this membership.
          The number needs its country code. If the group cannot add an unsaved number directly, you will
          receive the group invitation link after the registration is accepted.
        </p>
      </section>
      <section className="card notice">
        <h2>How this information is used</h2>
        <p>
          Your name and WhatsApp number are stored so the administrator can check eligibility, payment when it
          is required, and whether an invitation was issued. An email address is optional and is used only if
          the administrator needs another way to reach you about this request. This form is not used to send
          bulk messages.
        </p>
      </section>
      <RegisterForm onSubmit={handleSubmit} />
    </Layout>
  );
}
