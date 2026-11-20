import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Clock,
  FileBarChart2,
  GitBranch,
  MessageSquarePlus,
  Pin,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  DatasetMetadata,
  InvestigationCase,
  InvestigationStatus,
  MatchedComplaint,
  NetworkCluster,
  PriorityLevel,
} from '../shared/types';
import { api, formatDateTime, formatINR } from '../lib/api';
import { ConfirmDialog } from '../components/UiPrimitives';

interface InvestigationsViewProps {
  datasetId: string;
  activeDataset: DatasetMetadata | null;
  cases: InvestigationCase[];
  clusters: NetworkCluster[];
  complaints: MatchedComplaint[];
  selectedCaseId: string | null;
  activeCaseId: string | null;
  draftPrefill: {
    title: string;
    cluster_id: string | null;
    complaint_ids: string[];
    account_ids: string[];
    evidence_transaction_ids: string[];
  } | null;
  onClearDraftPrefill: () => void;
  onSelectCase: (caseId: string) => void;
  onPinActiveCase: (caseId: string) => void;
  onCasesChanged: () => Promise<void>;
  onOpenAccount: (upiId: string) => void;
  onTraceComplaint: (complaintId: string) => void;
  onGenerateReport: (caseId: string) => void;
  onAskAiAboutCase: (caseId: string) => void;
}

const STATUSES: InvestigationStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'ESCALATED',
  'REPORT_GENERATED',
  'CLOSED',
];

const PRIORITIES: PriorityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const ASSIGNEES = [
  'Insp. R. Deshmukh',
  'SI Ananya Nair',
  'Analyst V. Kulkarni',
  'ACP S. Raghavan',
];

