import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { MultiSelectChips } from '../components/MultiSelectChips.js';
import {
  Search,
  Building,
  Briefcase,
  MapPin,
  ChevronDown,
  ChevronUp,
  Sliders,
  AlertCircle,
  History,
  Link as LinkIcon,
  Upload,
} from 'lucide-react';

interface NewDiscoveryProps {
  onRunStarted: (runId: string) => void;
  onViewHistory?: () => void;
  onNavigateToContacts?: () => void;
}

export const NewDiscovery: React.FC<NewDiscoveryProps> = ({
  onRunStarted,
  onViewHistory,
  onNavigateToContacts,
}) => {
  // LinkedIn-style multi-select search states
  const [companies, setCompanies] = useState<string[]>(['Stripe', 'Datadog']);
  const [roles, setRoles] = useState<string[]>([
    'Technical Recruiter',
    'Senior Technical Recruiter',
    'Engineering Manager',
  ]);
  const [locations, setLocations] = useState<string[]>(['San Francisco, CA']);
  const [jobUrl, setJobUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Advanced Waterfall & Budget Settings (collapsed by default)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxBudget, setMaxBudget] = useState(25);
  const [allowEnrichment, setAllowEnrichment] = useState(false);
  const [freeFirstMode, setFreeFirstMode] = useState(true);
  const [verifyEmails, setVerifyEmails] = useState(true);
  const [providerPriority, setProviderPriority] = useState<('apollo' | 'hunter' | 'snov' | 'mock')[]>([
    'apollo',
    'hunter',
    'snov',
  ]);
  const [enableMockSimulation, setEnableMockSimulation] = useState(false);

  // Live Cost Estimate & submission states
  const [estimate, setEstimate] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recalculate cost estimate when parameters change
  useEffect(() => {
    const fetchEstimate = async () => {
      if (companies.length === 0) {
        setEstimate(null);
        return;
      }
      try {
        const est = await api.estimateDiscovery({
          companiesCount: companies.length,
          rolesCount: roles.length || 1,
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
  }, [companies.length, roles.length, allowEnrichment, freeFirstMode, verifyEmails, maxBudget]);

  const handleToggleMock = (checked: boolean) => {
    setEnableMockSimulation(checked);
    if (checked) {
      if (!providerPriority.includes('mock')) {
        setProviderPriority(['mock', ...providerPriority]);
      }
    } else {
      setProviderPriority(providerPriority.filter((p) => p !== 'mock'));
    }
  };

  const handleStartDiscovery = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (companies.length === 0) {
      setError('Please add at least one target company.');
      return;
    }

    if (roles.length === 0) {
      setError('Please specify at least one target role (e.g. Technical Recruiter).');
      return;
    }

    try {
      setIsSubmitting(true);

      const payload = {
        companies: companies.map((name) => ({
          name,
          targetRoles: roles,
          location: locations.length > 0 ? locations.join(', ') : undefined,
          jobUrl: jobUrl.trim() || undefined,
          notes: notes.trim() || undefined,
        })),
        config: {
          maxBudget: Number(maxBudget) || 25,
          allowEnrichment,
          freeFirstMode,
          verifyEmails,
          providerPriority,
        },
      };

      const res = await api.startDiscovery(payload);
      if (res.runId) {
        onRunStarted(res.runId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start discovery run.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addCompanyPreset = (name: string) => {
    if (!companies.includes(name)) {
      setCompanies([...companies, name]);
    }
  };

  const addRolePreset = (role: string) => {
    if (!roles.includes(role)) {
      setRoles([...roles, role]);
    }
  };

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <h2>Discover Contacts</h2>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '0.2rem 0.5rem',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: 'var(--radius-full)',
                color: '#818cf8',
              }}
            >
              Multi-Target Pipeline
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Find recruiters and hiring managers across multiple target companies with verified direct emails.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.625rem' }}>
          {onNavigateToContacts && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onNavigateToContacts}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Upload size={14} />
              <span>Import CSV Fallback</span>
            </button>
          )}

          {onViewHistory && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onViewHistory}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <History size={14} />
              <span>Discovery History</span>
            </button>
          )}
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
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Search Panel Card */}
      <form onSubmit={handleStartDiscovery}>
        <div
          className="card"
          style={{
            background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.4)',
            padding: '1.75rem',
            marginBottom: '1.5rem',
          }}
        >
          {/* 1. Target Companies */}
          <div style={{ marginBottom: '1.5rem' }}>
            <MultiSelectChips
              id="companies-chips"
              label="Target Companies"
              icon={<Building size={16} color="#818cf8" />}
              placeholder="Search or enter companies (e.g. Stripe, Airbnb, Google)..."
              type="companies"
              selected={companies}
              onChange={setCompanies}
              helperText="Press Enter or Comma to add. Suggestions automatically populate from your database & curated lists."
            />

            {/* Quick Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Quick add:</span>
              {['Stripe', 'Google', 'Datadog', 'OpenAI', 'Airbnb', 'Figma'].map((comp) => (
                <button
                  key={comp}
                  type="button"
                  onClick={() => addCompanyPreset(comp)}
                  style={{
                    fontSize: '0.6875rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 'var(--radius-full)',
                    background: companies.includes(comp) ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: companies.includes(comp) ? '#c7d2fe' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  +{comp}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Target Roles */}
          <div style={{ marginBottom: '1.5rem' }}>
            <MultiSelectChips
              id="roles-chips"
              label="Target Roles & Job Titles"
              icon={<Briefcase size={16} color="#10b981" />}
              placeholder="Search or enter job titles (e.g. Technical Recruiter, Engineering Manager)..."
              type="roles"
              selected={roles}
              onChange={setRoles}
              helperText="Roles apply to all selected companies. You can add recruiters, talent managers, or team leads."
            />

            {/* Role Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Common roles:</span>
              {[
                'Technical Recruiter',
                'Head of Talent Acquisition',
                'Engineering Manager',
                'Director of Engineering',
              ].map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => addRolePreset(role)}
                  style={{
                    fontSize: '0.6875rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 'var(--radius-full)',
                    background: roles.includes(role) ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: roles.includes(role) ? '#6ee7b7' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  +{role}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Target Locations (Optional) */}
          <div style={{ marginBottom: '1.5rem' }}>
            <MultiSelectChips
              id="locations-chips"
              label="Locations (Optional)"
              icon={<MapPin size={16} color="#f59e0b" />}
              placeholder="Filter by location (e.g. San Francisco, CA, Remote)..."
              type="locations"
              selected={locations}
              onChange={setLocations}
              helperText="Leave empty to search globally across all office locations."
            />
          </div>

          {/* Optional Job URL and Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <LinkIcon size={14} color="var(--text-muted)" />
                Target Job Listing URL (Optional)
              </label>
              <input
                type="url"
                className="form-input"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://company.com/careers/job-id"
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Reference Notes (Optional)</label>
              <input
                type="text"
                className="form-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Q4 Outreach batch"
              />
            </div>
          </div>
        </div>

        {/* Collapsible Advanced Options Accordion */}
        <div
          className="card"
          style={{
            background: 'rgba(30, 41, 59, 0.4)',
            border: '1px solid var(--border-color)',
            padding: '1.25rem',
            marginBottom: '1.5rem',
          }}
        >
          <div
            onClick={() => setAdvancedOpen(!advancedOpen)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sliders size={16} color="#818cf8" />
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Advanced Pipeline Options & Provider Priority</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '0.75rem' }}>
                {advancedOpen ? 'Hide' : 'Show options (Free-first, budget, simulator)'}
              </span>
              {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>

          {advancedOpen && (
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                {/* Free First Mode */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={freeFirstMode}
                      onChange={(e) => setFreeFirstMode(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Free-First Mode</span>
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '1.5rem' }}>
                    Exhaust zero-credit people search before consuming paid credits.
                  </p>
                </div>

                {/* Email Verification */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={verifyEmails}
                      onChange={(e) => setVerifyEmails(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Verify Deliverability</span>
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '1.5rem' }}>
                    Run SMTP & MX deliverability checks to protect sender reputation.
                  </p>
                </div>

                {/* Allow Enrichment */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={allowEnrichment}
                      onChange={(e) => setAllowEnrichment(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Allow Paid Enrichment</span>
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '1.5rem' }}>
                    Use Apollo credit enrichment if standard discovery does not return email.
                  </p>
                </div>

                {/* Mock Simulator Mode */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={enableMockSimulation}
                      onChange={(e) => handleToggleMock(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#f59e0b' }}>
                      Mock Simulator Mode
                    </span>
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '1.5rem' }}>
                    Simulate discovery for demo/testing without consuming real provider quotas.
                  </p>
                </div>
              </div>

              {/* Max Budget */}
              <div style={{ marginTop: '1.25rem', maxWidth: '300px' }}>
                <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                  Max Credits Budget per Run: <strong>{maxBudget}</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Action & Cost Estimation Footer */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(22, 29, 44, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.25rem',
            padding: '1.25rem 1.75rem',
          }}
        >
          {/* Summary Details */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                {companies.length} {companies.length === 1 ? 'Company' : 'Companies'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>•</span>
              <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                {roles.length} {roles.length === 1 ? 'Target Role' : 'Target Roles'}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Estimated cost:{' '}
              <strong style={{ color: '#10b981' }}>
                {estimate?.estimatedCredits ? `${estimate.estimatedCredits} credits` : '0 credits (Free-First)'}
              </strong>
              {freeFirstMode && ' • Prioritizes free queries'}
            </div>
          </div>

          {/* Big Launch CTA */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || companies.length === 0 || roles.length === 0}
            style={{
              padding: '0.75rem 1.75rem',
              fontSize: '0.9375rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {isSubmitting ? (
              <>
                <span className="spinner" />
                <span>Launching Discovery...</span>
              </>
            ) : (
              <>
                <Search size={18} />
                <span>Find Contacts ({companies.length})</span>
              </>
            )}
          </button>
        </div>
      </form>

      {onNavigateToContacts && (
        <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Have an existing lead list or blocked by provider search tiers?{' '}
          <button
            type="button"
            onClick={onNavigateToContacts}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#818cf8',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              fontSize: '0.8125rem',
            }}
          >
            Import contacts directly from CSV fallback
          </button>
        </div>
      )}
    </div>
  );
};
