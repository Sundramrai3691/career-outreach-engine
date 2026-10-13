import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  FileSpreadsheet,
  FileText,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Send,
} from 'lucide-react';

interface PrepareMailMergeModalProps {
  contactIds: string[];
  onClose: () => void;
  onNavigateToCampaign: (campaignId: string) => void;
}

export const PrepareMailMergeModal: React.FC<PrepareMailMergeModalProps> = ({
  contactIds,
  onClose,
  onNavigateToCampaign,
}) => {
  const [campaignName, setCampaignName] = useState(`Outreach - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [draftSubject, setDraftSubject] = useState('Reaching out regarding {{Role}} opportunities at {{Company}}');
  const [draftBody, setDraftBody] = useState(
    'Hi {{FirstName}},\n\nI hope your week is going well!\n\nI noticed your work leading engineering teams at {{Company}} and wanted to introduce myself regarding {{Role}} opportunities. I would love to connect briefly.\n\nBest regards,\n[Your Name]'
  );

  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [status, tpls] = await Promise.all([
        api.getGoogleStatus(),
        api.getTemplates(),
      ]);
      setGoogleStatus(status);
      setTemplates(tpls);

      const defaultTpl = tpls.find((t: any) => t.isDefault) || tpls[0];
      if (defaultTpl) {
        setSelectedTemplateId(defaultTpl.id);
        setDraftSubject(defaultTpl.subject);
        setDraftBody(defaultTpl.bodyText);
      }
    } catch (err) {
      console.error('Failed to load initial mail merge data', err);
    }
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      setDraftSubject(tpl.subject);
      setDraftBody(tpl.bodyText);
    }
  };

  const handleCreateFiles = async () => {
    setError(null);
    if (!campaignName.trim()) {
      setError('Campaign name is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await api.prepareGoogleMailMerge({
        campaignName: campaignName.trim(),
        contactIds,
        templateId: selectedTemplateId || undefined,
        draftSubject,
        draftBody,
      });

      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to prepare Google files');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '750px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Prepare Google Mail Merge</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              Create recipient Google Sheet & Docs template for {contactIds.length} selected contacts.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div
            style={{
              padding: '0.875rem 1rem',
              background: 'var(--color-danger-bg)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: '#fca5a5',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* If files successfully generated, show Handoff View */}
        {result ? (
          <div>
            <div
              style={{
                padding: '1.25rem',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: 'var(--radius-lg)',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6ee7b7', fontWeight: 600, marginBottom: '0.5rem' }}>
                <CheckCircle size={18} />
                <span>Google Files Generated Successfully!</span>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Exported {result.recipientCount} validated recipient contacts into your Google Drive.
              </p>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <a
                  href={result.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  <FileText size={16} /> Open Google Docs Template <ExternalLink size={14} />
                </a>

                <a
                  href={result.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  <FileSpreadsheet size={16} /> Open Google Sheet List <ExternalLink size={14} />
                </a>
              </div>
            </div>

            {/* Mailmeteor Step-by-Step Instructions */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.75rem', color: '#c7d2fe' }}>
                Mailmeteor / Google Docs Add-On Next Steps:
              </h4>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <li>{result.mailmeteorInstructions.step1}</li>
                <li>{result.mailmeteorInstructions.step2}</li>
                <li>{result.mailmeteorInstructions.step3}</li>
                <li>{result.mailmeteorInstructions.step4}</li>
              </ol>
            </div>

            {/* Alternative Action: Native Gmail */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Don't have Mailmeteor installed?
              </span>

              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onClose();
                  onNavigateToCampaign(result.campaignId);
                }}
              >
                <Send size={14} /> Use Native Gmail Sender Instead
              </button>
            </div>
          </div>
        ) : (
          /* Form View */
          <div>
            {!googleStatus?.isConnected && (
              <div
                style={{
                  padding: '0.875rem 1rem',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  color: '#fcd34d',
                  marginBottom: '1.25rem',
                  fontSize: '0.875rem',
                }}
              >
                <strong>Google Account not connected:</strong> Please connect your Google account in Settings first to generate Google Sheets & Docs.
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Campaign Name</label>
              <input
                type="text"
                className="form-input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Fall Tech Recruiting Outreach"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Select Saved Email Template (Optional)</label>
              <select
                className="form-select"
                value={selectedTemplateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
              >
                <option value="">Custom Draft</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Email Subject</label>
              <input
                type="text"
                className="form-input"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email Body (Supports {'{{FirstName}}, {{Company}}, {{Role}}'})</label>
              <textarea
                className="form-textarea"
                rows={6}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateFiles}
                disabled={isSubmitting || !googleStatus?.isConnected}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-pulse" />
                    <span>Creating Google Sheet & Doc...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={16} />
                    <span>Create Google Files</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
