import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  Plus,
  Trash2,
  FileSpreadsheet,
  Clipboard,
  Play,
  AlertCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  roles: string;
  location: string;
  jobUrl: string;
  notes: string;
}

interface NewDiscoveryProps {
  onRunStarted: (runId: string) => void;
}

export const NewDiscovery: React.FC<NewDiscoveryProps> = ({ onRunStarted }) => {
  const [globalRoles, setGlobalRoles] = useState('Technical Recruiter, University Recruiter, Engineering Manager');
  const [rows, setRows] = useState<CompanyRow[]>([
    {
      id: '1',
      name: 'Stripe',
      domain: 'stripe.com',
      roles: '',
      location: 'San Francisco, CA',
      jobUrl: 'https://stripe.com/jobs',
      notes: '',
    },
    {
      id: '2',
      name: 'Datadog',
      domain: 'datadoghq.com',
      roles: '',
      location: 'New York, NY',
      jobUrl: '',
      notes: '',
    },
    {
      id: '3',
      name: 'Vercel',
      domain: 'vercel.com',
      roles: 'Recruiter, Talent Partner',
      location: '',
      jobUrl: '',
      notes: '',
    },
  ]);

  // Waterfall & Budget settings
  const [maxBudget, setMaxBudget] = useState(25);
  const [allowEnrichment, setAllowEnrichment] = useState(false);
  const [freeFirstMode, setFreeFirstMode] = useState(true);
  const [verifyEmails, setVerifyEmails] = useState(true);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Live Cost Estimate
  const [estimate, setEstimate] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recalculate cost estimate when parameters change
  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const est = await api.estimateDiscovery({
          companiesCount: rows.length,
          rolesCount: globalRoles.split(',').length,
          allowEnrichment,
          freeFirstMode,
          verifyEmails,
          maxBudget,
        });
        setEstimate(est);
      } catch (err) {
        console.error('Failed to estimate run cost', err);
      }
    };
    fetchEstimate();
  }, [rows.length, globalRoles, allowEnrichment, freeFirstMode, verifyEmails, maxBudget]);

  const addRow = () => {
    const newId = String(Date.now());
    setRows([
      ...rows,
      {
        id: newId,
        name: '',
        domain: '',
        roles: '',
        location: '',
        jobUrl: '',
        notes: '',
      },
    ]);
  };

  const removeRow = (id: string) => {
    if (rows.length === 1) return;
    setRows(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof CompanyRow, value: string) => {
    setRows(
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const handleBulkPaste = () => {
    if (!pasteText.trim()) return;

    const lines = pasteText.split('\n');
    const newRows: CompanyRow[] = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Handle tab-separated or comma-separated
      const parts = trimmed.includes('\t') ? trimmed.split('\t') : trimmed.split(',');
      const name = parts[0]?.trim() || '';
      const domain = parts[1]?.trim() || '';
      const roles = parts[2]?.trim() || '';

      if (name) {
        newRows.push({
          id: `${Date.now()}-${index}`,
          name,
          domain,
          roles,
          location: '',
          jobUrl: '',
          notes: '',
        });
      }
    });

    if (newRows.length > 0) {
      setRows(newRows);
      setPasteModalOpen(false);
      setPasteText('');
    }
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const lines = content.split('\n');
      const parsedRows: CompanyRow[] = [];

      lines.slice(1).forEach((line, index) => {
        const parts = line.split(',');
        if (parts[0] && parts[0].trim()) {
          parsedRows.push({
            id: `${Date.now()}-${index}`,
            name: parts[0].trim(),
            domain: parts[1]?.trim() || '',
            roles: parts[2]?.trim() || '',
            location: parts[3]?.trim() || '',
            jobUrl: parts[4]?.trim() || '',
            notes: '',
          });
        }
      });

      if (parsedRows.length > 0) {
        setRows(parsedRows);
      }
    };
    reader.readAsText(file);
  };

  const handleStartDiscovery = async () => {
    setError(null);

    // Validate inputs
    const invalidRow = rows.find((r) => !r.name.trim());
    if (invalidRow) {
      setError('Please provide a company name for every row.');
      return;
    }

    const defaultRolesList = globalRoles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    if (defaultRolesList.length === 0) {
      setError('At least one global target role is required.');
      return;
    }

    const companiesPayload = rows.map((r) => {
      const companyRoles = r.roles
        ? r.roles
            .split(',')
            .map((role) => role.trim())
            .filter(Boolean)
        : defaultRolesList;

      return {
        name: r.name.trim(),
        domain: r.domain ? r.domain.trim() : undefined,
        targetRoles: companyRoles.length > 0 ? companyRoles : defaultRolesList,
        location: r.location ? r.location.trim() : undefined,
        jobUrl: r.jobUrl ? r.jobUrl.trim() : undefined,
        notes: r.notes ? r.notes.trim() : undefined,
      };
    });

    try {
      setIsSubmitting(true);
      const res = await api.startDiscovery({
        companies: companiesPayload,
        config: {
          maxBudget,
          allowEnrichment,
          freeFirstMode,
          verifyEmails,
        },
      });

      if (res.runId) {
        onRunStarted(res.runId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start discovery run');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Target Discovery Setup</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Enter your target companies and roles. The waterfall will search Apollo, Hunter, and verified sources.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setPasteModalOpen(true)}>
            <Clipboard size={14} /> Paste Multiple
          </button>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
            <FileSpreadsheet size={14} /> Import CSV
            <input type="file" accept=".csv" onChange={handleCsvImport} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            background: 'var(--color-danger-bg)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#fca5a5',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Global Target Roles Setting */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Default Target Roles (applied to all companies unless overridden)</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Comma separated</span>
          </label>
          <input
            type="text"
            className="form-input"
            value={globalRoles}
            onChange={(e) => setGlobalRoles(e.target.value)}
            placeholder="e.g. Technical Recruiter, University Recruiter, Engineering Manager"
          />
        </div>
      </div>

      {/* Dynamic Target Companies Table */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem' }}>Target Companies ({rows.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={addRow}>
            <Plus size={14} /> Add Company
          </button>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Company Name *</th>
                <th style={{ width: '18%' }}>Domain</th>
                <th style={{ width: '25%' }}>Override Roles</th>
                <th style={{ width: '15%' }}>Location</th>
                <th style={{ width: '15%' }}>Job URL</th>
                <th style={{ width: '5%' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={row.name}
                      onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                      placeholder="e.g. Stripe"
                      style={{ padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={row.domain}
                      onChange={(e) => updateRow(row.id, 'domain', e.target.value)}
                      placeholder="stripe.com"
                      style={{ padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={row.roles}
                      onChange={(e) => updateRow(row.id, 'roles', e.target.value)}
                      placeholder="Uses global default"
                      style={{ padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={row.location}
                      onChange={(e) => updateRow(row.id, 'location', e.target.value)}
                      placeholder="e.g. Remote"
                      style={{ padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={row.jobUrl}
                      onChange={(e) => updateRow(row.id, 'jobUrl', e.target.value)}
                      placeholder="https://..."
                      style={{ padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      title="Remove row"
                      style={{ padding: '0.375rem', borderRadius: 'var(--radius-sm)' }}
                    >
                      <Trash2 size={14} color="#f87171" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credit & Budget Protection Config */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} color="#6366f1" /> Waterfall & Credit Budget Protection
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
          <div>
            <label className="form-label">Run Credit Spending Cap</label>
            <input
              type="number"
              className="form-input"
              value={maxBudget}
              onChange={(e) => setMaxBudget(Number(e.target.value))}
              min={0}
              max={500}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Discovery halts immediately if spending reaches this cap.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={freeFirstMode}
                onChange={(e) => setFreeFirstMode(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
              />
              <span><strong>Free-first mode</strong> (prioritizes 0-credit Apollo & free searches)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={allowEnrichment}
                onChange={(e) => setAllowEnrichment(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
              />
              <span><strong>Permit paid enrichment</strong> (allows Apollo bulk match when needed)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={verifyEmails}
                onChange={(e) => setVerifyEmails(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
              />
              <span><strong>Perform email verification</strong> (DNS MX & SMTP validity checks)</span>
            </label>
          </div>
        </div>

        {/* Live Estimation Box */}
        {estimate && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.875rem 1rem',
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.875rem',
            }}
          >
            <div>
              <strong>Estimated Credit Usage:</strong> {estimate.estimatedCostMin} – {estimate.estimatedCostMax} credits
              {freeFirstMode && !allowEnrichment && (
                <span style={{ color: '#6ee7b7', marginLeft: '0.5rem' }}>✓ Zero export credits consumed</span>
              )}
            </div>

            {estimate.warnings?.length > 0 && (
              <span style={{ color: '#fcd34d', fontSize: '0.75rem' }}>
                {estimate.warnings[0]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Launch Action */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
          onClick={handleStartDiscovery}
          disabled={isSubmitting || (estimate && !estimate.canProceed)}
        >
          <Play size={18} />
          <span>{isSubmitting ? 'Starting Waterfall...' : 'Find Contacts'}</span>
        </button>
      </div>

      {/* Paste Modal */}
      {pasteModalOpen && (
        <div className="modal-overlay" onClick={() => setPasteModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Paste Multiple Targets</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setPasteModalOpen(false)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '1rem' }}>
              Paste lines from spreadsheets or text. Supported format: <code>Company Name, Domain, Roles</code> or one company name per line.
            </p>
            <textarea
              className="form-textarea"
              rows={8}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Stripe, stripe.com, Recruiter&#10;Datadog, datadoghq.com&#10;Vercel, vercel.com, Talent Partner"
            />
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPasteModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleBulkPaste}>
                <Check size={16} /> Import Parsed Lines
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
