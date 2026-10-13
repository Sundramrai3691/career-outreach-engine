import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  StopCircle,
  Users,
  Coins,
  Building,
} from 'lucide-react';

interface DiscoveryRunProgressProps {
  runId: string;
  onNavigateToContacts: () => void;
}

export const DiscoveryRunProgress: React.FC<DiscoveryRunProgressProps> = ({
  runId,
  onNavigateToContacts,
}) => {
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let interval: any;

    const fetchRunProgress = async () => {
      try {
        const data = await api.getDiscoveryRun(runId);
        setRun(data);
        setLoading(false);

        // If completed or failed, slow down or stop polling
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Failed to poll discovery run progress', err);
      }
    };

    fetchRunProgress();
    interval = setInterval(fetchRunProgress, 1500);

    return () => clearInterval(interval);
  }, [runId]);

  const handleCancel = async () => {
    try {
      setCancelling(true);
      await api.cancelDiscoveryRun(runId);
    } catch (err) {
      console.error('Failed to cancel run', err);
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !run) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <Loader2 className="animate-pulse" size={36} color="#6366f1" style={{ margin: '0 auto 1rem' }} />
        <p>Connecting to discovery engine...</p>
      </div>
    );
  }

  const isFinished = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';
  const progressPercent = run?.totalCompanies > 0 ? Math.round((run.processedCompanies / run.totalCompanies) * 100) : 0;

  return (
    <div>
      {/* Run Header */}
      <div
        className="card"
        style={{
          marginBottom: '2rem',
          background: 'linear-gradient(135deg, rgba(22, 29, 44, 0.9) 0%, rgba(30, 41, 59, 0.7) 100%)',
          borderColor: 'rgba(99, 102, 241, 0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <h2>Discovery Run</h2>
              <span
                className={`badge ${
                  run.status === 'completed'
                    ? 'badge-verified'
                    : run.status === 'running'
                    ? 'badge-accept_all'
                    : 'badge-invalid'
                }`}
              >
                {run.status === 'running' && <Loader2 size={12} className="animate-pulse" />}
                {run.status}
              </span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Started {new Date(run.startedAt).toLocaleTimeString()} • Run ID: <code>{run.id.slice(0, 8)}</code>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {!isFinished && (
              <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={cancelling}>
                <StopCircle size={14} /> {cancelling ? 'Cancelling...' : 'Cancel Run'}
              </button>
            )}

            {isFinished && (
              <button className="btn btn-primary" onClick={onNavigateToContacts}>
                <Users size={16} /> View Contacts ({run.contactsFound}) <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Processed {run.processedCompanies} of {run.totalCompanies} companies
            </span>
            <span style={{ fontWeight: 600 }}>{progressPercent}%</span>
          </div>

          <div
            style={{
              height: '8px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: 'var(--brand-gradient)',
                borderRadius: 'var(--radius-full)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>

        {/* Summary Chips */}
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <Building size={16} color="#6366f1" />
            <span>{run.totalCompanies} Target Companies</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <Users size={16} color="#10b981" />
            <span><strong>{run.contactsFound}</strong> Discovered Contacts</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <Coins size={16} color="#f59e0b" />
            <span>{run.creditsConsumed} Credits Spent</span>
          </div>
        </div>
      </div>

      {/* Per-Company Live Pipeline Table */}
      <div className="card">
        <h3 style={{ fontSize: '1.125rem', marginBottom: '1.25rem' }}>Target Pipeline Progress</h3>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '25%' }}>Company</th>
                <th style={{ width: '25%' }}>Target Roles</th>
                <th style={{ width: '20%' }}>Current Stage</th>
                <th style={{ width: '15%' }}>Sources Tried</th>
                <th style={{ width: '15%', textAlign: 'right' }}>Contacts Found</th>
              </tr>
            </thead>
            <tbody>
              {run.items?.map((item: any) => {
                const roles: string[] = JSON.parse(item.targetRolesJson || '[]');
                const providersTried: string[] = JSON.parse(item.providersTriedJson || '[]');

                const getStatusBadge = () => {
                  switch (item.status) {
                    case 'completed':
                      return <span className="badge badge-verified"><CheckCircle size={12} /> Completed</span>;
                    case 'failed':
                      return <span className="badge badge-invalid"><XCircle size={12} /> Failed</span>;
                    case 'waiting':
                      return <span className="badge badge-unverified"><Clock size={12} /> Waiting</span>;
                    case 'searching_contacts':
                      return <span className="badge badge-accept_all"><Loader2 size={12} className="animate-pulse" /> Searching Apollo</span>;
                    case 'finding_emails':
                      return <span className="badge badge-accept_all"><Loader2 size={12} className="animate-pulse" /> Finding Emails</span>;
                    case 'verifying':
                      return <span className="badge badge-accept_all"><Loader2 size={12} className="animate-pulse" /> Verifying</span>;
                    default:
                      return <span className="badge badge-unverified">{item.status}</span>;
                  }
                };

                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.companyName}</div>
                      {item.companyDomain && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.companyDomain}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {roles.join(', ') || 'Default roles'}
                      </div>
                    </td>
                    <td>{getStatusBadge()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {providersTried.map((p) => (
                          <span
                            key={p}
                            style={{
                              fontSize: '0.6875rem',
                              padding: '0.125rem 0.375rem',
                              background: 'rgba(255, 255, 255, 0.06)',
                              borderRadius: 'var(--radius-sm)',
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {item.contactsFound}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
