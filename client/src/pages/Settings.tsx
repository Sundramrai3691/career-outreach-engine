import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  Key,
  ShieldCheck,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Sliders,
  Mail,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<any>(null);
  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [suppressions, setSuppressions] = useState<any[]>([]);

  // Form states for custom overrides
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [apolloKey, setApolloKey] = useState('');
  const [hunterKey, setHunterKey] = useState('');
  const [snovId, setSnovId] = useState('');
  const [snovSecret, setSnovSecret] = useState('');

  // Health testing states
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, any>>({});

  // Suppression input
  const [suppressEmailInput, setSuppressEmailInput] = useState('');
  const [suppressReason, setSuppressReason] = useState<'manual_block' | 'opted_out' | 'bounced'>('manual_block');

  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadAllSettings();
  }, []);

  const loadAllSettings = async () => {
    try {
      const [settingsRes, googleRes, suppRes] = await Promise.all([
        api.getSettings(),
        api.getGoogleStatus(),
        api.getSuppressions(),
      ]);

      setSettings(settingsRes);
      setGoogleStatus(googleRes);
      setSuppressions(suppRes);
    } catch (err: any) {
      console.error('Failed to load settings', err);
      setFeedbackMessage({ type: 'error', text: 'Failed to load settings: ' + err.message });
    }
  };

  const handleTestHealth = async (providerKey: string) => {
    try {
      setTestingKey(providerKey);
      const res = await api.checkHealth(providerKey);
      setHealthResults((prev) => ({ ...prev, [providerKey]: res }));
      await loadAllSettings();
    } catch (err: any) {
      setHealthResults((prev) => ({
        ...prev,
        [providerKey]: { healthy: false, message: err.message },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleSaveProvider = async (providerKey: string) => {
    try {
      let data: any = {};
      if (providerKey === 'apollo') {
        data.apiKey = apolloKey;
      } else if (providerKey === 'hunter') {
        data.apiKey = hunterKey;
      } else if (providerKey === 'snov') {
        data.apiKey = snovId;
        data.secret = snovSecret;
      }

      await api.updateProvider(providerKey, data);
      setFeedbackMessage({
        type: 'success',
        text: `${providerKey.toUpperCase()} settings saved successfully.`,
      });
      setTimeout(() => setFeedbackMessage(null), 3500);

      // Clear override inputs
      setApolloKey('');
      setHunterKey('');
      setSnovId('');
      setSnovSecret('');
      setOpenOverrides((prev) => ({ ...prev, [providerKey]: false }));
      loadAllSettings();
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: 'Save failed: ' + err.message });
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
    if (!confirm('Are you sure you want to disconnect Google? Stored tokens will be purged.')) return;
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

  const getProviderInfo = (key: string) => {
    return settings?.providers?.find((p: any) => p.key === key) || null;
  };

  const renderSourceBadge = (info: any) => {
    if (!info) return null;
    if (info.key === 'mock') {
      return (
        <span
          style={{
            fontSize: '0.6875rem',
            padding: '0.2rem 0.5rem',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#6ee7b7',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontWeight: 500,
          }}
        >
          <CheckCircle2 size={11} /> Simulator Active
        </span>
      );
    }

    if (info.source === 'environment') {
      return (
        <span
          style={{
            fontSize: '0.6875rem',
            padding: '0.2rem 0.5rem',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: '#7dd3fc',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontWeight: 500,
          }}
        >
          <ShieldCheck size={11} /> Configured via environment
        </span>
      );
    }

    if (info.source === 'database_override') {
      return (
        <span
          style={{
            fontSize: '0.6875rem',
            padding: '0.2rem 0.5rem',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.35)',
            color: '#d8b4fe',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontWeight: 500,
          }}
        >
          <Key size={11} /> Custom DB override
        </span>
      );
    }

    return (
      <span
        style={{
          fontSize: '0.6875rem',
          padding: '0.2rem 0.5rem',
          borderRadius: 'var(--radius-full)',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          color: '#fca5a5',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          fontWeight: 500,
        }}
      >
        <AlertTriangle size={11} /> Missing credentials
      </span>
    );
  };

  const renderHealthNotice = (key: string) => {
    const res = healthResults[key];
    const info = getProviderInfo(key);
    const message = res ? res.message : info?.lastErrorMessage;
    const isHealthy = res ? res.healthy : info?.healthStatus === 'healthy';

    if (!res && !info?.lastErrorMessage && !info?.lastHealthCheck) return null;

    if (isHealthy) {
      return (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            color: '#6ee7b7',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
          <span>{message || 'Connected successfully and operational.'}</span>
        </div>
      );
    }

    // Check for distinct authenticated but restricted state
    const isAuthenticated = res?.authenticated ?? (message && (message.includes('authenticated') || message.includes('Free plan') || message.includes('restricted_account')));
    const canSearch = res?.canSearch ?? false;
    const isPlanRestricted = !canSearch && (res?.status === 'authenticated_restricted' || res?.status === 'account_restricted' || (message && (message.includes('Free plan') || message.includes('restricted') || message.includes('429') || message.includes('403'))));

    return (
      <div
        style={{
          marginTop: '0.75rem',
          padding: '0.75rem',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          background: isPlanRestricted ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${isPlanRestricted ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          color: isPlanRestricted ? '#fde68a' : '#fca5a5',
        }}
      >
        {/* Status indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {isAuthenticated ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7', fontWeight: 600, fontSize: '0.7rem' }}>
              <CheckCircle2 size={11} /> API Key: Authenticated
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontWeight: 600, fontSize: '0.7rem' }}>
              <XCircle size={11} /> Authentication Failed
            </span>
          )}

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: isPlanRestricted ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: isPlanRestricted ? '#fde68a' : '#fca5a5', fontWeight: 600, fontSize: '0.7rem' }}>
            <AlertTriangle size={11} /> {isPlanRestricted ? 'Discovery Search: Inaccessible / Restricted' : 'Service Offline'}
          </span>
        </div>

        <div style={{ lineHeight: 1.45, marginBottom: res?.nextAction ? '0.5rem' : 0 }}>
          {res?.restrictionReason || message}
        </div>

        {res?.nextAction && (
          <div style={{ paddingTop: '0.5rem', borderTop: '1px solid rgba(245, 158, 11, 0.2)', color: '#cbd5e1', fontSize: '0.7rem' }}>
            <strong style={{ color: '#fbbf24' }}>Next step: </strong>
            {res.nextAction}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* Page Title */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h2>System Settings & Integrations</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Provider credential status, non-destructive connection health checks, and Google Workspace integration.
        </p>
      </div>

      {feedbackMessage && (
        <div
          style={{
            padding: '0.75rem 1.25rem',
            background: feedbackMessage.type === 'success' ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
            border: `1px solid ${feedbackMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            borderRadius: 'var(--radius-md)',
            color: feedbackMessage.type === 'success' ? '#6ee7b7' : '#fca5a5',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
          }}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Provider Credential Cards */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Key size={18} color="#818cf8" />
          <h3 style={{ fontSize: '1.125rem' }}>Contact Discovery Providers</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '1.25rem' }}>
          {/* Apollo Provider Card */}
          {(() => {
            const apollo = getProviderInfo('apollo');
            const isTesting = testingKey === 'apollo';
            const isOverrideOpen = openOverrides['apollo'];

            return (
              <div
                className="card"
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid var(--border-color)',
                  padding: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>Apollo.io</div>
                    {renderSourceBadge(apollo)}
                  </div>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTestHealth('apollo')}
                    disabled={isTesting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    {isTesting ? <Loader2 size={13} className="animate-pulse" /> : <Activity size={13} />}
                    <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Primary People Search & verified email resolution. Configured via <code>APOLLO_API_KEY</code>.
                </p>

                {renderHealthNotice('apollo')}

                {/* Optional Override Section */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button
                    type="button"
                    onClick={() => setOpenOverrides((p) => ({ ...p, apollo: !p.apollo }))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: 0,
                    }}
                  >
                    <span>{isOverrideOpen ? 'Hide custom override' : 'Custom key override (optional)'}</span>
                    {isOverrideOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {isOverrideOpen && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                        <input
                          type="password"
                          className="form-input"
                          value={apolloKey}
                          onChange={(e) => setApolloKey(e.target.value)}
                          placeholder="Paste custom Apollo key (or leave empty to clear override)..."
                          style={{ fontSize: '0.8125rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveProvider('apollo')}>
                          Save Override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Hunter Provider Card */}
          {(() => {
            const hunter = getProviderInfo('hunter');
            const isTesting = testingKey === 'hunter';
            const isOverrideOpen = openOverrides['hunter'];

            return (
              <div
                className="card"
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid var(--border-color)',
                  padding: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>Hunter.io</div>
                    {renderSourceBadge(hunter)}
                  </div>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTestHealth('hunter')}
                    disabled={isTesting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    {isTesting ? <Loader2 size={13} className="animate-pulse" /> : <Activity size={13} />}
                    <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Domain Search, Email Finder fallback & verification. Configured via <code>HUNTER_API_KEY</code>.
                </p>

                {renderHealthNotice('hunter')}

                {/* Optional Override Section */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button
                    type="button"
                    onClick={() => setOpenOverrides((p) => ({ ...p, hunter: !p.hunter }))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: 0,
                    }}
                  >
                    <span>{isOverrideOpen ? 'Hide custom override' : 'Custom key override (optional)'}</span>
                    {isOverrideOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {isOverrideOpen && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                        <input
                          type="password"
                          className="form-input"
                          value={hunterKey}
                          onChange={(e) => setHunterKey(e.target.value)}
                          placeholder="Paste custom Hunter key (or leave empty to clear override)..."
                          style={{ fontSize: '0.8125rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveProvider('hunter')}>
                          Save Override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Snov.io Provider Card */}
          {(() => {
            const snov = getProviderInfo('snov');
            const isTesting = testingKey === 'snov';
            const isOverrideOpen = openOverrides['snov'];

            return (
              <div
                className="card"
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid var(--border-color)',
                  padding: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>Snov.io</div>
                    {renderSourceBadge(snov)}
                  </div>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTestHealth('snov')}
                    disabled={isTesting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    {isTesting ? <Loader2 size={13} className="animate-pulse" /> : <Activity size={13} />}
                    <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  OAuth 2.0 Domain Search fallback. Configured via <code>SNOV_CLIENT_ID</code>.
                </p>

                {renderHealthNotice('snov')}

                {/* Optional Override Section */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button
                    type="button"
                    onClick={() => setOpenOverrides((p) => ({ ...p, snov: !p.snov }))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: 0,
                    }}
                  >
                    <span>{isOverrideOpen ? 'Hide custom override' : 'Custom key override (optional)'}</span>
                    {isOverrideOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {isOverrideOpen && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          value={snovId}
                          onChange={(e) => setSnovId(e.target.value)}
                          placeholder="Client ID..."
                          style={{ fontSize: '0.8125rem', marginBottom: '0.375rem' }}
                        />
                        <input
                          type="password"
                          className="form-input"
                          value={snovSecret}
                          onChange={(e) => setSnovSecret(e.target.value)}
                          placeholder="Client Secret..."
                          style={{ fontSize: '0.8125rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveProvider('snov')}>
                          Save Override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Mock Simulator Card */}
          {(() => {
            const isTesting = testingKey === 'mock';

            return (
              <div
                className="card"
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid var(--border-color)',
                  padding: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>Mock Simulator</div>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--radius-full)',
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        color: '#6ee7b7',
                        fontWeight: 500,
                      }}
                    >
                      Always Ready
                    </span>
                  </div>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTestHealth('mock')}
                    disabled={isTesting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    {isTesting ? <Loader2 size={13} className="animate-pulse" /> : <Activity size={13} />}
                    <span>Test Connection</span>
                  </button>
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Zero-quota test provider for end-to-end demonstrations without consuming external API credits.
                </p>

                {renderHealthNotice('mock')}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Google Workspace Connection Card */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Sliders size={18} color="#10b981" />
          <h3 style={{ fontSize: '1.125rem' }}>Google Workspace Connection</h3>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {googleStatus?.isConnected
                  ? `Connected as ${googleStatus.account?.email}`
                  : 'Google Account Disconnected'}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
                Used to create mail-merge sheets in Google Sheets, documents in Google Docs, and send emails via Gmail.
              </p>
            </div>

            <div>
              {googleStatus?.isConnected ? (
                <button className="btn btn-danger btn-sm" onClick={handleDisconnectGoogle}>
                  Disconnect Account
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleConnectGoogle}
                  disabled={!googleStatus?.isConfigured}
                >
                  Connect Google Account
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Suppression Rules */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Mail size={18} color="#f59e0b" />
          <h3 style={{ fontSize: '1.125rem' }}>Global Suppression List</h3>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
            Emails in this list will never be contacted in any campaign to prevent spam reports and respect opt-outs.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <input
              type="email"
              className="form-input"
              value={suppressEmailInput}
              onChange={(e) => setSuppressEmailInput(e.target.value)}
              placeholder="lead@company.com"
              style={{ flex: 1, minWidth: '220px' }}
            />
            <select
              className="form-input"
              value={suppressReason}
              onChange={(e) => setSuppressReason(e.target.value as any)}
              style={{ width: '160px' }}
            >
              <option value="manual_block">Manual Block</option>
              <option value="opted_out">Opted Out</option>
              <option value="bounced">Bounced</option>
            </select>
            <button className="btn btn-secondary" onClick={handleAddSuppression}>
              <Plus size={14} /> Add Email
            </button>
          </div>

          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            {suppressions.length} {suppressions.length === 1 ? 'suppressed email' : 'suppressed emails'} active in system.
          </div>
        </div>
      </div>
    </div>
  );
};