export const InvestigationsView: React.FC<InvestigationsViewProps> = ({
  datasetId,
  activeDataset,
  cases,
  clusters,
  complaints,
  selectedCaseId,
  activeCaseId,
  draftPrefill,
  onClearDraftPrefill,
  onSelectCase,
  onPinActiveCase,
  onCasesChanged,
  onOpenAccount,
  onTraceComplaint,
  onGenerateReport,
  onAskAiAboutCase,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'created_at' | 'total_reported_amount' | 'title'>('created_at');
  const [sortDesc, setSortDesc] = useState(true);

  // Create Case Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newClusterId, setNewClusterId] = useState<string>('');
  const [newAssignee, setNewAssignee] = useState(ASSIGNEES[0]);
  const [newPriority, setNewPriority] = useState<PriorityLevel>('HIGH');
  const [newNote, setNewNote] = useState('');
  const [newComplaintIds, setNewComplaintIds] = useState<string[]>([]);
  const [newAccountIds, setNewAccountIds] = useState<string[]>([]);
  const [newEvidenceTxIds, setNewEvidenceTxIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Case Dossier Edit states
  const [noteInput, setNoteInput] = useState('');
  const [attachComplaint, setAttachComplaint] = useState('');
  const [attachTxId, setAttachTxId] = useState('');
  const [updating, setUpdating] = useState(false);

  // Confirm Dialog before closing a case
  const [pendingCloseStatus, setPendingCloseStatus] = useState(false);

  const activeCase =
    cases.find((c) => c.case_id === selectedCaseId) ?? cases[0] ?? null;

  useEffect(() => {
    if (draftPrefill) {
      setNewTitle(draftPrefill.title);
      setNewClusterId(draftPrefill.cluster_id ?? '');
      setNewComplaintIds(draftPrefill.complaint_ids);
      setNewAccountIds(draftPrefill.account_ids);
      setNewEvidenceTxIds(draftPrefill.evidence_transaction_ids);
      setNewPriority('HIGH');
      setNewNote('');
      setCreateOpen(true);
      onClearDraftPrefill();
    }
  }, [draftPrefill, onClearDraftPrefill]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...cases]
      .filter((c) => {
        if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
        if (!q) return true;
        return (
          c.case_id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.assignee.toLowerCase().includes(q) ||
          (c.cluster_id && c.cluster_id.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
        else if (sortBy === 'total_reported_amount')
          cmp = a.total_reported_amount - b.total_reported_amount;
        else cmp = a.title.localeCompare(b.title);
        return sortDesc ? -cmp : cmp;
      });
  }, [cases, search, statusFilter, sortBy, sortDesc]);

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDesc((v) => !v);
    else {
      setSortBy(field);
      setSortDesc(true);
    }
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const created = await api.createInvestigation({
        datasetId,
        title: newTitle.trim(),
        cluster_id: newClusterId || null,
        complaint_ids: newComplaintIds,
        account_ids: newAccountIds,
        evidence_transaction_ids: newEvidenceTxIds,
        assignee: newAssignee,
        priority: newPriority,
        initialNote: newNote.trim() || undefined,
      });
      await onCasesChanged();
      onSelectCase(created.case_id);
      onPinActiveCase(created.case_id);
      setCreateOpen(false);
      setNewTitle('');
      setNewNote('');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCase = async (payload: Parameters<typeof api.updateInvestigation>[1]) => {
    if (!activeCase) return;
    setUpdating(true);
    try {
      await api.updateInvestigation(activeCase.case_id, {
        ...payload,
        actor: activeCase.assignee,
      });
      await onCasesChanged();
    } finally {
      setUpdating(false);
    }
  };

  const priorityColor = (p: PriorityLevel) => {
    if (p === 'CRITICAL') return 'text-[#EF4444]';
    if (p === 'HIGH') return 'text-[#F97316]';
    if (p === 'MEDIUM') return 'text-[#EAB308]';
    return 'text-[#22C55E]';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#263449]">
        <div>
          <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight">
            Investigations
          </h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Manage financial crime cases, pin your active investigation, attach evidence references, and maintain an immutable audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewTitle('');
            setNewClusterId(clusters[0]?.cluster_id ?? '');
            setNewComplaintIds([]);
            setNewAccountIds([]);
            setNewEvidenceTxIds([]);
            setNewNote('');
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Investigation</span>
        </button>
      </div>

      {/* Search & Filter Strip */}
      <div className="bg-[#151F30] border border-[#263449] rounded-md p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Case ID, investigation name, investigator, or cluster..."
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md pl-9 pr-3 py-1.5 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none"
          />
        </div>
        <select
          aria-label="Filter by case status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0B1120] border border-[#263449] rounded-md px-3 py-1.5 text-xs text-[#F1F5F9]"
        >
          <option value="ALL">All Statuses</option>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {st.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Searchable, Sortable Cases Table */}
      <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#101827] text-[#94A3B8] border-b border-[#263449]">
              <tr>
                <th className="px-4 py-3 font-medium">Case ID</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('title')}
                    className="inline-flex items-center gap-1 hover:text-[#F1F5F9]"
                  >
                    <span>Investigation Name</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('created_at')}
                    className="inline-flex items-center gap-1 hover:text-[#F1F5F9]"
                  >
                    <span>Date Created</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Assigned Investigator</th>
                <th className="px-4 py-3 font-medium">Uploaded Files</th>
                <th className="px-4 py-3 font-medium">Analysis Status</th>
                <th className="px-4 py-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('total_reported_amount')}
                    className="inline-flex items-center gap-1 hover:text-[#F1F5F9]"
                  >
                    <span>Exposure</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#263449]">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#94A3B8]">
                    No investigations match your current search or filter.
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const isSelected = activeCase?.case_id === c.case_id;
                  const isPinned = activeCaseId === c.case_id;
                  return (
                    <tr
                      key={c.case_id}
                      onClick={() => onSelectCase(c.case_id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#1D2B44]' : 'hover:bg-[#19253A]'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-[#3B82F6] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{c.case_id}</span>
                          {isPinned && (
                            <span
                              title="Pinned as current investigation in top bar"
                              className="text-[10px] font-sans font-medium text-[#22C55E]"
                            >
                              (Active)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#F1F5F9] font-medium">
                        {c.title}
                        <span className={`ml-2 font-mono text-[11px] ${priorityColor(c.priority)}`}>
                          · {c.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#94A3B8] whitespace-nowrap">
                        {c.status.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#94A3B8] whitespace-nowrap">
                        {formatDateTime(c.created_at)}
                      </td>
                      <td className="px-4 py-3 text-[#E2E8F0] whitespace-nowrap">{c.assignee}</td>
                      <td className="px-4 py-3 text-[#94A3B8] font-mono text-[11px] whitespace-nowrap">
                        {activeDataset?.source_type === 'SYNTHETIC_DEMO'
                          ? '2 files (Demo Ledger)'
                          : activeDataset?.name || 'Dataset'}
                      </td>
                      <td className="px-4 py-3 text-[11px] whitespace-nowrap">
                        <span className="text-[#22C55E] font-medium">
                          Analyzed ({c.account_ids.length} accounts)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-[#F1F5F9] whitespace-nowrap">
                        {formatINR(c.total_reported_amount)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Case Workspace Dossier */}
      {activeCase && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case Controls & Evidence (Left 2 cols) */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-[#151F30] border border-[#263449] rounded-md p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#263449]">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-[#3B82F6] font-semibold">{activeCase.case_id}</span>
                    {activeCase.cluster_id && (
                      <>
                        <span className="text-[#475569]">·</span>
                        <span className="text-[#94A3B8]">{activeCase.cluster_id}</span>
                      </>
                    )}
                  </div>
                  <h2 className="text-base font-semibold text-[#F1F5F9] mt-1">
                    {activeCase.title}
                  </h2>
                  <div className="text-xs text-[#94A3B8] mt-1 font-mono tabular-nums">
                    {activeCase.complaint_ids.length} complaints · {activeCase.account_ids.length} linked accounts · Exposure: {formatINR(activeCase.total_reported_amount)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeCaseId !== activeCase.case_id && (
                    <button
                      type="button"
                      onClick={() => onPinActiveCase(activeCase.case_id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                    >
                      <Pin className="w-3.5 h-3.5 text-[#3B82F6]" />
                      <span>Set as Active</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onAskAiAboutCase(activeCase.case_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
                    <span>AI Briefing</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onGenerateReport(activeCase.case_id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white"
                  >
                    <FileBarChart2 className="w-3.5 h-3.5" />
                    <span>Open in Reports</span>
                  </button>
                </div>
              </div>

              {/* Status, Priority, Assignee */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                    Workflow Status
                  </label>
                  <select
                    disabled={updating}
                    value={activeCase.status}
                    onChange={(e) => {
                      const next = e.target.value as InvestigationStatus;
                      if (next === 'CLOSED' && activeCase.status !== 'CLOSED') {
                        setPendingCloseStatus(true);
                      } else {
                        handleUpdateCase({ status: next });
                      }
                    }}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9] font-mono"
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                    Priority
                  </label>
                  <select
                    disabled={updating}
                    value={activeCase.priority}
                    onChange={(e) =>
                      handleUpdateCase({ priority: e.target.value as PriorityLevel })
                    }
                    className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9] font-mono"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                    Assigned Investigator
                  </label>
                  <select
                    disabled={updating}
                    value={activeCase.assignee}
                    onChange={(e) => handleUpdateCase({ assignee: e.target.value })}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9]"
                  >
                    {ASSIGNEES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Linked Accounts & Complaints */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#263449] text-xs">
                <div>
                  <div className="text-[11px] font-semibold text-[#94A3B8] mb-2">
                    Linked Accounts ({activeCase.account_ids.length})
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[11px]">
                    {activeCase.account_ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onOpenAccount(id)}
                        className="text-[#93C5FD] hover:underline"
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-[#94A3B8] mb-2">
                    Attached Complaints ({activeCase.complaint_ids.length})
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[11px]">
                    {activeCase.complaint_ids.map((cid) => (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => onTraceComplaint(cid)}
                        className="inline-flex items-center gap-0.5 text-[#3B82F6] hover:underline"
                      >
                        <GitBranch className="w-2.5 h-2.5" />
                        {cid}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <select
                      value={attachComplaint}
                      onChange={(e) => setAttachComplaint(e.target.value)}
                      className="flex-1 bg-[#0B1120] border border-[#263449] rounded px-2 py-1 text-[11px] font-mono text-[#F1F5F9]"
                    >
                      <option value="">Attach complaint...</option>
                      {complaints
                        .filter((c) => !activeCase.complaint_ids.includes(c.complaint_id))
                        .map((c) => (
                          <option key={c.complaint_id} value={c.complaint_id}>
                            {c.complaint_id} ({c.receiver_upi})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!attachComplaint || updating}
                      onClick={async () => {
                        if (!attachComplaint) return;
                        await handleUpdateCase({ addComplaintIds: [attachComplaint] });
                        setAttachComplaint('');
                      }}
                      className="px-2.5 py-1 rounded bg-[#101827] hover:bg-[#1E2B42] text-[11px] text-[#F1F5F9] border border-[#263449] disabled:opacity-40"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              </div>

              {/* Evidence Transaction References */}
              <div className="pt-4 border-t border-[#263449] text-xs">
                <div className="text-[11px] font-semibold text-[#94A3B8] mb-1.5">
                  Evidence Transaction References ({activeCase.evidence_transaction_ids.length})
                </div>
                <div className="font-mono text-[11px] text-[#E2E8F0] leading-relaxed">
                  {activeCase.evidence_transaction_ids.join(' · ') || 'None recorded'}
                </div>
                <div className="mt-2.5 flex items-center gap-2 max-w-md">
                  <input
                    type="text"
                    value={attachTxId}
                    onChange={(e) => setAttachTxId(e.target.value)}
                    placeholder="Add Transaction ID or UTR reference..."
                    className="flex-1 bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-[11px] font-mono text-[#F1F5F9] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!attachTxId.trim() || updating}
                    onClick={async () => {
                      if (!attachTxId.trim()) return;
                      await handleUpdateCase({ addEvidenceTxIds: [attachTxId.trim()] });
                      setAttachTxId('');
                    }}
                    className="px-3 py-1.5 rounded bg-[#101827] hover:bg-[#1E2B42] text-[11px] text-[#F1F5F9] border border-[#263449] disabled:opacity-40"
                  >
                    Add Reference
                  </button>
                </div>
              </div>
            </div>

            {/* Investigator Notes & Conclusions */}
            <div className="bg-[#151F30] border border-[#263449] rounded-md p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#F1F5F9]">
                  Investigator Notes &amp; Conclusions
                </h3>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Notes logged here are included separately from automated findings in your exported investigation report.
                </p>
              </div>
              <div className="space-y-3">
                {activeCase.notes.length === 0 ? (
                  <div className="text-xs text-[#94A3B8]">No notes logged on this case yet.</div>
                ) : (
                  activeCase.notes.map((n) => (
                    <div
                      key={n.id}
                      className="bg-[#101827] border border-[#263449] rounded p-3 text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                        <span className="font-semibold text-[#F1F5F9]">{n.author}</span>
                        <span className="font-mono">{formatDateTime(n.timestamp)}</span>
                      </div>
                      <p className="text-[#E2E8F0] leading-relaxed">{n.content}</p>
                    </div>
                  ))
                )}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!noteInput.trim()) return;
                  await handleUpdateCase({
                    addNote: { author: activeCase.assignee, content: noteInput.trim() },
                  });
                  setNoteInput('');
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Add timestamped investigator note or verification conclusion..."
                  className="flex-1 bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-xs text-[#F1F5F9] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!noteInput.trim() || updating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#3B82F6] hover:bg-blue-500 text-xs font-semibold text-white disabled:opacity-40"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Log Note</span>
                </button>
              </form>
            </div>
          </div>

          {/* Immutable Audit Trail (Right 1 col) */}
          <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden flex flex-col max-h-[660px]">
            <div className="px-5 py-3.5 bg-[#101827] border-b border-[#263449] flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#F1F5F9]">
                <Clock className="w-4 h-4 text-[#3B82F6]" />
                <span>Audit Trail ({activeCase.audit_log.length})</span>
              </div>
            </div>
            <div className="divide-y divide-[#263449] overflow-y-auto p-4 space-y-3 text-xs">
              {[...activeCase.audit_log].reverse().map((entry) => (
                <div key={entry.id} className="pt-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-[#3B82F6]">
                      {entry.action}
                    </span>
                    <span className="font-mono text-[#64748B]">
                      {formatDateTime(entry.timestamp)}
                    </span>
                  </div>
                  <p className="text-[#E2E8F0] mt-1 leading-snug">{entry.details}</p>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">Actor: {entry.actor}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Case Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCase}
            className="bg-[#151F30] border border-[#263449] rounded-lg w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 bg-[#101827] border-b border-[#263449] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Create Investigation</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-[#94A3B8] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-[#F1F5F9] font-medium mb-1">Investigation Name</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Layering Network Inquiry — Hub Alpha"
                  className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-[#F1F5F9] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#F1F5F9] font-medium mb-1">
                  Link Detected Network Cluster (Optional)
                </label>
                <select
                  value={newClusterId}
                  onChange={(e) => setNewClusterId(e.target.value)}
                  className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9]"
                >
                  <option value="">None (Manual / Account-Specific)</option>
                  {clusters.map((cl) => (
                    <option key={cl.cluster_id} value={cl.cluster_id}>
                      {cl.cluster_id} — {cl.name} ({cl.complaint_ids.length} complaints)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#F1F5F9] font-medium mb-1">
                    Assigned Investigator
                  </label>
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9]"
                  >
                    {ASSIGNEES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[#F1F5F9] font-medium mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as PriorityLevel)}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-[#F1F5F9]"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(newAccountIds.length > 0 || newComplaintIds.length > 0) && (
                <div className="p-3 bg-[#101827] border border-[#263449] rounded font-mono text-[11px] text-[#94A3B8] space-y-1">
                  <div>Pre-attached accounts: {newAccountIds.length}</div>
                  <div>Pre-attached complaints: {newComplaintIds.length}</div>
                  <div>Pre-attached evidence references: {newEvidenceTxIds.length}</div>
                </div>
              )}

              <div>
                <label className="block text-[#F1F5F9] font-medium mb-1">
                  Initial Investigator Note
                </label>
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Document initial lead and verification steps required..."
                  className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-[#F1F5F9] focus:outline-none"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-[#263449] bg-[#101827] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3.5 py-2 rounded-md text-xs text-[#94A3B8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-md bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {saving ? 'Creating...' : 'Create Investigation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Dialog for Closing Investigation */}
      <ConfirmDialog
        isOpen={pendingCloseStatus}
        title="Close Investigation Case?"
        description={`You are about to mark ${activeCase?.case_id ?? 'this case'} as CLOSED. Closed cases remain readable for audit and report generation, and can be reopened later if new evidence emerges.`}
        confirmLabel="Mark Case Closed"
        destructive={false}
        onCancel={() => setPendingCloseStatus(false)}
        onConfirm={async () => {
          setPendingCloseStatus(false);
          await handleUpdateCase({ status: 'CLOSED' });
        }}
      />
    </div>
  );
};
