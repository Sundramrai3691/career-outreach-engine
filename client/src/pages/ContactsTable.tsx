import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api.js';
import {
  Search,
  Download,
  Mail,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Info,
  CheckSquare,
  Square,
  Slash,
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

interface ContactsTableProps {
  onPrepareMailMerge: (selectedContactIds: string[]) => void;
}

export const ContactsTable: React.FC<ContactsTableProps> = ({ onPrepareMailMerge }) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 25, totalPages: 1 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter states
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Contact details modal
  const [activeContact, setActiveContact] = useState<any | null>(null);

  // CSV Import Modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsvText, setImportCsvText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadContacts(1);
  }, [search, companyFilter, statusFilter, sourceFilter]);

  const loadContacts = async (page = 1) => {
    try {
      setLoading(true);
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (companyFilter) params.company = companyFilter;
      if (statusFilter) params.emailStatus = statusFilter;
      if (sourceFilter) params.source = sourceFilter;

      const res = await api.getContacts(params);
      setContacts(res.data);
      setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load contacts', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string, isInvalid: boolean) => {
    if (isInvalid) return; // Prevent selection of invalid emails
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    const selectableContacts = contacts.filter((c) => c.emailStatus !== 'invalid');
    if (selectedIds.size === selectableContacts.length && selectableContacts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableContacts.map((c) => c.id)));
    }
  };

  const handleExportCsv = async () => {
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      await api.exportContactsCsv(ids);
    } catch (err) {
      console.error('CSV export failed', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportCsvText(content);
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (!importCsvText.trim()) {
      setImportError('Please select a CSV file or paste CSV content.');
      return;
    }
    try {
      setImportLoading(true);
      setImportError(null);
      const res = await api.importContactsCsv(importCsvText, importFileName || 'manual_import.csv');
      setImportResult(res);

      // Auto-select imported contacts
      if (res.contacts && res.contacts.length > 0) {
        const newIds = new Set(selectedIds);
        res.contacts.forEach((c: any) => newIds.add(c.id));
        setSelectedIds(newIds);
      }

      await loadContacts(1);
    } catch (err: any) {
      setImportError(err.message || 'Import failed. Check CSV syntax and required columns.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCloseImport = () => {
    setShowImportModal(false);
    setImportCsvText('');
    setImportFileName('');
    setImportResult(null);
    setImportError(null);
  };

  const handleSuppress = async (email: string) => {
    if (!confirm(`Are you sure you want to add ${email} to the suppression list?`)) return;
    try {
      await api.suppressEmail({ email, reason: 'manual_block' });
      loadContacts(pagination.page);
    } catch (err) {
      console.error('Suppression failed', err);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Discovered Contacts</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Filter, inspect source evidence, import from CSV, and select contacts for Google Mail Merge.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowImportModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            <Upload size={14} /> Import CSV
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCsv}>
            <Download size={14} /> Export CSV {selectedIds.size > 0 && `(${selectedIds.size})`}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onPrepareMailMerge(Array.from(selectedIds))}
            disabled={selectedIds.size === 0}
          >
            <Mail size={14} /> Prepare Mail Merge ({selectedIds.size})
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '2rem' }}
              placeholder="Search name, email, title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <input
              type="text"
              className="form-input"
              placeholder="Filter by company..."
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
            />
          </div>

          <div>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Verification Statuses</option>
              <option value="verified">Verified Deliverable</option>
              <option value="unverified">Unverified (DNS OK)</option>
              <option value="accept_all">Accept-All / Catch-all</option>
              <option value="unknown">Unknown</option>
              <option value="invalid">Invalid / Bounced</option>
            </select>
          </div>

          <div>
            <select
              className="form-select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">All Providers & Sources</option>
              <option value="apollo">Apollo.io</option>
              <option value="hunter">Hunter.io</option>
              <option value="snov">Snov.io</option>
              <option value="official_website">Official Website Probe</option>
              <option value="csv_import">Manual CSV Import</option>
              <option value="mock">Mock Simulator</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <button
                    onClick={toggleSelectAll}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {selectedIds.size > 0 && selectedIds.size === contacts.filter((c) => c.emailStatus !== 'invalid').length ? (
                      <CheckSquare size={16} color="#6366f1" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th>Name & Title</th>
                <th>Company</th>
                <th>Matched Target Role</th>
                <th>Email Address</th>
                <th>Status</th>
                <th>Source</th>
                <th>Outreach</th>
                <th style={{ width: '60px', textAlign: 'center' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}>
                    Loading contacts...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No contacts found matching criteria.
                  </td>
                </tr>
              ) : (
                contacts.map((c) => {
                  const isSelected = selectedIds.has(c.id);
                  const isInvalid = c.emailStatus === 'invalid';

                  return (
                    <tr
                      key={c.id}
                      style={{
                        background: isSelected ? 'rgba(99, 102, 241, 0.08)' : undefined,
                        opacity: isInvalid ? 0.6 : 1,
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => toggleSelect(c.id, isInvalid)}
                          disabled={isInvalid}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isInvalid ? 'var(--text-muted)' : isSelected ? '#6366f1' : 'var(--text-secondary)',
                            cursor: isInvalid ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>

                      <td>
                        <div style={{ fontWeight: 600 }}>{c.fullName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {c.jobTitle || 'No title specified'}
                        </div>
                      </td>

                      <td>
                        <div style={{ fontWeight: 500 }}>{c.companyName}</div>
                        {c.companyDomain && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {c.companyDomain}
                          </div>
                        )}
                      </td>

                      <td>
                        <span style={{ fontSize: '0.8125rem', color: '#c7d2fe' }}>
                          {c.matchedRole || '—'}
                        </span>
                      </td>

                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                          {c.email}
                        </div>
                      </td>

                      <td>
                        <span className={`badge badge-${c.emailStatus}`}>
                          {c.emailStatus}
                        </span>
                      </td>

                      <td>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.125rem 0.375rem',
                            background: 'rgba(255, 255, 255, 0.06)',
                            borderRadius: 'var(--radius-sm)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {c.primarySource}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.75rem', color: c.outreachState === 'sent' ? '#6ee7b7' : 'var(--text-muted)', textTransform: 'capitalize' }}>
                          {c.outreachState.replace('_', ' ')}
                        </span>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.25rem', borderRadius: 'var(--radius-sm)' }}
                          onClick={() => setActiveContact(c)}
                          title="View source provenance"
                        >
                          <Info size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.875rem 1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            Showing {contacts.length} of {pagination.total} contacts
          </span>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page <= 1}
              onClick={() => loadContacts(pagination.page - 1)}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => loadContacts(pagination.page + 1)}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Source Evidence & Provenance Modal */}
      {activeContact && (
        <div className="modal-overlay" onClick={() => setActiveContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{activeContact.fullName}</h3>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {activeContact.jobTitle} • {activeContact.companyName}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveContact(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label className="form-label">Email & Verification Status</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <code style={{ fontSize: '0.9375rem', padding: '0.25rem 0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-sm)' }}>
                    {activeContact.email}
                  </code>
                  <span className={`badge badge-${activeContact.emailStatus}`}>
                    {activeContact.emailStatus}
                  </span>
                </div>
              </div>

              <div>
                <label className="form-label">Source Provenance Records</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {activeContact.sources?.map((s: any) => (
                    <div
                      key={s.id}
                      style={{
                        padding: '0.75rem',
                        background: 'rgba(15, 21, 33, 0.6)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.8125rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <strong style={{ textTransform: 'capitalize' }}>Provider: {s.provider}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(s.extractedAt).toLocaleString()}</span>
                      </div>
                      {s.sourceUrl && (
                        <div>
                          <a
                            href={s.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#818cf8', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                          >
                            Source evidence link <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    handleSuppress(activeContact.email);
                    setActiveContact(null);
                  }}
                >
                  <Slash size={14} /> Add to Suppression List
                </button>

                <button className="btn btn-secondary btn-sm" onClick={() => setActiveContact(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '640px', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Upload size={18} color="#818cf8" />
                <h3 style={{ margin: 0 }}>Import Contacts from CSV</h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={handleCloseImport}>✕</button>
            </div>

            {importError && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  color: '#fca5a5',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{importError}</span>
              </div>
            )}

            {importResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  style={{
                    padding: '1rem',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6ee7b7', fontWeight: 600, marginBottom: '0.5rem' }}>
                    <CheckCircle size={18} />
                    <span>CSV Import Completed</span>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#cbd5e1', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <div>Total Processed: <strong>{importResult.summary?.totalRows || 0}</strong></div>
                    <div>New Contacts Created: <strong style={{ color: '#10b981' }}>{importResult.summary?.imported || 0}</strong></div>
                    <div>Existing Contacts Updated: <strong style={{ color: '#60a5fa' }}>{importResult.summary?.updated || 0}</strong></div>
                    <div>Skipped (Suppressed): <strong style={{ color: '#f59e0b' }}>{importResult.summary?.skippedSuppressed || 0}</strong></div>
                  </div>
                </div>

                {importResult.rowErrors && importResult.rowErrors.length > 0 && (
                  <div style={{ maxHeight: '140px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>
                    <div style={{ fontWeight: 600, color: '#fca5a5', marginBottom: '0.35rem' }}>Row Issues ({importResult.rowErrors.length}):</div>
                    {importResult.rowErrors.map((re: any, idx: number) => (
                      <div key={idx} style={{ color: '#f87171', marginBottom: '0.25rem' }}>
                        Row {re.row}: {re.error}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button className="btn btn-primary" onClick={handleCloseImport}>
                    Done & View Selected Contacts ({selectedIds.size})
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Import contacts directly into your referral pipeline. Supports deduplication by email, company association, and source provenance tracking.
                </p>

                {/* Format Guidance */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px dashed rgba(255, 255, 255, 0.15)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem',
                    marginBottom: '1rem',
                    fontSize: '0.75rem',
                    color: '#94a3b8',
                  }}
                >
                  <strong style={{ color: '#c7d2fe' }}>Expected CSV columns:</strong> <code>company, role, name, email, source, verification_status</code>
                  <br />
                  <span style={{ color: '#64748b' }}>Example: Stripe, Senior Recruiter, Sarah Connor, sarah@stripe.com, manual_import, verified</span>
                </div>

                {/* File picker */}
                <div style={{ marginBottom: '1rem' }}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,text/csv"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.5rem' }}
                  >
                    <FileText size={14} /> {importFileName ? `Selected: ${importFileName}` : 'Choose .CSV File'}
                  </button>
                </div>

                {/* Direct Paste Area */}
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label" style={{ fontSize: '0.8125rem' }}>Or Paste CSV Text:</label>
                  <textarea
                    className="form-textarea"
                    rows={6}
                    placeholder={"company,role,name,email,source,verification_status\nStripe,Recruiter,Jane Doe,jane.doe@stripe.com,csv_import,verified\nDatadog,Engineering Manager,Alex Smith,alex.smith@datadoghq.com,csv_import,verified"}
                    value={importCsvText}
                    onChange={(e) => setImportCsvText(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleCloseImport}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={importLoading || !importCsvText.trim()}
                    onClick={handleExecuteImport}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    {importLoading ? <Upload size={14} className="animate-spin" /> : <Upload size={14} />}
                    <span>{importLoading ? 'Importing...' : 'Upload & Process CSV'}</span>
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
