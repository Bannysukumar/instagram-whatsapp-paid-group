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
      <section className="hero-grid">
        <div className="hero">
          <p className="eyebrow">WhatsApp group</p>
          <h1>Request a place in the group</h1>
          <p className="lede">
            Add the name and WhatsApp number the administrator should use. The number is added from the
            administrator’s own WhatsApp, one person at a time.
          </p>
          <ol className="steps">
            <li>
              <strong>1. Register</strong>
              <span>Use your name and WhatsApp number, including the country code.</span>
            </li>
            <li>
              <strong>2. Wait your turn</strong>
              <span>If other people registered first, your place in line is saved.</span>
            </li>
            <li>
              <strong>3. Check this page</strong>
              <span>It updates when the number has been added to the group.</span>
            </li>
          </ol>
        </div>
        <RegisterForm onSubmit={handleSubmit} />
      </section>
      <section className="card notice">
        <h2>How this information is used</h2>
        <p>
          Your name and WhatsApp number are stored so the administrator can check this request and whether
          you were added. An email is optional and is used only if the administrator needs another way to
          reach you about this request. This form does not send messages.
        </p>
      </section>
    </Layout>
  );
}
