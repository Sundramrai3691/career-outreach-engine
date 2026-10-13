import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { Dashboard } from './pages/Dashboard.js';
import { NewDiscovery } from './pages/NewDiscovery.js';
import { DiscoveryRunProgress } from './pages/DiscoveryRunProgress.js';
import { DiscoveryRunsList } from './pages/DiscoveryRunsList.js';
import { ContactsTable } from './pages/ContactsTable.js';
import { EmailTemplates } from './pages/EmailTemplates.js';
import { CampaignsList } from './pages/CampaignsList.js';
import { CampaignDetails } from './pages/CampaignDetails.js';
import { Settings } from './pages/Settings.js';
import { PrepareMailMergeModal } from './pages/PrepareMailMergeModal.js';
import { api } from './services/api.js';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<any>(null);

  // Prepare mail merge modal state
  const [mailMergeContactIds, setMailMergeContactIds] = useState<string[] | null>(null);

  useEffect(() => {
    loadGoogleStatus();
  }, [currentTab]);

  const loadGoogleStatus = async () => {
    try {
      const status = await api.getGoogleStatus();
      setGoogleStatus(status);
    } catch (err) {
      console.error('Failed to get Google status', err);
    }
  };

  const handleNavigate = (tab: string, runOrCampaignId?: string) => {
    if (tab === 'discovery-progress' && runOrCampaignId) {
      setActiveRunId(runOrCampaignId);
      setCurrentTab('discovery-progress');
    } else if (tab === 'campaign-details' && runOrCampaignId) {
      setActiveCampaignId(runOrCampaignId);
      setCurrentTab('campaign-details');
    } else {
      setCurrentTab(tab);
    }
  };

  const handleRunStarted = (runId: string) => {
    setActiveRunId(runId);
    setCurrentTab('discovery-progress');
  };

  const handleSelectRun = (runId: string) => {
    setActiveRunId(runId);
    setCurrentTab('discovery-progress');
  };

  const handleSelectCampaign = (campaignId: string) => {
    setActiveCampaignId(campaignId);
    setCurrentTab('campaign-details');
  };

  return (
    <div className="app-container">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        googleStatus={googleStatus}
      />

      <main className="main-content">
        {currentTab === 'dashboard' && (
          <Dashboard onNavigate={handleNavigate} />
        )}

        {currentTab === 'new-discovery' && (
          <NewDiscovery onRunStarted={handleRunStarted} />
        )}

        {currentTab === 'discovery-progress' && activeRunId && (
          <DiscoveryRunProgress
            runId={activeRunId}
            onNavigateToContacts={() => setCurrentTab('contacts')}
          />
        )}

        {currentTab === 'discovery-runs' && (
          <DiscoveryRunsList
            onSelectRun={handleSelectRun}
            onNavigateToNewDiscovery={() => setCurrentTab('new-discovery')}
          />
        )}

        {currentTab === 'contacts' && (
          <ContactsTable
            onPrepareMailMerge={(selectedContactIds) => setMailMergeContactIds(selectedContactIds)}
          />
        )}

        {currentTab === 'templates' && <EmailTemplates />}

        {currentTab === 'campaigns' && (
          <CampaignsList
            onSelectCampaign={handleSelectCampaign}
            onNavigateToDiscovery={() => setCurrentTab('new-discovery')}
          />
        )}

        {currentTab === 'campaign-details' && activeCampaignId && (
          <CampaignDetails
            campaignId={activeCampaignId}
            onBack={() => setCurrentTab('campaigns')}
          />
        )}

        {currentTab === 'settings' && <Settings />}
      </main>

      {/* Prepare Google Mail Merge Modal */}
      {mailMergeContactIds && (
        <PrepareMailMergeModal
          contactIds={mailMergeContactIds}
          onClose={() => setMailMergeContactIds(null)}
          onNavigateToCampaign={(campaignId) => {
            setMailMergeContactIds(null);
            handleSelectCampaign(campaignId);
          }}
        />
      )}
    </div>
  );
};
