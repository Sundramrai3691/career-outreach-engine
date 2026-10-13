import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  Key,
  Shield,
  Activity,
  CheckCircle2,
  Loader2,
  Plus,
  Sliders,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [, setSettings] = useState<any>(null);
  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [suppressions, setSuppressions] = useState<any[]>([]);
  const [, setLoading] = useState(true);

  // Form states
  const [apolloKey, setApolloKey] = useState('');
  const [hunterKey, setHunterKey] = useState('');
  const [snovId, setSnovId] = useState('');
  const [snovSecret, setSnovSecret] = useState('');

  // Spending caps
  const [apolloCap, setApolloCap] = useState<number | ''>('');
  const [hunterCap, setHunterCap] = useState<number | ''>('');

  // Health testing states
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, any>>({});

  // Suppression input
  const [suppressEmailInput, setSuppressEmailInput] = useState('');
  const [suppressReason, setSuppressReason] = useState<'manual_block' | 'opted_out' | 'bounced'>('manual_block');

  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    loadAllSettings();
  }, []);

  const loadAllSettings = async () => {
    try {
      setLoading(true);
      const [settingsRes, googleRes, suppRes] = await Promise.all([
        api.getSettings(),
        api.getGoogleStatus(),
        api.getSuppressions(),
      ]);

      setSettings(settingsRes);
      setGoogleStatus(googleRes);
      setSuppressions(suppRes);

      const apollo = settingsRes.providers?.find((p: any) => p.key === 'apollo');
      if (apollo?.spendingCap !== null) setApolloCap(apollo?.spendingCap);

      const hunter = settingsRes.providers?.find((p: any) => p.key === 'hunter');
      if (hunter?.spendingCap !== null) setHunterCap(hunter?.spendingCap);
    } catch (err) {
      console.error('Failed to load settings', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestHealth = async (providerKey: string) => {
    try {
      setTestingKey(providerKey);
      const res = await api.checkHealth(providerKey);
      setHealthResults((prev) => ({ ...prev, [providerKey]: res }));
      loadAllSettings();
    } catch (err: any) {
      setHealthResults((prev) => ({
        ...prev,
        [providerKey]: { healthy: false, message: err.message },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleSaveApollo = async () => {
    try {
      await api.updateProvider('apollo', {
        apiKey: apolloKey || undefined,
        spendingCap: apolloCap === '' ? null : Number(apolloCap),
      });
      setSaveMessage('Apollo settings saved successfully.');
      setTimeout(() => setSaveMessage(null), 3000);
      setApolloKey('');
      loadAllSettings();
    } catch (err: any) {
      console.error('Save Apollo failed', err);
    }
  };

  const handleSaveHunter = async () => {
    try {
      await api.updateProvider('hunter', {
        apiKey: hunterKey || undefined,
        spendingCap: hunterCap === '' ? null : Number(hunterCap),
      });
      setSaveMessage('Hunter settings saved successfully.');
      setTimeout(() => setSaveMessage(null), 3000);
      setHunterKey('');
      loadAllSettings();
    } catch (err: any) {
      console.error('Save Hunter failed', err);
    }
  };

  const handleSaveSnov = async () => {
    try {
      await api.updateProvider('snov', {
        apiKey: snovId || undefined,
        secret: snovSecret || undefined,
      });
      setSaveMessage('Snov.io settings saved.');
      setTimeout(() => setSaveMessage(null), 3000);
      setSnovId('');
      setSnovSecret('');
      loadAllSettings();
    } catch (err: any) {
      console.error('Save Snov failed', err);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const { url } = await api.getGoogleAuthUrl();
      window.location.href = url;
    } catch (err: any) {
      alert(`Google OAuth initiation failed: ${err.message}`);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Are you sure you want to disconnect your Google account? Stored tokens will be purged.')) return;
    try {
      await api.disconnectGoogle();
      loadAllSettings();
    } catch (err: any) {
      console.error('Disconnect failed', err);
    }
  };

  const handleAddSuppression = async () => {
    if (!suppressEmailInput.trim()) return;
    try {
      await api.addSuppression({
        email: suppressEmailInput.trim(),
        reason: suppressReason,
      });
      setSuppressEmailInput('');
      loadAllSettings();
    } catch (err: any) {
      alert(err.message || 'Failed to add suppression');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2>System Settings & Integrations</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Manage provider API keys, Google Workspace OAuth, spending caps, and suppression rules.
        </p>
      </div>

      {saveMessage && (
        <div
          style={{
            padding: '0.75rem 1.25rem',
            background: 'var(--color-success-bg)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#6ee7b7',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
          }}
        >
          {saveMessage}
        </div>
      )}

      {/* Grid: Providers & Google Connection */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Google Workspace Integration */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Sliders size={20} color="#6366f1" />
            <h3>Google Workspace Connection</h3>
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
            Required for generating Google Sheets recipient lists, Google Docs mail-merge templates, and sending via Gmail.
          </p>

          {googleStatus?.isConnected ? (
            <div
              style={{
                padding: '1rem',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6ee7b7', fontWeight: 600 }}>
                <CheckCircle2 size={16} /> Connected
              </div>
              <div style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                Account: <strong>{googleStatus.account?.email}</strong>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Connected on: {new Date(googleStatus.account?.connectedAt).toLocaleDateString()}
              </div>

              <button
                className="btn btn-danger btn-sm"
                style={{ marginTop: '0.875rem' }}
                onClick={handleDisconnectGoogle}
              >
                Disconnect Account
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                {googleStatus?.isConfigured
                  ? 'OAuth credentials found. Ready to connect.'
                  : 'Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET configured in .env'}
              </div>

              <button
                className="btn btn-primary btn-sm"
                onClick={handleConnectGoogle}
                disabled={!googleStatus?.isConfigured}
              >
                Connect Google Account
              </button>
            </div>
          )}

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Granted Scopes: Drive (File), Sheets, Docs, Gmail Compose. Tokens encrypted via AES-256-GCM.
          </div>
        </div>

        {/* Apollo Integration Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Key size={18} color="#6366f1" />
              <h3>Apollo.io</h3>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleTestHealth('apollo')}
              disabled={testingKey === 'apollo'}
            >
              {testingKey === 'apollo' ? <Loader2 size={12} className="animate-pulse" /> : <Activity size={12} />}
              Test Connection
            </button>
          </div>

          {healthResults['apollo'] && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                marginBottom: '1rem',
                background: healthResults['apollo'].healthy ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                color: healthResults['apollo'].healthy ? '#6ee7b7' : '#fca5a5',
              }}
            >
              {healthResults['apollo'].message}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              value={apolloKey}
              onChange={(e) => setApolloKey(e.target.value)}
              placeholder="Paste new Apollo API key..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Credit Spending Cap (Credits)</label>
            <input
              type="number"
              className="form-input"
              value={apolloCap}
              onChange={(e) => setApolloCap(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="No limit"
            />
          </div>

          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveApollo}>
              Save Apollo Settings
            </button>
          </div>
        </div>

        {/* Hunter Integration Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Key size={18} color="#f59e0b" />
              <h3>Hunter.io</h3>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleTestHealth('hunter')}
              disabled={testingKey === 'hunter'}
            >
              {testingKey === 'hunter' ? <Loader2 size={12} className="animate-pulse" /> : <Activity size={12} />}
              Test Connection
            </button>
          </div>

          {healthResults['hunter'] && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                marginBottom: '1rem',
                background: healthResults['hunter'].healthy ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                color: healthResults['hunter'].healthy ? '#6ee7b7' : '#fca5a5',
              }}
            >
              {healthResults['hunter'].message}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              value={hunterKey}
              onChange={(e) => setHunterKey(e.target.value)}
              placeholder="Paste new Hunter API key..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Spending Cap (Credits)</label>
            <input
              type="number"
              className="form-input"
              value={hunterCap}
              onChange={(e) => setHunterCap(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="No limit"
            />
          </div>

          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveHunter}>
              Save Hunter Settings
            </button>
          </div>
        </div>

        {/* Snov.io Integration Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Key size={18} color="#a855f7" />
              <h3>Snov.io (OAuth 2.0)</h3>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleTestHealth('snov')}
              disabled={testingKey === 'snov'}
            >
              {testingKey === 'snov' ? <Loader2 size={12} className="animate-pulse" /> : <Activity size={12} />}
              Test Connection
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">User ID (Client ID)</label>
            <input
              type="text"
              className="form-input"
              value={snovId}
              onChange={(e) => setSnovId(e.target.value)}
              placeholder="Snov User ID..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Secret (Client Secret)</label>
            <input
              type="password"
              className="form-input"
              value={snovSecret}
              onChange={(e) => setSnovSecret(e.target.value)}
              placeholder="Snov Secret..."
            />
          </div>

          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveSnov}>
              Save Snov Settings
            </button>
          </div>
        </div>
      </div>

      {/* Suppression List Management */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={18} color="#ef4444" /> Outreach Suppression & Opt-Out List
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '1.25rem' }}>
          Addresses listed here are blocked automatically during all campaigns to protect your sender reputation and comply with outreach guidelines.
        </p>

        {/* Add Suppression Row */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="email"
            className="form-input"
            style={{ flex: 1, minWidth: '220px' }}
            placeholder="Enter email to block (e.g. lead@company.com)"
            value={suppressEmailInput}
            onChange={(e) => setSuppressEmailInput(e.target.value)}
          />

          <select
            className="form-select"
            style={{ width: '180px' }}
            value={suppressReason}
            onChange={(e: any) => setSuppressReason(e.target.value)}
          >
            <option value="manual_block">Manual Block</option>
            <option value="opted_out">Opted Out</option>
            <option value="bounced">Bounced Address</option>
          </select>

          <button className="btn btn-primary btn-sm" onClick={handleAddSuppression}>
            <Plus size={14} /> Add Suppression
          </button>
        </div>

        {/* Suppression Table */}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Suppressed Email</th>
                <th>Reason</th>
                <th>Added Date</th>
              </tr>
            </thead>
            <tbody>
              {suppressions.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No addresses in suppression list.
                  </td>
                </tr>
              ) : (
                suppressions.map((s) => (
                  <tr key={s.email}>
                    <td>
                      <code style={{ fontSize: '0.8125rem' }}>{s.email}</code>
                    </td>
                    <td>
                      <span className="badge badge-invalid">{s.reason}</span>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
