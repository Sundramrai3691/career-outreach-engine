import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  Plus,
  Trash2,
  Check,
  Eye,
  AlertCircle,
  Tag,
  Save,
} from 'lucide-react';

export const EmailTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

  // Editor states
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Live preview
  const [previewRender, setPreviewRender] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const AVAILABLE_VARIABLES = [
    { tag: '{{FirstName}}', label: 'First Name', sample: 'Sarah' },
    { tag: '{{LastName}}', label: 'Last Name', sample: 'Chen' },
    { tag: '{{FullName}}', label: 'Full Name', sample: 'Sarah Chen' },
    { tag: '{{Company}}', label: 'Company', sample: 'Stripe' },
    { tag: '{{JobTitle}}', label: 'Job Title', sample: 'Head of Talent Acquisition' },
    { tag: '{{Role}}', label: 'Target Role', sample: 'Software Engineer' },
    { tag: '{{JobURL}}', label: 'Job Posting URL', sample: 'https://stripe.com/jobs/123' },
  ];

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    // Live preview debounce
    const timer = setTimeout(() => {
      generatePreview();
    }, 200);
    return () => clearTimeout(timer);
  }, [subject, bodyText]);

  const loadTemplates = async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data);

      if (data.length > 0 && !activeTemplateId) {
        selectTemplate(data[0]);
      } else if (data.length === 0) {
        handleNewTemplate();
      }
    } catch (err) {
      console.error('Failed to load templates', err);
    }
  };

  const selectTemplate = (tpl: any) => {
    setActiveTemplateId(tpl.id);
    setName(tpl.name);
    setSubject(tpl.subject);
    setBodyText(tpl.bodyText);
    setIsDefault(tpl.isDefault);
    setSavedSuccess(false);
  };

  const handleNewTemplate = () => {
    setActiveTemplateId(null);
    setName('New Professional Outreach Template');
    setSubject('Reaching out regarding {{Role}} opportunities at {{Company}}');
    setBodyText(
      'Hi {{FirstName}},\n\nI hope you are having a productive week.\n\nI have been following {{Company}}\'s engineering milestones and wanted to introduce myself regarding {{Role}} opportunities. I would love to connect briefly if you have a moment.\n\nBest regards,\n[Your Name]'
    );
    setIsDefault(false);
    setSavedSuccess(false);
  };

  const generatePreview = async () => {
    try {
      const res = await api.previewTemplate({
        subject,
        bodyText,
      });
      setPreviewRender(res.rendered);
    } catch (err) {
      console.error('Preview error', err);
    }
  };

  const insertVariable = (tag: string, targetField: 'subject' | 'body') => {
    if (targetField === 'subject') {
      setSubject((prev) => prev + ' ' + tag);
    } else {
      setBodyText((prev) => prev + ' ' + tag);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !subject.trim() || !bodyText.trim()) return;

    try {
      setIsSaving(true);
      if (activeTemplateId) {
        await api.updateTemplate(activeTemplateId, {
          name,
          subject,
          bodyText,
          isDefault,
        });
      } else {
        const created = await api.createTemplate({
          name,
          subject,
          bodyText,
          isDefault,
        });
        setActiveTemplateId(created.id);
      }
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
      loadTemplates();
    } catch (err) {
      console.error('Failed to save template', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      await api.deleteTemplate(id);
      loadTemplates();
    } catch (err) {
      console.error('Delete template failed', err);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Email Templates & Merge Editor</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Design personalized email templates. Merge variables are automatically mapped to Google Sheets and Docs.
          </p>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={handleNewTemplate}>
          <Plus size={14} /> New Template
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Template List Sidebar */}
        <div className="card" style={{ padding: '1rem' }}>
          <h4 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Saved Templates</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                onClick={() => selectTemplate(tpl)}
                style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  background: activeTemplateId === tpl.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${activeTemplateId === tpl.id ? 'rgba(99, 102, 241, 0.35)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{tpl.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {tpl.isDefault && <span style={{ color: '#fcd34d' }}>★ Default • </span>}
                    {tpl.subject.slice(0, 25)}...
                  </div>
                </div>

                <button
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.25rem', border: 'none', background: 'transparent' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(tpl.id);
                  }}
                  title="Delete"
                >
                  <Trash2 size={12} color="#f87171" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor & Preview Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ flex: 1, maxWidth: '400px' }}>
                <label className="form-label">Template Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Template Name"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    style={{ accentColor: '#6366f1' }}
                  />
                  <span>Set as Default</span>
                </label>

                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={isSaving}>
                  {savedSuccess ? (
                    <>
                      <Check size={14} /> Saved!
                    </>
                  ) : (
                    <>
                      <Save size={14} /> {activeTemplateId ? 'Save Changes' : 'Create Template'}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Merge Field Selector */}
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(15, 21, 33, 0.6)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <Tag size={12} /> Insert Variable Pills (click to append):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {AVAILABLE_VARIABLES.map((v) => (
                  <button
                    key={v.tag}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    onClick={() => insertVariable(v.tag, 'body')}
                    title={`Inserts ${v.tag} (e.g. ${v.sample})`}
                  >
                    {v.tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject Field */}
            <div className="form-group">
              <label className="form-label">Email Subject</label>
              <input
                type="text"
                className="form-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            {/* Body Textarea */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Message Body</label>
              <textarea
                className="form-textarea"
                rows={9}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </div>
          </div>

          {/* Live Rendered Preview */}
          <div className="card">
            <h4 style={{ fontSize: '0.9375rem', color: '#c7d2fe', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Eye size={16} /> Live Personalization Preview
            </h4>

            {previewRender ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Subject: </span>
                  <strong>{previewRender.subject}</strong>
                </div>

                <div
                  style={{
                    padding: '1rem',
                    background: 'rgba(15, 21, 33, 0.7)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                  }}
                >
                  {previewRender.body}
                </div>

                {previewRender.missingVariables?.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#fcd34d', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <AlertCircle size={14} />
                    <span>Unresolved placeholders: {previewRender.missingVariables.join(', ')}</span>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Preview unavailable.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
