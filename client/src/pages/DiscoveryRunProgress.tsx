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
  AlertCircle,
  Briefcase,
  ExternalLink,
} from 'lucide-react';

interface DiscoveryRunProgressProps {
  runId: string;
  onNavigateToContacts: () => void;
  onNavigateToSettings?: () => void;
  onNavigateToNewDiscovery?: () => void;
}

export const DiscoveryRunProgress: React.FC<DiscoveryRunProgressProps> = ({
  runId,
  onNavigateToContacts,
  onNavigateToSettings,
  onNavigateToNewDiscovery,
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
        if (
          data.status === 'completed' ||
          data.status === 'completed_with_results' ||
          data.status === 'completed_no_results' ||
          data.status === 'completed_jobs_only' ||
          data.status === 'partially_completed' ||
          data.status === 'blocked_by_provider' ||
          data.status === 'waiting_for_credentials' ||
          data.status === 'failed' ||
          data.status === 'cancelled'
        ) {
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

  const isFinished =
    run?.status === 'completed' ||
    run?.status === 'completed_with_results' ||
    run?.status === 'completed_no_results' ||
    run?.status === 'completed_jobs_only' ||
    run?.status === 'partially_completed' ||
    run?.status === 'blocked_by_provider' ||
    run?.status === 'waiting_for_credentials' ||
    run?.status === 'failed' ||
    run?.status === 'cancelled';
  const progressPercent = run?.totalCompanies > 0 ? Math.round((run.processedCompanies / run.totalCompanies) * 100) : 0;

  const getRunStatusBadge = () => {
    switch (run?.status) {
      case 'completed':
      case 'completed_with_results':
        return <span className="badge badge-verified"><CheckCircle size={12} /> Completed ({run.contactsFound})</span>;
      case 'partially_completed':
        return <span className="badge badge-accept_all"><CheckCircle size={12} /> Partially Completed ({run.contactsFound})</span>;
      case 'blocked_by_provider':
        return <span className="badge badge-invalid"><AlertCircle size={12} /> Blocked by Provider</span>;
      case 'completed_no_results':
        return <span className="badge badge-accept_all"><AlertCircle size={12} /> Completed (0 Results)</span>;
      case 'completed_jobs_only':
        return <span className="badge badge-verified"><CheckCircle size={12} /> Jobs Found; Contacts Not Run</span>;
      case 'waiting_for_credentials':
        return <span className="badge badge-invalid"><Clock size={12} /> Credentials Missing</span>;
      case 'failed':
        return <span className="badge badge-invalid"><XCircle size={12} /> Failed</span>;
      case 'cancelled':
        return <span className="badge badge-unverified"><StopCircle size={12} /> Cancelled</span>;
      default:
        return (
          <span className="badge badge-accept_all">
            <Loader2 size={12} className="animate-pulse" /> Running
          </span>
        );
    }
  };

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
              {getRunStatusBadge()}
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

            {isFinished && run.contactsFound > 0 && (
              <button className="btn btn-primary" onClick={onNavigateToContacts}>
                <Users size={16} /> View Contacts ({run.contactsFound}) <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Actionable Error Banner if provider errors occurred */}
        {run.errorMessage && (
          <div
            style={{
              padding: '1rem 1.25rem',
              background: run.contactsFound > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${run.contactsFound > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-md)',
              marginTop: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              fontSize: '0.875rem',
              color: run.contactsFound > 0 ? '#fde68a' : '#fca5a5',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                  {run.status === 'blocked_by_provider'
                    ? 'Provider Access Restricted'
                    : run.status === 'waiting_for_credentials'
                    ? 'Provider Credentials Required'
                    : 'Provider Diagnostics'}
                </div>
                <div style={{ lineHeight: 1.4 }}>{run.errorMessage}</div>
              </div>
            </div>

            {/* Actionable Fallback Options */}
            {(run.status === 'blocked_by_provider' || run.status === 'waiting_for_credentials' || (isFinished && run.contactsFound === 0)) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  paddingTop: '0.75rem',
                  borderTop: `1px solid ${run.contactsFound > 0 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>Actionable Alternatives:</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onNavigateToContacts}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                >
                  Import Contacts from CSV
                </button>
                {onNavigateToSettings && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onNavigateToSettings}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    Review Settings & Plans
                  </button>
                )}
                {onNavigateToNewDiscovery && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onNavigateToNewDiscovery}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    Test with Mock Simulator
                  </button>
                )}
              </div>
            )}
          </div>
        )}

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
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.75rem' }}>
          Job postings are discovered independently. A posting is not evidence of a hiring manager's identity or email.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Briefcase size={18} color="#10b981" /> Matched Job Openings
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '1rem' }}>
          Public postings matched against the selected roles and locations. Open each original posting to confirm it is still active.
        </p>
        {run.items?.some((item: any) => item.jobDiscoveries?.length > 0) ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {run.items.flatMap((item: any) =>
              (item.jobDiscoveries || []).map((discovery: any) => ({
                ...discovery,
                companyName: item.companyName,
              }))
            ).map((discovery: any) => {
              const job = discovery.jobOpening;
              return (
                <article key={discovery.id} style={{ padding: '0.875rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{job.originalTitle}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                        {discovery.companyName}{job.originalLocation ? ` · ${job.originalLocation}` : ''}
                        {` · Match: ${discovery.matchedRole}`}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        Source: {job.sourceProvider} · checked {new Date(job.lastCheckedAt).toLocaleString()}
                        {' · '}
                        <a href={job.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Source record</a>
                      </div>
                    </div>
                    <a href={job.jobUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      Original posting <ExternalLink size={13} />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {run.status === 'running' && run.items?.some((item: any) =>
              item.jobDiscoveryStatus === 'pending' || item.jobDiscoveryStatus === 'searching'
            )
              ? 'Searching public job sources…'
              : 'No matching public postings have been saved for this run.'}
          </div>
        )}
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
                let providersTried: any[] = [];
                try {
                  providersTried = JSON.parse(item.providersTriedJson || '[]');
                } catch {
                  providersTried = [];
                }

                const getStatusBadge = () => {
                  switch (item.status) {
                    case 'completed':
                      return (
                        <span className={`badge ${item.contactsFound > 0 ? 'badge-verified' : 'badge-unverified'}`}>
                          {item.contactsFound > 0 ? <CheckCircle size={12} /> : null}
                          {item.contactsFound > 0 ? 'Completed' : 'No Contacts'}
                        </span>
                      );
                    case 'failed':
                      return <span className="badge badge-invalid"><XCircle size={12} /> Failed</span>;
                    case 'waiting':
                      return <span className="badge badge-unverified"><Clock size={12} /> Waiting</span>;
                    case 'searching_contacts':
                      return <span className="badge badge-accept_all"><Loader2 size={12} className="animate-pulse" /> Searching</span>;
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
                      {item.errorMessage && (
                        <div style={{ fontSize: '0.75rem', color: '#fca5a5', marginTop: '0.25rem', lineHeight: 1.3 }}>
                          {item.errorMessage}
                        </div>
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
                        {providersTried.map((entry: any, idx: number) => {
                          const pName = typeof entry === 'string' ? entry : entry.provider;
                          const pStatus = typeof entry === 'string' ? 'unknown' : entry.status;
                          const pReason = typeof entry === 'string' ? '' : entry.reason;

                          let bg = 'rgba(255, 255, 255, 0.06)';
                          let color = 'var(--text-secondary)';
                          let border = 'transparent';

                          if (pStatus === 'found') {
                            bg = 'rgba(16, 185, 129, 0.15)';
                            color = '#6ee7b7';
                            border = 'rgba(16, 185, 129, 0.3)';
                          } else if (pStatus === 'error') {
                            bg = 'rgba(239, 68, 68, 0.15)';
                            color = '#fca5a5';
                            border = 'rgba(239, 68, 68, 0.3)';
                          } else if (pStatus === 'skipped') {
                            bg = 'rgba(255, 255, 255, 0.03)';
                            color = 'var(--text-muted)';
                          }

                          return (
                            <span
                              key={`${pName}-${idx}`}
                              title={pReason ? `${pName}: ${pReason}` : pName}
                              style={{
                                fontSize: '0.6875rem',
                                padding: '0.125rem 0.375rem',
                                background: bg,
                                border: `1px solid ${border}`,
                                color,
                                borderRadius: 'var(--radius-sm)',
                                textTransform: 'uppercase',
                                fontWeight: 600,
                                cursor: pReason ? 'help' : 'default',
                              }}
                            >
                              {pName}
                            </span>
                          );
                        })}
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
