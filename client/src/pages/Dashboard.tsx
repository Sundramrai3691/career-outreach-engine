import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import {
  Users,
  CheckCircle2,
  Mail,
  Send,
  ArrowRight,
  Play,
  Clock,
  Sparkles,
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (tab: string, runId?: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<any>(null);
  const [providerSettings, setProviderSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsRes, settingsRes] = await Promise.all([
        api.getDashboardStats(),
        api.getSettings(),
      ]);
      setStats(statsRes);
      setProviderSettings(settingsRes.providers || []);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Hero Welcome Banner */}
      <div
        className="card"
        style={{
          marginBottom: '2rem',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 50%, rgba(22, 29, 44, 0.7) 100%)',
          borderColor: 'rgba(99, 102, 241, 0.25)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span className="badge badge-verified">
              <Sparkles size={12} /> Personal Outreach Pipeline
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>
            Automated Contact Discovery & Mail Merge
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '650px', fontSize: '0.9375rem' }}>
            Enter target companies and roles once. Our multi-provider waterfall discovers and verifies direct professional emails, generates formatted Google Sheets & Docs templates, and sends personalized emails via Gmail.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-primary" onClick={() => onNavigate('new-discovery')}>
            <Play size={16} /> Start Discovery
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('contacts')}>
            View Contacts <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#6366f1', background: 'rgba(99, 102, 241, 0.15)' }}>
            <Users size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Discovered Contacts</span>
            <span className="stat-value">{loading ? '...' : stats?.totalContacts ?? 0}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.15)' }}>
            <CheckCircle2 size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Verified Deliverable</span>
            <span className="stat-value">{loading ? '...' : stats?.verifiedContacts ?? 0}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.15)' }}>
            <Mail size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Campaigns Prepared</span>
            <span className="stat-value">{loading ? '...' : stats?.totalCampaigns ?? 0}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#0ea5e9', background: 'rgba(14, 165, 233, 0.15)' }}>
            <Send size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Personalized Outreaches Sent</span>
            <span className="stat-value">{loading ? '...' : stats?.sentRecipients ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Grid: Provider Status & Recent Discovery Runs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {/* Provider Integration Health */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>Provider Waterfall Status</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('settings')}>
              Configure Settings
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {providerSettings.map((p) => (
              <div
                key={p.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'rgba(15, 21, 33, 0.5)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {p.key === 'apollo' ? 'Apollo.io' : p.key === 'hunter' ? 'Hunter.io' : p.key === 'snov' ? 'Snov.io' : 'Mock Simulator'}
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Priority {p.priority}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {p.hasKey ? 'Credentials configured' : 'Using environment / demo key'} • {p.creditsUsed} credits used
                  </div>
                </div>

                <span
                  className={`badge ${
                    p.healthStatus === 'healthy'
                      ? 'badge-verified'
                      : p.healthStatus === 'error'
                      ? 'badge-invalid'
                      : 'badge-unverified'
                  }`}
                >
                  {p.healthStatus}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Discovery Runs */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>Recent Discovery Runs</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('discovery-runs')}>
              All Runs
            </button>
          </div>

          {!stats?.recentRuns || stats.recentRuns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-secondary)' }}>
              <Clock size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
              <p>No discovery runs executed yet.</p>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: '1rem' }}
                onClick={() => onNavigate('new-discovery')}
              >
                Start Your First Run
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {stats.recentRuns.map((r: any) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: 'rgba(15, 21, 33, 0.5)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                  onClick={() => onNavigate('discovery-runs', r.id)}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {r.totalCompanies} Targets • {r.contactsFound} Contacts Found
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {new Date(r.startedAt).toLocaleString()} • {r.creditsConsumed} credits spent
                    </div>
                  </div>

                  <span
                    className={`badge ${
                      r.status === 'completed'
                        ? 'badge-verified'
                        : r.status === 'running'
                        ? 'badge-accept_all'
                        : 'badge-unverified'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
