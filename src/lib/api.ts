import type {
  AccountLienState,
  AccountProfile,
  AccountStatus,
  AiStructuredExplanation,
  AlertItem,
  DashboardSummary,
  DatasetMetadata,
  DisputeDocumentType,
  DisputeSubmission,
  GlobalSearchResult,
  ImportValidationSummary,
  InvestigationCase,
  InvestigationReportData,
  LienResolutionReport,
  MatchedComplaint,
  NetworkCluster,
  PrecisionLienCalculation,
  RiskCategory,
  RiskWeightsConfig,
  TraceParameters,
  TraceResult,
  TransactionRecord,
  TransactionsQueryResponse,
  TwoAccountPathResult,
} from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) {
    const errObj = json as { error?: string };
    throw new Error(errObj?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export const api = {
  getDatasets: () =>
    request<{ activeDatasetId: string; datasets: DatasetMetadata[] }>('/api/datasets'),

  selectDataset: (datasetId: string) =>
    request<{ activeDatasetId: string; dataset: DatasetMetadata }>('/api/datasets/select', {
      method: 'POST',
      body: JSON.stringify({ datasetId }),
    }),

  resetDemo: () =>
    request<{ message: string; activeDatasetId: string; dataset: DatasetMetadata }>(
      '/api/datasets/demo/reset',
      { method: 'POST' },
    ),

  uploadDataset: (payload: {
    name: string;
    description?: string;
    complaintsCsv?: string;
    transactionsCsv?: string;
    complaintsRows?: Record<string, unknown>[];
    transactionsRows?: Record<string, unknown>[];
    complaintMapping?: Record<string, string>;
    transactionMapping?: Record<string, string>;
  }) =>
    request<{
      activeDatasetId: string;
      dataset: DatasetMetadata;
      validation_summary: ImportValidationSummary;
    }>('/api/datasets/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDashboardSummary: (datasetId?: string) =>
    request<DashboardSummary>(
      `/api/dashboard/summary${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  getComplaints: (params?: {
    datasetId?: string;
    search?: string;
    matchStatus?: string;
    clusterId?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.datasetId) sp.set('datasetId', params.datasetId);
    if (params?.search) sp.set('search', params.search);
    if (params?.matchStatus) sp.set('matchStatus', params.matchStatus);
    if (params?.clusterId) sp.set('clusterId', params.clusterId);
    const qs = sp.toString();
    return request<{ total: number; complaints: MatchedComplaint[] }>(
      `/api/complaints${qs ? `?${qs}` : ''}`,
    );
  },

  getComplaintDetail: (id: string, datasetId?: string) =>
    request<{
      complaint: MatchedComplaint;
      receiver_profile: AccountProfile | null;
      default_trace: TraceResult;
    }>(
      `/api/complaints/${encodeURIComponent(id)}${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  runTrace: (payload: TraceParameters & { datasetId?: string }) =>
    request<TraceResult>('/api/traces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getNetworks: (datasetId?: string) =>
    request<{ total: number; clusters: NetworkCluster[] }>(
      `/api/networks${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  getNetworkDetail: (id: string, datasetId?: string) =>
    request<{
      cluster: NetworkCluster;
      linked_complaints: MatchedComplaint[];
      member_accounts: AccountProfile[];
    }>(
      `/api/networks/${encodeURIComponent(id)}${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  traceNetworkPath: (
    clusterId: string,
    payload: { source: string; target: string; datasetId?: string },
  ) =>
    request<TwoAccountPathResult>(`/api/networks/${encodeURIComponent(clusterId)}/path`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getTransactions: (params?: {
    datasetId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    minAmount?: number;
    maxAmount?: number;
    sender?: string;
    receiver?: string;
    riskLevel?: string;
    channel?: string;
    status?: string;
    onlySuspicious?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params?.datasetId) sp.set('datasetId', params.datasetId);
    if (params?.search) sp.set('search', params.search);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    if (params?.minAmount !== undefined) sp.set('minAmount', String(params.minAmount));
    if (params?.maxAmount !== undefined) sp.set('maxAmount', String(params.maxAmount));
    if (params?.sender) sp.set('sender', params.sender);
    if (params?.receiver) sp.set('receiver', params.receiver);
    if (params?.riskLevel && params.riskLevel !== 'ALL') sp.set('riskLevel', params.riskLevel);
    if (params?.channel && params.channel !== 'ALL') sp.set('channel', params.channel);
    if (params?.status && params.status !== 'ALL') sp.set('status', params.status);
    if (params?.onlySuspicious) sp.set('onlySuspicious', 'true');
    const qs = sp.toString();
    return request<TransactionsQueryResponse>(`/api/transactions${qs ? `?${qs}` : ''}`);
  },

  getAccounts: (params?: {
    datasetId?: string;
    risk?: string;
    role?: string;
    search?: string;
    includeVictims?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params?.datasetId) sp.set('datasetId', params.datasetId);
    if (params?.risk) sp.set('risk', params.risk);
    if (params?.role) sp.set('role', params.role);
    if (params?.search) sp.set('search', params.search);
    if (params?.includeVictims) sp.set('includeVictims', 'true');
    const qs = sp.toString();
    return request<{ total: number; accounts: AccountProfile[] }>(
      `/api/accounts${qs ? `?${qs}` : ''}`,
    );
  },

  getAccountDetail: (upiId: string, datasetId?: string) =>
    request<{
      account: AccountProfile;
      transactions: TransactionRecord[];
      linked_complaints: MatchedComplaint[];
      neighbor_accounts: AccountProfile[];
      cluster: NetworkCluster | null;
      precision_lien_preview: PrecisionLienCalculation | null;
    }>(
      `/api/accounts/${encodeURIComponent(upiId)}${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  calculatePrecisionLien: (
    upiId: string,
    payload: {
      complaintId: string;
      datasetId?: string;
      victimDeficitOverride?: number;
    },
  ) =>
    request<PrecisionLienCalculation>(
      `/api/accounts/${encodeURIComponent(upiId)}/calculate-precision-lien`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  applyPrecisionLien: (
    upiId: string,
    payload: {
      complaintId: string;
      datasetId?: string;
      mode: 'PRECISION_LIEN' | 'FULL_FREEZE';
      reason?: string;
    },
  ) =>
    request<{
      account: AccountProfile;
      lienState: AccountLienState;
      calculation: PrecisionLienCalculation;
    }>(`/api/accounts/${encodeURIComponent(upiId)}/apply-precision-lien`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitDisputeProof: (
    upiId: string,
    payload: {
      datasetId?: string;
      invoiceNumber: string;
      gstin: string;
      counterpartyName: string;
      documentType: DisputeDocumentType;
      claimedAmount: number;
      referencedUtr: string;
    },
  ) =>
    request<{
      account: AccountProfile;
      lienState: AccountLienState;
      disputeSubmission: DisputeSubmission;
    }>(`/api/accounts/${encodeURIComponent(upiId)}/submit-dispute-proof`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resolveLien: (
    upiId: string,
    payload: {
      datasetId?: string;
      decision: 'RELEASE' | 'CONFIRM_FREEZE';
      officerName?: string;
      remarks?: string;
    },
  ) =>
    request<{
      account: AccountProfile;
      lienState: AccountLienState;
      complianceReport: LienResolutionReport;
    }>(`/api/accounts/${encodeURIComponent(upiId)}/resolve-lien`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAlerts: (datasetId?: string) =>
    request<{ total: number; alerts: AlertItem[] }>(
      `/api/alerts${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  getInvestigations: (datasetId?: string) =>
    request<{ total: number; investigations: InvestigationCase[] }>(
      `/api/investigations${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),

  createInvestigation: (payload: {
    datasetId?: string;
    title: string;
    cluster_id: string | null;
    complaint_ids: string[];
    account_ids: string[];
    evidence_transaction_ids: string[];
    assignee: string;
    priority: InvestigationCase['priority'];
    status?: InvestigationCase['status'];
    initialNote?: string;
  }) =>
    request<InvestigationCase>('/api/investigations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateInvestigation: (
    caseId: string,
    payload: {
      status?: InvestigationCase['status'];
      priority?: InvestigationCase['priority'];
      assignee?: string;
      addNote?: { author: string; content: string };
      addComplaintIds?: string[];
      addAccountIds?: string[];
      addEvidenceTxIds?: string[];
      actor?: string;
    },
  ) =>
    request<InvestigationCase>(`/api/investigations/${encodeURIComponent(caseId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  generateReport: (payload: {
    caseId: string;
    includeAiSummary: boolean;
    datasetId?: string;
  }) =>
    request<InvestigationReportData>('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  explainWithAi: (payload: {
    datasetId?: string;
    question: string;
    contextType: 'DATASET' | 'CLUSTER' | 'ACCOUNT' | 'COMPLAINT' | 'TRACE' | 'CASE';
    entityId?: string;
  }) =>
    request<AiStructuredExplanation>('/api/ai/explain', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRiskConfig: () =>
    request<{ config: RiskWeightsConfig; disclaimer: string }>('/api/settings/risk-config'),

  updateRiskConfig: (config: RiskWeightsConfig) =>
    request<{ config: RiskWeightsConfig }>('/api/settings/risk-config', {
      method: 'PATCH',
      body: JSON.stringify(config),
    }),

  globalSearch: (q: string, datasetId?: string) =>
    request<GlobalSearchResult>(
      `/api/search?q=${encodeURIComponent(q)}${datasetId ? `&datasetId=${encodeURIComponent(datasetId)}` : ''}`,
    ),
};

// ---------------------------------------------------------------------------
// Formatting & Export Utilities
// ---------------------------------------------------------------------------
export function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function formatShortINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(2)} L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function accountStatusTextColor(status: AccountStatus): string {
  switch (status) {
    case 'Precision Lien Active':
      return 'text-amber-400';
    case 'Full Freeze':
      return 'text-red-400';
    case 'Under Investigation':
      return 'text-sky-400';
    default:
      return 'text-emerald-400';
  }
}

export function riskTextColor(cat: RiskCategory): string {
  if (cat === 'HIGH') return 'text-red-400';
  if (cat === 'MEDIUM') return 'text-amber-400';
  return 'text-emerald-400';
}

export function riskHexColor(cat: RiskCategory): string {
  if (cat === 'HIGH') return '#EF4444';
  if (cat === 'MEDIUM') return '#F59E0B';
  return '#10B981';
}

export function roleDisplayLabel(role: string): string {
  switch (role) {
    case 'VICTIM':
      return 'Victim';
    case 'INITIAL_RECIPIENT':
      return 'Initial Recipient';
    case 'INTERMEDIARY':
      return 'Intermediary';
    case 'DOWNSTREAM':
      return 'Downstream';
    default:
      return 'Control';
  }
}

export function downloadCsvFile(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const escapeCell = (val: string | number | boolean | null | undefined) => {
    const str = String(val ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
