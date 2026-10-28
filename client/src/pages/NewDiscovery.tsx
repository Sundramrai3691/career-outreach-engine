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
  const [excludedRoles, setExcludedRoles] = useState<string[]>([]);
  const [technicalSkills, setTechnicalSkills] = useState<string[]>([]);
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [graduationYear, setGraduationYear] = useState('');
  const [eligibleYearMin, setEligibleYearMin] = useState('');
  const [eligibleYearMax, setEligibleYearMax] = useState('');
  const [experienceLevels, setExperienceLevels] = useState<string[]>(['new_grad', 'junior']);
  const [remotePreference, setRemotePreference] = useState<'any' | 'remote_preferred' | 'remote_only'>('any');
  const [excludedLocations, setExcludedLocations] = useState<string[]>([]);
  // LinkedIn-style multi-select search states
  const [companies, setCompanies] = useState<string[]>(['Stripe', 'Datadog']);
  const [companyDomainsText, setCompanyDomainsText] = useState('');
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
  const [providerPriority, setProviderPriority] = useState<('tomba' | 'apollo' | 'hunter' | 'snov' | 'mock')[]>([
    'tomba',
    'apollo',
    'hunter',
    'snov',
  ]);
  const [enableMockSimulation, setEnableMockSimulation] = useState(false);

  // Live Cost Estimate & submission states
  const [estimate, setEstimate] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceCoverage, setSourceCoverage] = useState<any>(null);

  const parseList = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  const formatList = (value: string[]) => value.join(', ');

  useEffect(() => {
    api.getCandidateProfile().then((profile) => {
      if (profile.targetRoles?.length) setRoles(profile.targetRoles);
      if (profile.locations?.length) setLocations(profile.locations);
      setExcludedRoles(profile.excludedRoles || []);
      setTechnicalSkills(profile.technicalSkills || []);
      setRequiredSkills(profile.requiredSkills || []);
      setGraduationYear(profile.graduationYear ? String(profile.graduationYear) : '');
      setEligibleYearMin(profile.eligibleGraduationYearMin ? String(profile.eligibleGraduationYearMin) : '');
      setEligibleYearMax(profile.eligibleGraduationYearMax ? String(profile.eligibleGraduationYearMax) : '');
      setExperienceLevels(profile.experienceLevels || []);
      setRemotePreference(profile.remotePreference || 'any');
      setExcludedLocations(profile.excludedLocations || []);
    }).catch((err) => console.error('Failed to load candidate job-fit profile', err));
  }, []);

  useEffect(() => {
    api.getJobSourceCoverage().then(setSourceCoverage)
      .catch((err) => console.error('Failed to load job source coverage', err));
  }, []);

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

    const companyDomains = companyDomainsText.split(/\r?\n/).map((domain) => domain.trim());
    while (companyDomains.length > 0 && !companyDomains[companyDomains.length - 1]) companyDomains.pop();
    if (companyDomains.some(Boolean) && companyDomains.length !== companies.length) {
      setError('Enter one company domain per company, in the same order, or clear the domain list.');
      return;
    }

    try {
      setIsSubmitting(true);

      const jobProfile = {
        targetRoles: roles,
        excludedRoles,
        technicalSkills,
        requiredSkills,
        graduationYear: graduationYear ? Number(graduationYear) : null,
        eligibleGraduationYearMin: eligibleYearMin ? Number(eligibleYearMin) : null,
        eligibleGraduationYearMax: eligibleYearMax ? Number(eligibleYearMax) : null,
        experienceLevels,
        locations,
        remotePreference,
        excludedLocations,
      };
      const payload = {
        companies: companies.map((name, index) => ({
          name,
          domain: companyDomains[index] || undefined,
          targetRoles: roles,
          locations,
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
          jobProfile,
        },
      };

      await api.saveCandidateProfile(jobProfile);
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
            <h2>Discover Jobs & Contacts</h2>
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
            Find live role-matched openings from public sources. Contact discovery is a separate stage; a job post does not identify its hiring manager or email.
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

      {sourceCoverage && (
        <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <strong>Job source coverage: {sourceCoverage.coveragePercent}%</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                {sourceCoverage.validatedMonitorable} validated of {sourceCoverage.totalCompanies} companies in the current database watchlist (denominator: {sourceCoverage.coverageDenominator}).
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span>Scanned: {sourceCoverage.successfullyScanned}</span>
              <span>Zero jobs: {sourceCoverage.zeroJobsAfterSuccessfulScan}</span>
              <span>Unsupported: {sourceCoverage.unsupportedOrUnconfigured}</span>
              <span>Failing: {sourceCoverage.failing}</span>
            </div>
          </div>
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
            <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <label className="form-label">Company domains (optional)</label>
              <textarea
                className="form-input"
                rows={Math.min(Math.max(companies.length, 2), 5)}
                value={companyDomainsText}
                onChange={(e) => setCompanyDomainsText(e.target.value)}
                placeholder={'stripe.com\ndatadoghq.com'}
              />
              <small style={{ color: 'var(--text-muted)' }}>
                Optional: one domain per company, in the same order. Used only for official-site fallback; Greenhouse and Lever boards require explicit server configuration.
              </small>
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

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>Candidate job-fit profile</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 1rem' }}>
              Saved with your next scan. Missing details lower confidence; only explicit hard mismatches exclude a posting.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.875rem' }}>
              <div className="form-group">
                <label className="form-label">Technical skills</label>
                <textarea className="form-input" rows={2} value={formatList(technicalSkills)} onChange={(e) => setTechnicalSkills(parseList(e.target.value))} placeholder="Python, TypeScript, React, SQL" />
              </div>
              <div className="form-group">
                <label className="form-label">Required skills (hard filter)</label>
                <textarea className="form-input" rows={2} value={formatList(requiredSkills)} onChange={(e) => setRequiredSkills(parseList(e.target.value))} placeholder="Only skills you require for eligibility" />
              </div>
              <div className="form-group">
                <label className="form-label">Excluded role terms</label>
                <textarea className="form-input" rows={2} value={formatList(excludedRoles)} onChange={(e) => setExcludedRoles(parseList(e.target.value))} placeholder="Senior, Principal, Manager" />
              </div>
              <div className="form-group">
                <label className="form-label">Exclude locations</label>
                <textarea className="form-input" rows={2} value={formatList(excludedLocations)} onChange={(e) => setExcludedLocations(parseList(e.target.value))} placeholder="Locations you cannot work from" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginTop: '0.25rem' }}>
              <div className="form-group">
                <label className="form-label">Graduation year</label>
                <input className="form-input" type="number" min="2000" max="2100" value={graduationYear} onChange={(e) => setGraduationYear(e.target.value)} placeholder="2027" />
              </div>
              <div className="form-group">
                <label className="form-label">Eligible graduation from</label>
                <input className="form-input" type="number" min="2000" max="2100" value={eligibleYearMin} onChange={(e) => setEligibleYearMin(e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Eligible graduation through</label>
                <input className="form-input" type="number" min="2000" max="2100" value={eligibleYearMax} onChange={(e) => setEligibleYearMax(e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Remote preference</label>
                <select className="form-input" value={remotePreference} onChange={(e) => setRemotePreference(e.target.value as typeof remotePreference)}>
                  <option value="any">Any work arrangement</option>
                  <option value="remote_preferred">Prefer remote</option>
                  <option value="remote_only">Remote only</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="form-label">Experience levels</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {[
                  ['internship', 'Internship'], ['new_grad', 'New graduate'], ['junior', 'Junior'],
                  ['mid', 'Mid-level'], ['senior', 'Senior'],
                ].map(([value, label]) => (
                  <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem' }}>
                    <input type="checkbox" checked={experienceLevels.includes(value)} onChange={(e) => setExperienceLevels(e.target.checked ? [...experienceLevels, value] : experienceLevels.filter((level) => level !== value))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Optional Job URL and Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <LinkIcon size={14} color="var(--text-muted)" />
                Official Careers or Job Page URL (Optional)
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
