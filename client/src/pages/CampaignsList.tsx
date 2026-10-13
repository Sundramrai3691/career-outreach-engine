import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import {
  FileSpreadsheet,
  FileText,
  ExternalLink,
  ArrowRight,
  Plus,
} from 'lucide-react';

interface CampaignsListProps {
  onSelectCampaign: (id: string) => void;
  onNavigateToDiscovery: () => void;
}

export const CampaignsList: React.FC<CampaignsListProps> = ({
  onSelectCampaign,
  onNavigateToDiscovery,
}) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const data = await api.getCampaigns();
      setCampaigns(data);
    } catch (err) {
      console.error('Failed to load campaigns', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Outreach Campaigns</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Manage generated Google Docs mail-merge templates, Google Sheets recipient lists, and Gmail sends.
          </p>
        </div>

        <button className="btn btn-primary btn-sm" onClick={onNavigateToDiscovery}>
          <Plus size={14} /> New Campaign Discovery
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Google Files</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    Loading campaigns...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No campaigns created yet. Select contacts from discovery to prepare your first mail merge.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                      {c.template && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Template: {c.template.name}
                        </div>
                      )}
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          c.status === 'completed'
                            ? 'badge-verified'
                            : c.status === 'prepared'
                            ? 'badge-accept_all'
                            : 'badge-unverified'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.875rem' }}>
                        <strong>{c.totalRecipients}</strong> total
                        {c.sentCount > 0 && <span style={{ color: '#6ee7b7' }}> • {c.sentCount} sent</span>}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {c.googleSpreadsheetUrl && (
                          <a
                            href={c.googleSpreadsheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            title="Open Google Sheet"
                          >
                            <FileSpreadsheet size={12} /> Sheets <ExternalLink size={10} />
                          </a>
                        )}
                        {c.googleDocUrl && (
                          <a
                            href={c.googleDocUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            title="Open Google Doc Template"
                          >
                            <FileText size={12} /> Doc <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </td>

                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelectCampaign(c.id)}
                      >
                        Manage & Send <ArrowRight size={14} />
                      </button>
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
