import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import {
  ArrowRight,
  Plus,
  Coins,
} from 'lucide-react';

interface DiscoveryRunsListProps {
  onSelectRun: (id: string) => void;
  onNavigateToNewDiscovery: () => void;
}

export const DiscoveryRunsList: React.FC<DiscoveryRunsListProps> = ({
  onSelectRun,
  onNavigateToNewDiscovery,
}) => {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRuns();
  }, []);

  const loadRuns = async () => {
    try {
      setLoading(true);
      const data = await api.getDiscoveryRuns();
      setRuns(data);
    } catch (err) {
      console.error('Failed to load discovery runs', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Discovery Runs History</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Persistent background jobs, status tracking, and discovered contact summaries.
          </p>
        </div>

        <button className="btn btn-primary btn-sm" onClick={onNavigateToNewDiscovery}>
          <Plus size={14} /> Start New Discovery
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Status</th>
                <th>Target Companies</th>
                <th>Contacts Discovered</th>
                <th>Credits Spent</th>
                <th>Started</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    Loading discovery runs...
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No discovery runs executed yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code style={{ fontSize: '0.8125rem', color: '#c7d2fe' }}>
                        {r.id.slice(0, 8)}
                      </code>
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          r.status === 'completed'
                            ? 'badge-verified'
                            : r.status === 'running'
                            ? 'badge-accept_all'
                            : 'badge-invalid'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>

                    <td>
                      <div>
                        {r.processedCompanies} / {r.totalCompanies} companies
                      </div>
                    </td>

                    <td>
                      <strong>{r.contactsFound}</strong> contacts
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#f59e0b' }}>
                        <Coins size={12} />
                        <span>{r.creditsConsumed}</span>
                      </div>
                    </td>

                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(r.startedAt).toLocaleString()}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onSelectRun(r.id)}
                      >
                        Inspect Progress <ArrowRight size={14} />
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
