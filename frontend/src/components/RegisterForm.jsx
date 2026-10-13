import { useState } from 'react';
import { Link } from 'react-router-dom';

const EMPTY = { name: '', phone: '', email: '', consent: false };

export function RegisterForm({ onSubmit }) {
  const [values, setValues] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [busy, setBusy] = useState(false);

  function update(event) {
    const { name, type, checked, value } = event.target;
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setDuplicateId('');
    const nextFields = {};
    if (values.name.trim().length < 2) nextFields.name = 'Enter your full name.';
    if (!values.phone.trim().startsWith('+')) {
      nextFields.phone = 'Include the country code, for example +91 98765 43210.';
    }
    if (values.email && !values.email.includes('@')) nextFields.email = 'Enter a valid email or leave it blank.';
    if (!values.consent) nextFields.consent = 'Consent is required.';
    setFields(nextFields);
    if (Object.keys(nextFields).length) return;

    setBusy(true);
    try {
      await onSubmit({
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        consent: true,
      });
    } catch (error) {
      setFields(error.fields || {});
      setFormError(error.message);
      setDuplicateId(error.registrationId || '');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate>
      <label>
        Full name
        <input name="name" autoComplete="name" value={values.name} onChange={update} />
        {fields.name && <span className="field-error">{fields.name}</span>}
      </label>
      <label>
        WhatsApp number
        <input
          name="phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+91 98765 43210"
          value={values.phone}
          onChange={update}
        />
        {fields.phone && <span className="field-error">{fields.phone}</span>}
        {!fields.phone && <span className="hint">Include the country code, for example +91 98765 43210.</span>}
      </label>
      <label>
        Email <span className="optional">optional</span>
        <input name="email" type="email" autoComplete="email" value={values.email} onChange={update} />
        {fields.email && <span className="field-error">{fields.email}</span>}
      </label>
      <label className="check">
        <input name="consent" type="checkbox" checked={values.consent} onChange={update} />
        <span>I agree to the use of my name and WhatsApp number for this group membership request.</span>
      </label>
      {fields.consent && <span className="field-error">{fields.consent}</span>}
      {formError && <p className="form-error">{formError}</p>}
      {duplicateId && (
        <p className="form-error">
          <Link to={`/status/${duplicateId}`}>Open the existing registration</Link>
        </p>
      )}
      <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request access'}</button>
    </form>
  );
}
