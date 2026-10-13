import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.jsx';
import { api } from '../services/api.js';

const STATUS_LABELS = {
  pending_payment: 'Pending payment',
  processing: 'Adding to group',
  pending_admission: 'Pending admission',
  invite_ready: 'Invite ready',
  awaiting_confirmation: 'Awaiting confirmation',
  joined_confirmed: 'Added in group',
  failed: 'Failed',
};

const STATS = [
  ['total', 'Total registrations'],
  ['pendingPayments', 'Pending payments'],
  ['verifiedPayments', 'Verified payments'],
  ['pendingAdmission', 'Pending admission'],
  ['inviteReady', 'Invitation ready'],
  ['completed', 'Added in group'],
  ['failed', 'Failed tasks'],
];

function contactStatusLabel(saved) {
  if (saved === true) return 'Saved';
  if (saved === false) return 'Not saved';
  return 'Not tried yet';
}

const SESSION_HELP = {
  authenticated: 'WhatsApp Web is logged in on the saved browser profile.',
  qr_required: 'Scan the QR code below with the WhatsApp account that manages the group.',
  unknown: 'The session has not been checked yet.',
  disabled: 'Browser automation is turned off.',
  error: 'The browser did not start. Install Chromium with npm run playwright:install in the backend folder.',
};

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState(null);
  const [automation, setAutomation] = useState(null);
  const [logs, setLogs] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [shotUrl, setShotUrl] = useState('');

  function handleAuthError(err) {
    if (err.status === 401) {
      sessionStorage.removeItem('wg_admin_token');
      navigate('/admin/login');
      return true;
    }
    setError(err.message);
    return false;
  }

  async function load(search = query) {
    try {
      const [list, nextSettings, nextAutomation, nextLogs] = await Promise.all([
        api(`/api/admin/registrations?q=${encodeURIComponent(search)}`),
        api('/api/admin/settings'),
        api('/api/admin/automation/status'),
        api('/api/admin/logs'),
      ]);
      setData(list);
      setSettings(nextSettings.settings);
      setAutomation(nextAutomation);
      setLogs(nextLogs.logs);
    } catch (err) {
      handleAuthError(err);
    }
  }

  useEffect(() => {
    if (!sessionStorage.getItem('wg_admin_token')) {
      navigate('/admin/login');
      return undefined;
    }
    load('');
    return undefined;
  }, [navigate]);

  useEffect(() => {
    if (!automation?.queueLength && !automation?.checking && automation?.session !== 'qr_required') return undefined;
    const timer = setTimeout(() => load(query), 3000);
    return () => clearTimeout(timer);
  }, [automation?.queueLength, automation?.activeJobId, automation?.checking, automation?.session, automation?.lastCheckedAt, query]);

  useEffect(() => {
    if (!automation?.screenshotAvailable) return undefined;
    let cancelled = false;
    const token = sessionStorage.getItem('wg_admin_token');
    fetch(`/api/admin/automation/screenshot?ts=${Date.now()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => new Promise((resolve) => {
        if (!blob || cancelled) {
          resolve('');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      }))
      .then((nextUrl) => {
        if (!cancelled && nextUrl) setShotUrl(nextUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [automation?.screenshotAvailable, automation?.lastCheckedAt]);

  async function act(path, body) {
    setError('');
    setNotice('');
    try {
      const result = await api(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (result.registration) setSelected(result.registration);
      if (result.message) setNotice(result.message);
      await load();
    } catch (err) {
      handleAuthError(err);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(result.settings);
      setNotice(result.notice);
    } catch (err) {
      handleAuthError(err);
    }
  }

  function logout() {
    sessionStorage.removeItem('wg_admin_token');
    navigate('/admin/login');
  }

  return (
    <Layout>
      <div className="row spread">
        <h1>Dashboard</h1>
        <button type="button" className="secondary" onClick={logout}>Sign out</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      {data && (
        <section className="stats">
          {STATS.map(([key, label]) => (
            <article key={key} className="card stat">
              <strong>{data.stats[key]}</strong>
              <span>{label}</span>
            </article>
          ))}
        </section>
      )}

      <section className="card">
        <h2>WhatsApp session</h2>
        <p>{SESSION_HELP[automation?.session] || automation?.session}</p>
        <p className="muted">
          Queue {automation?.queueLength ?? 0}
          {automation?.directAddEnabled ? ' · direct add enabled' : ' · invitation link mode'}
          {automation?.queuePaused ? ' · paused because WhatsApp asked to slow down' : ''}
          {automation?.lastError ? ` · ${automation.lastError}` : ''}
        </p>
        {automation?.queuePaused && (
          <button type="button" onClick={() => act('/api/admin/automation/resume')}>
            Resume adding
          </button>
        )}
        <button type="button" onClick={() => act('/api/admin/automation/session')}>
          Open WhatsApp Web
        </button>
        {shotUrl && <img className="session-shot" src={shotUrl} alt="WhatsApp Web on the server" />}
      </section>

      {settings && (
        <form className="card form" onSubmit={saveSettings}>
          <h2>Invitation link</h2>
          <p>
            Paste the current group invitation link. To replace a link that has spread too far, revoke it in
            the WhatsApp group first, create a new link, and save that new link here. The old link stops working
            as soon as WhatsApp revokes it.
          </p>
          <label>
            Invitation link
            <input
              value={settings.inviteLink || ''}
              onChange={(event) => setSettings({ ...settings, inviteLink: event.target.value })}
            />
          </label>
          <label>
            Group name for the optional add attempt
            <input
              value={settings.groupName || ''}
              onChange={(event) => setSettings({ ...settings, groupName: event.target.value })}
            />
          </label>
          <label>
            Admission
            <select
              value={settings.admissionMode}
              onChange={(event) => setSettings({ ...settings, admissionMode: event.target.value })}
            >
              <option value="invite">Show the link when eligible</option>
              <option value="approval">Require administrator approval after the link is opened</option>
            </select>
          </label>
          <button type="submit">Save settings</button>
        </form>
      )}

      <section className="card">
        <h2>Registrations</h2>
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            load(query);
          }}
        >
          <input
            value={query}
            placeholder="Search name, phone, or registration id"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Saved as</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {data?.registrations.map((row) => (
                <tr key={row.id} onClick={() => { setSelected(row); setConfirmed(false); }}>
                  <td>{row.name}</td>
                  <td>{row.phoneMasked}</td>
                  <td>{row.contactSavedName || '—'}</td>
                  <td>{contactStatusLabel(row.contactSaved)}</td>
                  <td>{STATUS_LABELS[row.status] || row.status}</td>
                  <td>{row.paymentStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.registrations.length === 0 && <p>No registrations match this search.</p>}
        </div>
      </section>

      {selected && (
        <section className="card">
          <h2>{selected.name}</h2>
          <p>{selected.phoneE164}</p>
          <p>Status: {STATUS_LABELS[selected.status] || selected.status}</p>
          <p>Saved as: {selected.contactSavedName || '—'}</p>
          <p>Contact: {contactStatusLabel(selected.contactSaved)}</p>
          <p>Action: {selected.action || 'none'}</p>
          {selected.failureMessage && <p className="form-error">{selected.failureMessage}</p>}
          <div className="row">
            <button type="button" className="secondary" onClick={() => act(`/api/admin/registrations/${selected.id}/review`)}>
              Mark reviewed
            </button>
            <button type="button" className="secondary" onClick={() => act(`/api/admin/registrations/${selected.id}/admit`)}>
              Mark awaiting confirmation
            </button>
            {selected.retryable && (
              <button type="button" onClick={() => act(`/api/admin/registrations/${selected.id}/retry`)}>
                Retry group add
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I looked in the WhatsApp group and this person is a member.</span>
          </label>
          <button
            type="button"
            disabled={!confirmed}
            onClick={() => act(`/api/admin/registrations/${selected.id}/confirm`, { confirmedInGroup: true })}
          >
            Confirm membership
          </button>
        </section>
      )}

      <section className="card">
        <h2>Automation log</h2>
        <ul className="logs">
          {logs.map((entry) => (
            <li key={entry.id}>
              <span>{new Date(entry.at).toLocaleString()}</span>
              <strong>{entry.event}</strong>
              <span>{entry.registrationId || ''}</span>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
