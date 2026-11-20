/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountProfile,
  AlertItem,
  DashboardSummary,
  DatasetMetadata,
  InvestigationCase,
  MatchedComplaint,
  NetworkCluster,
} from './shared/types';
import { api } from './lib/api';
import { Layout, type NavTab } from './components/Layout';
import { DatasetUploadModal } from './components/DatasetUploadModal';
import { AiAssistantDrawer, type AiContextTarget } from './components/AiAssistantDrawer';
import { OverviewView, type ChecklistProgress } from './views/OverviewView';
import {
  TransactionAnalysisView,
  type TransactionSubTab,
} from './views/TransactionAnalysisView';
import { NetworkExplorerView } from './views/NetworkExplorerView';
import { SuspiciousAccountsView } from './views/SuspiciousAccountsView';
import { AccountDetailView } from './views/AccountDetailView';
import { InvestigationsView } from './views/InvestigationsView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [datasets, setDatasets] = useState<DatasetMetadata[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [complaints, setComplaints] = useState<MatchedComplaint[]>([]);
  const [clusters, setClusters] = useState<NetworkCluster[]>([]);
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [totalTransactionVolume, setTotalTransactionVolume] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);

  // Guided workflow checklist progress
  const [checklist, setChecklist] = useState<ChecklistProgress>({
    reviewedData: true,
    exploredNetwork: false,
    tracedFunds: false,
    inspectedAccount: false,
    previewedReport: false,
  });

  // Cross-view selection state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedTraceComplaintId, setSelectedTraceComplaintId] = useState<string | null>(null);
  const [transactionSubTab, setTransactionSubTab] = useState<TransactionSubTab>('ledger');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [reportCaseId, setReportCaseId] = useState<string | null>(null);
  const [caseDraftPrefill, setCaseDraftPrefill] = useState<{
    title: string;
    cluster_id: string | null;
    complaint_ids: string[];
    account_ids: string[];
    evidence_transaction_ids: string[];
  } | null>(null);

  // Modals / Drawers
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContext, setAiContext] = useState<AiContextTarget>({
    contextType: 'DATASET',
    label: 'Active Dataset Workspace',
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3600);
  }, []);

  const loadWorkspaceData = useCallback(
    async (targetDatasetId?: string) => {
      setLoading(true);
      try {
        const dsRes = await api.getDatasets();
        setDatasets(dsRes.datasets);
        const effectiveId = targetDatasetId || dsRes.activeDatasetId;
        setActiveDatasetId(effectiveId);

        const [sumRes, cmpRes, netRes, acctRes, alertRes, invRes, txRes] = await Promise.all([
          api.getDashboardSummary(effectiveId),
          api.getComplaints({ datasetId: effectiveId }),
          api.getNetworks(effectiveId),
          api.getAccounts({ datasetId: effectiveId }),
          api.getAlerts(effectiveId),
          api.getInvestigations(effectiveId),
          api.getTransactions({ datasetId: effectiveId }),
        ]);

        setSummary(sumRes);
        setComplaints(cmpRes.complaints);
        setClusters(netRes.clusters);
        setAccounts(acctRes.accounts);
        setAlerts(alertRes.alerts);
        setCases(invRes.investigations);
        setTotalTransactionVolume(txRes.summary.total_volume);

        if (invRes.investigations.length > 0) {
          setActiveCaseId((prev) =>
            prev && invRes.investigations.some((c) => c.case_id === prev)
              ? prev
              : invRes.investigations[0].case_id,
          );
        } else {
          setActiveCaseId(null);
        }

        if (netRes.clusters.length > 0) {
          setSelectedClusterId((prev) =>
            prev && netRes.clusters.some((c) => c.cluster_id === prev)
              ? prev
              : netRes.clusters[0].cluster_id,
          );
        } else {
          setSelectedClusterId(null);
        }

        if (cmpRes.complaints.length > 0) {
          setSelectedTraceComplaintId((prev) =>
            prev && cmpRes.complaints.some((c) => c.complaint_id === prev)
              ? prev
              : cmpRes.complaints[0].complaint_id,
          );
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to load workspace data.');
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  const handleLoadDemo = async () => {
    try {
      const res = await api.resetDemo();
      setSelectedAccountId(null);
      setSelectedClusterId(null);
      setSelectedCaseId(null);
      await loadWorkspaceData(res.activeDatasetId);
      setActiveTab('overview');
      showToast('Loaded 50-complaint synthetic demonstration workspace.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reset demo workspace.');
    }
  };

  const refreshCases = useCallback(async () => {
    if (!activeDatasetId) return;
    const [invRes, sumRes] = await Promise.all([
      api.getInvestigations(activeDatasetId),
      api.getDashboardSummary(activeDatasetId),
    ]);
    setCases(invRes.investigations);
    setSummary(sumRes);
  }, [activeDatasetId]);

  const refreshAccounts = useCallback(
    async (message?: string) => {
      if (!activeDatasetId) return;
      const [acctRes, sumRes] = await Promise.all([
        api.getAccounts({ datasetId: activeDatasetId }),
        api.getDashboardSummary(activeDatasetId),
      ]);
      setAccounts(acctRes.accounts);
      setSummary(sumRes);
      if (message) {
        showToast(message);
      }
    },
    [activeDatasetId, showToast],
  );

  const openAccountProfile = (upiId: string) => {
    setSelectedAccountId(upiId);
    setActiveTab('account-detail');
    setChecklist((prev) => ({ ...prev, inspectedAccount: true }));
    setAiContext({
      contextType: 'ACCOUNT',
      entityId: upiId,
      label: `Account ${upiId}`,
    });
  };

  const openComplaintTrace = (complaintId: string) => {
    setSelectedTraceComplaintId(complaintId);
    setTransactionSubTab('tracer');
    setActiveTab('transactions');
    setChecklist((prev) => ({ ...prev, tracedFunds: true }));
    setAiContext({
      contextType: 'COMPLAINT',
      entityId: complaintId,
      label: `Complaint ${complaintId}`,
    });
  };

  const openClusterNetwork = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setActiveTab('network');
    setChecklist((prev) => ({ ...prev, exploredNetwork: true }));
    setAiContext({
      contextType: 'CLUSTER',
      entityId: clusterId,
      label: `Cluster ${clusterId}`,
    });
  };

  const openCaseDossier = (caseId: string) => {
    setSelectedCaseId(caseId);
    setActiveCaseId(caseId);
    setActiveTab('investigations');
    setAiContext({
      contextType: 'CASE',
      entityId: caseId,
      label: `Case ${caseId}`,
    });
  };

  const handleCreateCaseFromCluster = (cluster: NetworkCluster) => {
    setCaseDraftPrefill({
      title: `Cluster Investigation: ${cluster.name}`,
      cluster_id: cluster.cluster_id,
      complaint_ids: cluster.complaint_ids,
      account_ids: cluster.shared_recipient_accounts,
      evidence_transaction_ids: cluster.edges.slice(0, 15).map((e) => e.id),
    });
    setActiveTab('investigations');
  };

  const handleCreateCaseFromAccount = (account: AccountProfile) => {
    setCaseDraftPrefill({
      title: `Account Review: ${account.upi_id}`,
      cluster_id: account.cluster_id,
      complaint_ids: account.connected_complaints,
      account_ids: [account.upi_id],
      evidence_transaction_ids: account.supporting_transaction_ids.slice(0, 12),
    });
    setActiveTab('investigations');
  };

  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const activeCase = useMemo(
    () => cases.find((c) => c.case_id === activeCaseId) ?? cases[0] ?? null,
    [cases, activeCaseId],
  );

  return (
    <>
      <Layout
        activeTab={activeTab}
        onNavigate={(tab) => {
          setActiveTab(tab);
          if (tab === 'network') {
            setChecklist((prev) => ({ ...prev, exploredNetwork: true }));
          } else if (tab === 'reports') {
            setChecklist((prev) => ({ ...prev, previewedReport: true }));
          } else if (tab === 'overview') {
            setAiContext({
              contextType: 'DATASET',
              label: activeDataset?.name || 'Active Dataset',
            });
          }
        }}
        datasets={datasets}
        activeDatasetId={activeDatasetId}
        activeCase={activeCase}
        cases={cases}
        onSelectActiveCase={(cid) => {
          setActiveCaseId(cid);
          setSelectedCaseId(cid);
        }}
        onOpenUpload={() => setUploadModalOpen(true)}
        onOpenAiAssistant={() => setAiOpen(true)}
        alerts={alerts}
        onJumpToAccount={openAccountProfile}
        onJumpToComplaint={openComplaintTrace}
        onJumpToCluster={openClusterNetwork}
        onJumpToCase={openCaseDossier}
      >
        {activeTab === 'overview' && (
          <OverviewView
            summary={summary}
            datasets={datasets}
            cases={cases}
            alerts={alerts}
            totalTransactionVolume={totalTransactionVolume}
            checklist={checklist}
            loading={loading}
            onOpenUpload={() => setUploadModalOpen(true)}
            onCreateInvestigation={() => {
              setCaseDraftPrefill({
                title: 'New UPI Fraud Network Investigation',
                cluster_id: clusters[0]?.cluster_id ?? null,
                complaint_ids: complaints.slice(0, 5).map((c) => c.complaint_id),
                account_ids: accounts.slice(0, 3).map((a) => a.upi_id),
                evidence_transaction_ids: [],
              });
              setActiveTab('investigations');
            }}
            onSelectCase={openCaseDossier}
            onSelectAccount={openAccountProfile}
            onSelectCluster={openClusterNetwork}
            onGoToTransactions={() => {
              setTransactionSubTab('ledger');
              setActiveTab('transactions');
            }}
            onGoToNetwork={() => {
              setChecklist((prev) => ({ ...prev, exploredNetwork: true }));
              setActiveTab('network');
            }}
            onGoToTracing={() => {
              setTransactionSubTab('tracer');
              setChecklist((prev) => ({ ...prev, tracedFunds: true }));
              setActiveTab('transactions');
            }}
            onGoToAccounts={() => setActiveTab('accounts')}
            onGoToReports={() => {
              setChecklist((prev) => ({ ...prev, previewedReport: true }));
              setActiveTab('reports');
            }}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionAnalysisView
            datasetId={activeDatasetId}
            complaints={complaints}
            initialSubTab={transactionSubTab}
            initialComplaintId={selectedTraceComplaintId}
            onSubTabChange={(tab) => {
              setTransactionSubTab(tab);
              if (tab === 'tracer') {
                setChecklist((prev) => ({ ...prev, tracedFunds: true }));
              }
            }}
            onSelectAccount={openAccountProfile}
            onSelectCluster={openClusterNetwork}
            onOpenUpload={() => setUploadModalOpen(true)}
            onAskAiAboutComplaint={(cid) => {
              setAiContext({
                contextType: 'COMPLAINT',
                entityId: cid,
                label: `Trace for ${cid}`,
              });
              setAiOpen(true);
            }}
            onAccountUpdated={refreshAccounts}
          />
        )}

        {activeTab === 'network' && (
          <NetworkExplorerView
            datasetId={activeDatasetId}
            clusters={clusters}
            selectedClusterId={selectedClusterId}
            onSelectCluster={setSelectedClusterId}
            onOpenAccountProfile={openAccountProfile}
            onCreateCaseFromCluster={handleCreateCaseFromCluster}
            onAskAiAboutCluster={(cluster) => {
              setAiContext({
                contextType: 'CLUSTER',
                entityId: cluster.cluster_id,
                label: `${cluster.cluster_id} — ${cluster.name}`,
              });
              setAiOpen(true);
            }}
          />
        )}

        {activeTab === 'accounts' && (
          <SuspiciousAccountsView
            accounts={accounts}
            loading={loading}
            onSelectAccount={openAccountProfile}
          />
        )}

        {activeTab === 'account-detail' && selectedAccountId && (
          <AccountDetailView
            datasetId={activeDatasetId}
            upiId={selectedAccountId}
            onBack={() => setActiveTab('accounts')}
            onSelectAccount={openAccountProfile}
            onTraceComplaint={openComplaintTrace}
            onSelectCluster={openClusterNetwork}
            onCreateCaseFromAccount={handleCreateCaseFromAccount}
            onAskAiAboutAccount={(upiId) => {
              setAiContext({
                contextType: 'ACCOUNT',
                entityId: upiId,
                label: `Account ${upiId}`,
              });
              setAiOpen(true);
            }}
            onAccountUpdated={refreshAccounts}
          />
        )}

        {activeTab === 'investigations' && (
          <InvestigationsView
            datasetId={activeDatasetId}
            activeDataset={activeDataset}
            cases={cases}
            clusters={clusters}
            complaints={complaints}
            selectedCaseId={selectedCaseId}
            activeCaseId={activeCase?.case_id ?? null}
            draftPrefill={caseDraftPrefill}
            onClearDraftPrefill={() => setCaseDraftPrefill(null)}
            onSelectCase={setSelectedCaseId}
            onPinActiveCase={(cid) => {
              setActiveCaseId(cid);
              showToast(`Pinned active case ${cid}.`);
            }}
            onCasesChanged={refreshCases}
            onOpenAccount={openAccountProfile}
            onTraceComplaint={openComplaintTrace}
            onGenerateReport={(caseId) => {
              setReportCaseId(caseId);
              setChecklist((prev) => ({ ...prev, previewedReport: true }));
              setActiveTab('reports');
            }}
            onAskAiAboutCase={(caseId) => {
              setAiContext({
                contextType: 'CASE',
                entityId: caseId,
                label: `Case ${caseId}`,
              });
              setAiOpen(true);
            }}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsView
            datasetId={activeDatasetId}
            cases={cases}
            initialCaseId={reportCaseId}
            onCasesChanged={refreshCases}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            activeDataset={activeDataset}
            onConfigUpdated={async () => {
              await loadWorkspaceData(activeDatasetId);
              showToast('Recalculated risk scores across active dataset.');
            }}
            onResetDemo={handleLoadDemo}
            onOpenUpload={() => setUploadModalOpen(true)}
          />
        )}
      </Layout>

      {/* Dual-CSV Upload Modal */}
      <DatasetUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onImported={async (newDatasetId) => {
          await loadWorkspaceData(newDatasetId);
          showToast('Validated CSV dataset imported into workspace.');
        }}
        onLoadDemo={handleLoadDemo}
      />

      {/* MuleShield Intelligence Assistant Drawer */}
      <AiAssistantDrawer
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        datasetId={activeDatasetId}
        contextTarget={aiContext}
        onJumpToAccount={(upiId) => {
          setAiOpen(false);
          openAccountProfile(upiId);
        }}
        onJumpToComplaint={(cid) => {
          setAiOpen(false);
          openComplaintTrace(cid);
        }}
      />

      {/* Notification Toast */}
      {toast && (
        <div className="no-print fixed bottom-5 right-5 z-50 bg-[#132038] border border-sky-500/40 text-sky-100 text-xs font-medium px-4 py-2.5 rounded-md shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}

