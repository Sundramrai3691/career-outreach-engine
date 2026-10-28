/**
 * Frontend Typed API Client connecting to Referral Engine Backend
 */

const API_BASE = '/api';

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export const api = {
  // Dashboard
  getDashboardStats: () => request<any>('/dashboard/stats'),

  // Contact Discovery
  estimateDiscovery: (data: any) =>
    request<any>('/discovery/estimate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  startDiscovery: (data: any) =>
    request<{ success: boolean; runId: string; message: string }>('/discovery/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getCandidateProfile: () => request<any>('/discovery/profile'),

  saveCandidateProfile: (profile: any) =>
    request<any>('/discovery/profile', { method: 'PUT', body: JSON.stringify(profile) }),

  getJobSourceCoverage: () => request<any>('/discovery/sources/coverage'),

  getDiscoveryRuns: () => request<any[]>('/discovery/runs'),

  getDiscoveryRun: (id: string) => request<any>(`/discovery/runs/${id}`),

  cancelDiscoveryRun: (id: string) =>
    request<{ success: boolean }>(`/discovery/runs/${id}/cancel`, {
      method: 'POST',
    }),

  getSuggestions: (type: 'companies' | 'roles' | 'locations', q = '') =>
    request<{ suggestions: Array<{ value: string; label: string; subtext?: string }> }>(
      `/discovery/suggestions?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`
    ),

  // Contacts
  getContacts: (params: Record<string, string | number> = {}) => {
    const query = new URLSearchParams(params as any).toString();
    return request<{ data: any[]; pagination: any }>(`/contacts?${query}`);
  },

  getContact: (id: string) => request<any>(`/contacts/${id}`),

  importContactsCsv: (csvContent: string, fileName?: string) =>
    request<{
      success: boolean;
      summary: {
        totalRows: number;
        imported: number;
        updated: number;
        skippedSuppressed: number;
        errors: number;
      };
      createdCount: number;
      updatedCount: number;
      suppressedCount: number;
      errorCount: number;
      rowErrors: Array<{ row: number; error: string; raw: any }>;
      contacts: any[];
    }>('/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ csvContent, fileName }),
    }),

  exportContactsCsv: async (contactIds?: string[]) => {
    const response = await fetch(`${API_BASE}/contacts/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds }),
    });
    if (!response.ok) throw new Error('Export failed');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  },

  suppressEmail: (data: { email: string; reason: string; notes?: string }) =>
    request<{ success: boolean }>('/contacts/suppress', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Templates
  getTemplates: () => request<any[]>('/templates'),

  createTemplate: (data: any) =>
    request<any>('/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTemplate: (id: string, data: any) =>
    request<any>(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTemplate: (id: string) =>
    request<{ success: boolean }>(`/templates/${id}`, {
      method: 'DELETE',
    }),

  previewTemplate: (data: any) =>
    request<any>('/templates/preview', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Google Integration
  getGoogleStatus: () => request<any>('/google/status'),

  getGoogleAuthUrl: () => request<{ url: string; state: string }>('/google/auth-url'),

  disconnectGoogle: () =>
    request<{ success: boolean }>('/google/disconnect', {
      method: 'POST',
    }),

  prepareGoogleMailMerge: (data: any) =>
    request<any>('/google/prepare-mail-merge', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Campaigns
  getCampaigns: () => request<any[]>('/campaigns'),

  getCampaign: (id: string) => request<any>(`/campaigns/${id}`),

  previewCampaign: (id: string, data: any) =>
    request<any[]>(`/campaigns/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  dispatchCampaign: (id: string, data: any) =>
    request<any>(`/campaigns/${id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Settings
  getSettings: () => request<any>('/settings'),

  updateProvider: (key: string, data: any) =>
    request<any>(`/settings/providers/${key}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  checkHealth: (key: string) =>
    request<any>(`/settings/providers/${key}/health-check`, {
      method: 'POST',
    }),

  getSuppressions: () => request<any[]>('/settings/suppressions'),

  addSuppression: (data: any) =>
    request<any>('/settings/suppressions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
