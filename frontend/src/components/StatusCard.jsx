const LABELS = {
  pending_payment: 'Payment required',
  processing: 'Adding to group',
  pending_admission: 'Waiting for approval',
  invite_ready: 'Invitation ready',
  awaiting_confirmation: 'Awaiting confirmation',
  joined_confirmed: 'Added in group',
  failed: 'Needs attention',
};

export function StatusCard({ registration, paymentsEnabled, amountLabel, onPay, paying }) {
  if (!registration) return null;
  return (
    <section className="card status-card">
      <p className={`pill pill-${registration.status}`}>{LABELS[registration.status] || registration.status}</p>
      <h2>{registration.name}</h2>
      <p className="muted">{registration.phoneMasked}</p>
      <p>{registration.message}</p>
      {registration.status === 'processing' && registration.queuePosition && (
        <p className="muted">Place in line: {registration.queuePosition}</p>
      )}
      {registration.status === 'pending_payment' && paymentsEnabled && (
        <button type="button" onClick={onPay} disabled={paying}>
          {paying ? 'Opening checkout…' : `Pay ${amountLabel}`}
        </button>
      )}
      {registration.inviteLink && (
        <p>
          <a className="invite" href={registration.inviteLink}>Open group invitation</a>
        </p>
      )}
      <p className="muted">Registration {registration.id}</p>
    </section>
  );
}
