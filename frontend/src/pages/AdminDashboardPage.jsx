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

const PAYMENT_LABELS = {
  not_required: 'Not required',
  pending: 'Pending',
  verified: 'Verified',
  failed: 'Failed',
};

const STATS = [
  ['total', 'Registrations'],
  ['completed', 'Added in group'],
  ['inviteReady', 'Invitation ready'],
  ['pendingAdmission', 'Pending admission'],
  ['failed', 'Failed'],
  ['pendingPayments', 'Pending payments'],
  ['verifiedPayments', 'Verified payments'],
];

const SESSION_LABELS = {
  authenticated: 'Connected',
  qr_required: 'Waiting for a scan',
  unknown: 'Not checked yet',
  disabled: 'Turned off',
  error: 'Browser problem',
};

function contactStatusLabel(saved) {
  if (saved === true) return 'Saved';
  if (saved === false) return 'Not saved';
  return 'Not tried yet';
}

function readImage(path, token) {
  return fetch(`${path}?ts=${Date.now()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  })
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => new Promise((resolve) => {
      if (!blob) {
        resolve('');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    }));
}

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
  const [liveAction, setLiveAction] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [waView, setWaView] = useState(null);
  const [logoutArmed, setLogoutArmed] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

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
    const timer = setInterval(() => load(query), 3000);
    return () => clearInterval(timer);
  }, [query]);

  useEffect(() => {
    if (waView !== 'scanner') return undefined;
    const timer = setInterval(() => {
      api('/api/admin/automation/refresh', { method: 'POST' })
        .then(() => load(query))
        .catch((err) => {
          if (!handleAuthError(err)) load(query);
        });
    }, 8000);
    return () => clearInterval(timer);
  }, [waView, query]);

  useEffect(() => {
    if (waView !== 'whatsapp') return undefined;
    let stopped = false;
    let running = false;
    async function tick() {
      if (stopped || running) return;
      running = true;
      try {
        const token = sessionStorage.getItem('wg_admin_token');
        const response = await fetch(`/api/admin/automation/screenshot?ts=${Date.now()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });
        if (!response.ok || stopped) return;
        setLiveAction(response.headers.get('X-WhatsApp-Activity') || 'Waiting');
        const blob = await response.blob();
        const url = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        });
        if (!stopped && url) setShotUrl(url);
      } catch {
        // Keep the last frame on screen.
      } finally {
        running = false;
      }
    }
    tick();
    const timer = setInterval(tick, 700);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waView]);

  useEffect(() => {
    if (waView !== 'scanner' || !automation?.qrAvailable) return undefined;
    let cancelled = false;
    const token = sessionStorage.getItem('wg_admin_token');
    readImage('/api/admin/automation/qr', token).then((nextUrl) => {
      if (!cancelled && nextUrl) setQrUrl(nextUrl);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [waView, automation?.qrAvailable, automation?.lastCheckedAt]);

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
      if (path.endsWith('/retry')) setNotice('This registration is queued again.');
      await load();
    } catch (err) {
      handleAuthError(err);
    }
  }

  async function openView(next) {
    setError('');
    setNotice('');
    setLogoutArmed(false);
    setWaView(next);
    setWaBusy(true);
    try {
      await api('/api/admin/automation/session', { method: 'POST' });
      await load();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setWaBusy(false);
    }
  }

  async function logoutWhatsApp() {
    if (!logoutArmed) {
      setLogoutArmed(true);
      return;
    }
    setError('');
    setNotice('');
    setWaBusy(true);
    try {
      const result = await api('/api/admin/automation/logout', { method: 'POST' });
      setNotice(result.message);
      setLogoutArmed(false);
      setQrUrl('');
      setShotUrl('');
      setWaView('scanner');
      await load();
    } catch (err) {
      setLogoutArmed(false);
      handleAuthError(err);
    } finally {
      setWaBusy(false);
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

  const session = automation?.session || 'unknown';

  return (
    <Layout wide>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Dashboard</h1>
        </div>
        <button type="button" className="secondary" onClick={logout}>Sign out</button>
      </div>
      {error && <p className="form-error banner">{error}</p>}
      {notice && <p className="success banner">{notice}</p>}
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
        <div className="section-head">
          <div>
            <h2>WhatsApp</h2>
            <p className="muted">Link the account that manages the group, or look at that account’s WhatsApp.</p>
          </div>
          <span className={`pill pill-${session}`}>{SESSION_LABELS[session] || session}</span>
        </div>
        <p className="muted queue-line">
          {automation?.queueLength ? `${automation.queueLength} waiting` : 'Queue is clear'}
          {automation?.directAddEnabled ? ' · adding from this account' : ' · invitation link only'}
          {automation?.queuePaused
            ? automation.queuePauseReason === 'qr_login_required'
              ? ' · waiting for a WhatsApp scan, then the line continues'
              : ' · paused because WhatsApp asked to slow down'
            : ''}
        </p>
        <div className="row">
          {automation?.queuePaused && (
            <button type="button" onClick={() => act('/api/admin/automation/resume')}>
              Resume adding
            </button>
          )}
          <button type="button" onClick={() => openView('scanner')} disabled={waBusy}>
            Show scanner
          </button>
          <button type="button" className="secondary" onClick={() => openView('whatsapp')} disabled={waBusy}>
            Show my WhatsApp
          </button>
          <button type="button" className="danger" onClick={logoutWhatsApp} disabled={waBusy}>
            {logoutArmed ? 'Confirm log out' : 'Log out of WhatsApp'}
          </button>
          {waView && (
            <button type="button" className="ghost" onClick={() => { setWaView(null); setLogoutArmed(false); }}>
              Hide
            </button>
          )}
        </div>
        {logoutArmed && (
          <p className="form-error">This signs the current WhatsApp account out of the server. Click confirm to scan a different account.</p>
        )}

        {waView === 'scanner' && (
          <div className="viewer scanner-view">
            <h3>Scan to link WhatsApp</h3>
            <p className="muted">On your phone open WhatsApp, go to Linked devices, then link a device and scan this code.</p>
            {session === 'authenticated' ? (
              <p className="success">This server is already linked. Log out of WhatsApp to scan a different account.</p>
            ) : qrUrl ? (
              <img className="qr-shot" src={qrUrl} alt="WhatsApp login scanner" />
            ) : (
              <p className="muted">{waBusy || automation?.checking ? 'Preparing the scanner…' : 'The scanner will appear here.'}</p>
            )}
          </div>
        )}

        {waView === 'whatsapp' && (
          <div className="viewer">
            <h3>WhatsApp on this server</h3>
            <p className="muted live-action">{liveAction || (waBusy ? 'Opening WhatsApp…' : 'Waiting')}</p>
            {shotUrl ? (
              <img className="session-shot" src={shotUrl} alt="Live WhatsApp on the server" />
            ) : (
              <p className="muted">{waBusy || automation?.checking ? 'Opening WhatsApp…' : 'The WhatsApp view will appear here.'}</p>
            )}
          </div>
        )}
      </section>

      {settings && (
        <form className="card form" onSubmit={saveSettings}>
          <h2>Group</h2>
          <p className="muted">
            Paste the current group invitation link. If a link has spread too far, revoke it in the WhatsApp group,
            create a new one, and save it here.
          </p>
          <label>
            Invitation link
            <input
              value={settings.inviteLink || ''}
              onChange={(event) => setSettings({ ...settings, inviteLink: event.target.value })}
            />
          </label>
          <label>
            Group name
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
              <option value="approval">Require approval after the link is opened</option>
            </select>
          </label>
          <button type="submit">Save group settings</button>
        </form>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Registrations</h2>
        </div>
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            load(query);
          }}
        >
          <input
            value={query}
            aria-label="Search name, phone, or registration id"
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.registrations.map((row) => (
                <tr
                  key={row.id}
                  className={selected?.id === row.id ? 'selected' : undefined}
                  onClick={() => { setSelected(row); setConfirmed(false); }}
                >
                  <td>{row.name}</td>
                  <td>{row.phoneMasked}</td>
                  <td>{row.contactSavedName || '—'}</td>
                  <td>{contactStatusLabel(row.contactSaved)}</td>
                  <td><span className={`pill pill-${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span></td>
                  <td>{PAYMENT_LABELS[row.paymentStatus] || row.paymentStatus}</td>
                  <td>
                    {row.retryable ? (
                      <button
                        type="button"
                        className="compact"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(row);
                          act(`/api/admin/registrations/${row.id}/retry`);
                        }}
                      >
                        Retry
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.registrations.length === 0 && <p className="muted">No registrations match this search.</p>}
        </div>
      </section>

      {selected && (
        <section className="card detail">
          <div className="section-head">
            <div>
              <h2>{selected.name}</h2>
              <p className="muted">{selected.phoneE164}</p>
            </div>
            <span className={`pill pill-${selected.status}`}>{STATUS_LABELS[selected.status] || selected.status}</span>
          </div>
          <dl className="facts">
            <div><dt>Saved as</dt><dd>{selected.contactSavedName || '—'}</dd></div>
            <div><dt>Contact</dt><dd>{contactStatusLabel(selected.contactSaved)}</dd></div>
            <div><dt>Action</dt><dd>{selected.action || 'None yet'}</dd></div>
          </dl>
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
                Retry
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
        <h2>Activity</h2>
        <ul className="logs">
          {logs.map((entry) => (
            <li key={entry.id}>
              <span>{new Date(entry.at).toLocaleString()}</span>
              <strong>{entry.event.replaceAll('_', ' ')}</strong>
              <span>{entry.registrationId || ''}</span>
            </li>
          ))}
          {logs.length === 0 && <li className="muted">No activity yet.</li>}
        </ul>
      </section>
    </Layout>
  );
}
