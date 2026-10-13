import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import {
  FileSpreadsheet,
  FileText,
  ExternalLink,
  Send,
  Eye,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Shield,
} from 'lucide-react';

interface CampaignDetailsProps {
  campaignId: string;
  onBack: () => void;
}

export const CampaignDetails: React.FC<CampaignDetailsProps> = ({ campaignId, onBack }) => {
  const [campaign, setCampaign] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewRecipients, setPreviewRecipients] = useState<any[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());

  // Inspect specific preview modal
  const [activePreview, setActivePreview] = useState<any | null>(null);

  // Dispatch / Send Confirmation Modal
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [isDraftOnly, setIsDraftOnly] = useState(false);
  const [userConfirmed, setUserConfirmed] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  const loadCampaign = async () => {
    try {
      setLoading(true);
      const data = await api.getCampaign(campaignId);
      setCampaign(data);

      // Select all recipients who have not yet been sent
      const unsent = data.recipients
        ?.filter((r: any) => r.status !== 'sent')
        .map((r: any) => r.id);
      setSelectedRecipientIds(new Set(unsent || []));

      // Generate preview for recipients
      if (unsent && unsent.length > 0) {
        const previews = await api.previewCampaign(campaignId, {
          recipientIds: unsent,
        });
        setPreviewRecipients(previews);
      }
    } catch (err) {
      console.error('Failed to load campaign', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectRecipient = (id: string, isSent: boolean) => {
    if (isSent) return;
    const next = new Set(selectedRecipientIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRecipientIds(next);
  };

  const handleExecuteDispatch = async () => {
    setError(null);
    setDispatchResult(null);

    try {
      setDispatching(true);
      const res = await api.dispatchCampaign(campaignId, {
        recipientIds: Array.from(selectedRecipientIds),
        isDraftOnly,
      });
      setDispatchResult(res);
      loadCampaign();
    } catch (err: any) {
      setError(err.message || 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  if (loading && !campaign) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <Loader2 className="animate-pulse" size={32} color="#6366f1" style={{ margin: '0 auto 1rem' }} />
        <p>Loading campaign details...</p>
      </div>
    );
  }

  const recipients = campaign?.recipients || [];
  const sentCount = recipients.filter((r: any) => r.status === 'sent').length;
  const draftCount = recipients.filter((r: any) => r.status === 'draft_created').length;
  const failedCount = recipients.filter((r: any) => r.status === 'failed').length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button className="btn btn-secondary btn-sm" style={{ marginBottom: '0.5rem' }} onClick={onBack}>
            ← Back to Campaigns
          </button>
          <h2>{campaign.name}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Created {new Date(campaign.createdAt).toLocaleString()} • {recipients.length} Total Recipients
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {campaign.googleDocUrl && (
            <a href={campaign.googleDocUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              <FileText size={14} /> Docs Template <ExternalLink size={12} />
            </a>
          )}
          {campaign.googleSpreadsheetUrl && (
            <a href={campaign.googleSpreadsheetUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              <FileSpreadsheet size={14} /> Sheets List <ExternalLink size={12} />
            </a>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setDispatchResult(null);
              setUserConfirmed(false);
              setDispatchModalOpen(true);
            }}
            disabled={selectedRecipientIds.size === 0}
          >
            <Send size={14} /> Native Gmail Dispatch ({selectedRecipientIds.size})
          </button>
        </div>
      </div>

      {/* Stat Strip */}
      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Total Recipients</span>
            <span className="stat-value">{recipients.length}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Sent Successfully</span>
            <span className="stat-value" style={{ color: '#10b981' }}>{sentCount}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Drafts Created</span>
            <span className="stat-value" style={{ color: '#8b5cf6' }}>{draftCount}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Failed / Suppressed</span>
            <span className="stat-value" style={{ color: '#ef4444' }}>{failedCount}</span>
          </div>
        </div>
      </div>

      {/* Recipients Table with Live Personalized Inspection */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Campaign Recipients & Delivery Status</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadCampaign}>
            <RefreshCw size={14} /> Refresh Status
          </button>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>Select</th>
                <th>Recipient</th>
                <th>Company & Title</th>
                <th>Delivery Status</th>
                <th>Gmail Message / Draft ID</th>
                <th>Personalized Preview</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r: any) => {
                const isSent = r.status === 'sent';
                const isSelected = selectedRecipientIds.has(r.id);
                const preview = previewRecipients.find((p) => p.recipientId === r.id);

                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isSent}
                        onChange={() => toggleSelectRecipient(r.id, isSent)}
                        style={{ accentColor: '#6366f1', cursor: isSent ? 'not-allowed' : 'pointer' }}
                      />
                    </td>

                    <td>
                      <div style={{ fontWeight: 600 }}>{r.firstName || ''} {r.lastName || ''}</div>
                      <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {r.email}
                      </div>
                    </td>

                    <td>
                      <div>{r.companyName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.jobTitle || '—'}</div>
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          r.status === 'sent'
                            ? 'badge-verified'
                            : r.status === 'draft_created'
                            ? 'badge-unknown'
                            : r.status === 'failed'
                            ? 'badge-invalid'
                            : 'badge-unverified'
                        }`}
                      >
                        {r.status === 'sent' && <CheckCircle size={12} />}
                        {r.status === 'failed' && <XCircle size={12} />}
                        {r.status}
                      </span>
                      {r.errorMessage && (
                        <div style={{ fontSize: '0.6875rem', color: '#fca5a5', marginTop: '0.25rem' }}>
                          {r.errorMessage}
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {r.gmailMessageId ? `Msg: ${r.gmailMessageId}` : r.gmailDraftId ? `Draft: ${r.gmailDraftId}` : '—'}
                      </div>
                    </td>

                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActivePreview(preview || { email: r.email, subject: r.personalizedSubject || 'N/A', body: r.personalizedBody || 'N/A' })}
                      >
                        <Eye size={12} /> Inspect Rendered
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rendered Email Inspector Modal */}
      {activePreview && (
        <div className="modal-overlay" onClick={() => setActivePreview(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rendered Personalized Message</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setActivePreview(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">To:</label>
                <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#818cf8' }}>
                  {activePreview.email}
                </div>
              </div>

              <div>
                <label className="form-label">Subject:</label>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                  {activePreview.subject}
                </div>
              </div>

              <div>
                <label className="form-label">Body:</label>
                <div
                  style={{
                    padding: '1rem',
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: 'var(--radius-md)',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                  }}
                >
                  {activePreview.body}
                </div>
              </div>

              {activePreview.missingVariables?.length > 0 && (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    color: '#fcd34d',
                    fontSize: '0.8125rem',
                  }}
                >
                  <AlertTriangle size={14} style={{ display: 'inline', marginRight: '0.375rem' }} />
                  Warning: Missing variables: {activePreview.missingVariables.join(', ')}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActivePreview(null)}>
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Native Gmail Confirmation & Dispatch Modal */}
      {dispatchModalOpen && (
        <div className="modal-overlay" onClick={() => setDispatchModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={20} color="#6366f1" />
                <h3>Explicit Outreach Send Confirmation</h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setDispatchModalOpen(false)}>✕</button>
            </div>

            {error && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--color-danger-bg)',
                  borderRadius: 'var(--radius-md)',
                  color: '#fca5a5',
                  marginBottom: '1rem',
                  fontSize: '0.875rem',
                }}
              >
                {error}
              </div>
            )}

            {dispatchResult ? (
              <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
                <h4 style={{ color: '#6ee7b7', marginBottom: '0.5rem' }}>Dispatch Complete!</h4>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Processed: {dispatchResult.totalProcessed} | Sent: {dispatchResult.sentCount} | Drafts: {dispatchResult.draftsCount} | Skipped: {dispatchResult.skippedCount}
                </p>
                {dispatchResult.errors?.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#fca5a5' }}>
                    {dispatchResult.errors.map((e: any, idx: number) => (
                      <div key={idx}>• {e.email}: {e.reason}</div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDispatchModalOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                  This action connects directly to your authorized Gmail account to dispatch personalized professional emails individually.
                </p>

                <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    <span>Selected Recipients:</span>
                    <strong>{selectedRecipientIds.size} recipients</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    <span>Delivery Mode:</span>
                    <strong>{isDraftOnly ? 'Create Gmail Drafts Only' : 'Individual Discrete Send'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span>Addressing Safety:</span>
                    <span style={{ color: '#6ee7b7' }}>✓ 1 discrete message per recipient (No mass TO/BCC)</span>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={isDraftOnly}
                      onChange={(e) => setIsDraftOnly(e.target.checked)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    <span><strong>Draft Mode Only:</strong> Create editable Gmail drafts instead of sending directly.</span>
                  </label>
                </div>

                <div
                  style={{
                    padding: '0.875rem',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '1.25rem',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem', color: '#fca5a5' }}>
                    <input
                      type="checkbox"
                      checked={userConfirmed}
                      onChange={(e) => setUserConfirmed(e.target.checked)}
                      style={{ accentColor: '#ef4444', marginTop: '2px' }}
                    />
                    <span>
                      I have reviewed the personalized merge variables and acknowledge that these emails will be dispatched from my connected Google account.
                    </span>
                  </label>
                </div>

                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setDispatchModalOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleExecuteDispatch}
                    disabled={!userConfirmed || dispatching}
                  >
                    {dispatching ? (
                      <>
                        <Loader2 size={16} className="animate-pulse" />
                        <span>Dispatching via Gmail API...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Confirm and {isDraftOnly ? 'Create Drafts' : 'Send Emails'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
