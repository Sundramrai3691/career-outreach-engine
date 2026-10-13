import React, { useEffect, useState } from 'react';
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
            Filter, inspect source evidence, and select contacts for Google Mail Merge or Gmail outreach.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
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
              <option value="">All Providers</option>
              <option value="apollo">Apollo.io</option>
              <option value="hunter">Hunter.io</option>
              <option value="snov">Snov.io</option>
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
    </div>
  );
};
