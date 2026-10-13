import React from 'react';
import {
  Users,
  Search,
  FileText,
  Mail,
  Settings as SettingsIcon,
  PlayCircle,
  Activity,
  Layers,
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  googleStatus?: any;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, googleStatus }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'new-discovery', label: 'New Discovery', icon: Search },
    { id: 'discovery-runs', label: 'Active Runs', icon: PlayCircle },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'campaigns', label: 'Campaigns', icon: Mail },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setCurrentTab('dashboard');
          }}
        >
          <div className="brand-logo">
            <Layers size={20} />
          </div>
          <div>
            <div className="brand-text">Referral Engine</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1 }}>
              Contact Discovery & Mail Merge
            </div>
          </div>
        </a>

        <div className="nav-links">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                className={`nav-btn ${isActive ? 'active' : ''}`}
                onClick={() => setCurrentTab(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {googleStatus?.isConnected ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.75rem',
                color: '#6ee7b7',
              }}
              title={`Connected as ${googleStatus.account?.email}`}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#10b981',
                }}
              />
              <span>Google Connected</span>
            </div>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentTab('settings')}
            >
              Connect Google
            </button>
          )}

          <button
            className="btn btn-primary btn-sm"
            onClick={() => setCurrentTab('new-discovery')}
          >
            <Search size={14} />
            <span>Find Contacts</span>
          </button>
        </div>
      </div>
    </nav>
  );
};
