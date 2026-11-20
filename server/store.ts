import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountKycProfile,
  AccountLienState,
  DatasetMetadata,
  DisputeSubmission,
  FraudComplaint,
  GroundTruthLabel,
  InvestigationCase,
  InvestigationReportData,
  LienResolutionReport,
  PrecisionLienCalculation,
  RiskWeightsConfig,
  TraceResult,
  TransactionRecord,
} from '../src/shared/types.ts';
import {
  ANALYSIS_VERSION,
  DEFAULT_RISK_CONFIG,
  analyzeDataset,
  computeRbiSopStatutorySchedule,
  validateAndNormalizeImport,
  type FullDatasetAnalysis,
} from './analyticsEngine.ts';
import { generateSyntheticDemoDataset } from './syntheticData.ts';

export interface StoredDataset {
  metadata: DatasetMetadata;
  complaints: FraudComplaint[];
  transactions: TransactionRecord[];
  accountKycProfiles?: Record<string, AccountKycProfile>;
  // Strictly isolated ground-truth labels for evaluation only; NEVER passed to risk engine
  groundTruth?: GroundTruthLabel[];
}

interface PersistedState {
  activeDatasetId: string;
  riskConfig: RiskWeightsConfig;
  datasets: StoredDataset[];
  investigations: InvestigationCase[];
  accountStatesByDataset: Record<string, Record<string, AccountLienState>>;
}

const DATA_DIR = path.resolve(process.cwd(), '.muleshield-data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
export const DEMO_DATASET_ID = 'demo-upi-50-v1';

class MuleShieldStore {
  private state: PersistedState;
  private analysisCache = new Map<string, FullDatasetAnalysis>();
  private stateRevision = 0;
  private traceCache = new Map<string, TraceResult>();
  private reportCache = new Map<string, InvestigationReportData>();

  constructor() {
    this.state = this.loadOrInitialize();
  }

  private buildDemoBundle(): {
    dataset: StoredDataset;
    initialAccountStates: Record<string, AccountLienState>;
  } {
    const bundle = generateSyntheticDemoDataset();
    const { complaints, transactions, summary } = validateAndNormalizeImport(
      bundle.complaints as unknown as Record<string, unknown>[],
      bundle.transactions as unknown as Record<string, unknown>[],
    );

    const uniqueAccts = new Set<string>();
    for (const c of complaints) {
      uniqueAccts.add(c.sender_upi);
      uniqueAccts.add(c.receiver_upi);
    }
    for (const t of transactions) {
      uniqueAccts.add(t.sender_upi);
      uniqueAccts.add(t.receiver_upi);
    }

    return {
      dataset: {
        metadata: {
          id: DEMO_DATASET_ID,
          name: 'National Cybercrime Demo Workspace (50 UPI Complaints)',
          description:
            'Synthetic demonstration dataset containing 50 fictional UPI fraud complaints, 100 @demo accounts, interconnected mule-like networks, circular layering, mixed funds, and legitimate commercial controls.',
          source_type: 'SYNTHETIC_DEMO',
          created_at: new Date('2026-11-19T09:00:00.000Z').toISOString(),
          analysis_version: ANALYSIS_VERSION,
          complaint_count: complaints.length,
          transaction_count: transactions.length,
          account_count: uniqueAccts.size,
          validation_summary: summary,
        },
        complaints,
        transactions,
        accountKycProfiles: bundle.accountKycProfiles,
        groundTruth: bundle.groundTruth,
      },
      initialAccountStates: bundle.initialAccountStates,
    };
  }

  private buildInitialDemoCases(demoDataset: StoredDataset): InvestigationCase[] {
    const analysis = analyzeDataset(
      demoDataset.metadata.id,
      demoDataset.complaints,
      demoDataset.transactions,
      DEFAULT_RISK_CONFIG,
      undefined,
      demoDataset.accountKycProfiles,
    );
    const cases: InvestigationCase[] = [];
    const now = new Date('2026-11-19T14:30:00.000Z').toISOString();

    if (analysis.clusters[0]) {
      const c1 = analysis.clusters[0];
      cases.push({
        case_id: 'CASE-2026-001',
        dataset_id: demoDataset.metadata.id,
        title: `Cluster Inquiry: ${c1.name}`,
        cluster_id: c1.cluster_id,
        complaint_ids: c1.complaint_ids.slice(0, 12),
        account_ids: c1.shared_recipient_accounts.slice(0, 6),
        evidence_transaction_ids: c1.edges.slice(0, 10).map((e) => e.id),
        total_reported_amount: c1.total_reported_amount,
        assignee: 'Insp. R. Deshmukh',
        priority: 'CRITICAL',
        status: 'UNDER_REVIEW',
        created_at: new Date('2026-11-18T11:20:00.000Z').toISOString(),
        updated_at: now,
        notes: [
          {
            id: 'NOTE-101',
            author: 'Insp. R. Deshmukh',
            timestamp: now,
            content:
              'Initial multi-hop FIFO trace confirms rapid dispersion from 4 shared initial receivers into hub.alpha01@demo and hub.beta02@demo within 25 minutes. Requesting institutional ledger verification for mixed-fund accounts.',
          },
        ],
        audit_log: [
          {
            id: 'AUD-101',
            timestamp: new Date('2026-11-18T11:20:00.000Z').toISOString(),
            actor: 'Insp. R. Deshmukh',
            action: 'CASE_CREATED',
            details: `Case opened from network cluster ${c1.cluster_id} covering ${c1.complaint_ids.length} linked complaints.`,
          },
          {
            id: 'AUD-102',
            timestamp: now,
            actor: 'Insp. R. Deshmukh',
            action: 'STATUS_CHANGED',
            details: 'Transitioned status from NEW to UNDER_REVIEW after verifying UTR matches.',
          },
        ],
        ...computeRbiSopStatutorySchedule(
          '2026-10-29T09:15:00.000Z',
          15000,
          'CBS-LIEN-2026-9041',
          false,
          22,
          4,
        ),
      });
    }

    if (analysis.clusters[1]) {
      const c2 = analysis.clusters[1];
      cases.push({
        case_id: 'CASE-2026-002',
        dataset_id: demoDataset.metadata.id,
        title: `Circular Flow Review: ${c2.name}`,
        cluster_id: c2.cluster_id,
        complaint_ids: c2.complaint_ids.slice(0, 10),
        account_ids: c2.shared_recipient_accounts.slice(0, 5),
        evidence_transaction_ids: c2.edges.slice(0, 8).map((e) => e.id),
        total_reported_amount: c2.total_reported_amount,
        assignee: 'SI Ananya Nair',
        priority: 'HIGH',
        status: 'ESCALATED',
        created_at: new Date('2026-11-18T15:10:00.000Z').toISOString(),
        updated_at: new Date('2026-11-19T16:05:00.000Z').toISOString(),
        notes: [
          {
            id: 'NOTE-201',
            author: 'SI Ananya Nair',
            timestamp: new Date('2026-11-19T16:05:00.000Z').toISOString(),
            content:
              'Circular layering loop identified across relay.north01@demo, relay.east02@demo, and relay.west03@demo. Escalated for senior analyst review and preliminary report drafting.',
          },
        ],
        audit_log: [
          {
            id: 'AUD-201',
            timestamp: new Date('2026-11-18T15:10:00.000Z').toISOString(),
            actor: 'SI Ananya Nair',
            action: 'CASE_CREATED',
            details: `Case opened from cluster ${c2.cluster_id}.`,
          },
          {
            id: 'AUD-202',
            timestamp: new Date('2026-11-19T16:05:00.000Z').toISOString(),
            actor: 'SI Ananya Nair',
            action: 'STATUS_CHANGED',
            details: 'Escalated status from UNDER_REVIEW to ESCALATED due to recurring circular transfers.',
          },
        ],
        ...computeRbiSopStatutorySchedule(
          '2026-10-12T10:00:00.000Z',
          22000,
          'CBS-HOLD-2026-77412',
          false,
          38,
          5,
        ),
      });
    }

    return cases;
  }

  private loadOrInitialize(): PersistedState {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed && Array.isArray(parsed.datasets) && parsed.datasets.length > 0) {
          const existingDemo = parsed.datasets.find((d) => d.metadata.id === DEMO_DATASET_ID);
          const hasLatestShowcases = Boolean(
            existingDemo?.accountKycProfiles?.['rohan.sharma19@okhdfcbank'] &&
              existingDemo?.accountKycProfiles?.['patanjalii@okaxis'] &&
              parsed.accountStatesByDataset?.[DEMO_DATASET_ID]?.['rohan.sharma19@okhdfcbank']?.statutoryDeadlines,
          );

          if (!hasLatestShowcases) {
            const { dataset: demoDataset, initialAccountStates } = this.buildDemoBundle();
            const otherDatasets = parsed.datasets.filter((d) => d.metadata.id !== DEMO_DATASET_ID);
            parsed.datasets = [demoDataset, ...otherDatasets];
            parsed.accountStatesByDataset = {
              ...(parsed.accountStatesByDataset ?? {}),
              [DEMO_DATASET_ID]: initialAccountStates,
            };
            const otherCases = (parsed.investigations ?? []).filter(
              (c) => c.dataset_id !== DEMO_DATASET_ID,
            );
            parsed.investigations = [...this.buildInitialDemoCases(demoDataset), ...otherCases];
            this.persist(parsed);
          }
          return parsed;
        }
      }
    } catch {
      // Fallback cleanly to fresh demo initialization if store file is malformed
    }

    const { dataset: demoDataset, initialAccountStates } = this.buildDemoBundle();
    const initial: PersistedState = {
      activeDatasetId: demoDataset.metadata.id,
      riskConfig: { ...DEFAULT_RISK_CONFIG },
      datasets: [demoDataset],
      investigations: this.buildInitialDemoCases(demoDataset),
      accountStatesByDataset: {
        [demoDataset.metadata.id]: initialAccountStates,
      },
    };
    this.persist(initial);
    return initial;
  }

  private persist(stateToSave: PersistedState = this.state): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(stateToSave, null, 2), 'utf-8');
    } catch {
      // Non-fatal in read-only ephemeral runtimes; in-memory state remains authoritative
    }
  }

  getActiveDatasetId(): string {
    return this.state.activeDatasetId;
  }

  getRiskConfig(): RiskWeightsConfig {
    return { ...this.state.riskConfig };
  }

  updateRiskConfig(next: RiskWeightsConfig): RiskWeightsConfig {
    this.state.riskConfig = { ...next };
    this.analysisCache.clear();
    this.persist();
    return this.getRiskConfig();
  }

  listDatasets(): DatasetMetadata[] {
    return this.state.datasets.map((d) => d.metadata);
  }

  getDataset(datasetId?: string): StoredDataset | undefined {
    const id = datasetId || this.state.activeDatasetId;
    return this.state.datasets.find((d) => d.metadata.id === id) ?? this.state.datasets[0];
  }

  setActiveDataset(datasetId: string): DatasetMetadata | null {
    const found = this.state.datasets.find((d) => d.metadata.id === datasetId);
    if (!found) return null;
    this.state.activeDatasetId = found.metadata.id;
    this.persist();
    return found.metadata;
  }

  addUploadedDataset(dataset: StoredDataset): DatasetMetadata {
    this.state.datasets.unshift(dataset);
    this.state.activeDatasetId = dataset.metadata.id;
    this.analysisCache.delete(dataset.metadata.id);
    this.persist();
    return dataset.metadata;
  }

  resetDemoWorkspace(): DatasetMetadata {
    const { dataset: demoDataset, initialAccountStates } = this.buildDemoBundle();
    const otherDatasets = this.state.datasets.filter((d) => d.metadata.id !== DEMO_DATASET_ID);
    this.state.datasets = [demoDataset, ...otherDatasets];
    this.state.activeDatasetId = DEMO_DATASET_ID;
    this.state.riskConfig = { ...DEFAULT_RISK_CONFIG };
    const otherCases = this.state.investigations.filter((c) => c.dataset_id !== DEMO_DATASET_ID);
    this.state.investigations = [...this.buildInitialDemoCases(demoDataset), ...otherCases];
    this.state.accountStatesByDataset = {
      ...(this.state.accountStatesByDataset ?? {}),
      [DEMO_DATASET_ID]: initialAccountStates,
    };
    this.stateRevision++;
    this.analysisCache.clear();
    this.traceCache.clear();
    this.persist();
    return demoDataset.metadata;
  }

  getAnalysis(datasetId?: string): { dataset: StoredDataset; analysis: FullDatasetAnalysis } {
    const dataset = this.getDataset(datasetId);
    if (!dataset) {
      throw new Error('No dataset loaded in MuleShield workspace.');
    }
    const cacheKey = `${dataset.metadata.id}:${this.stateRevision}:${JSON.stringify(this.state.riskConfig)}`;
    let analysis = this.analysisCache.get(cacheKey);
    if (!analysis) {
      analysis = analyzeDataset(
        dataset.metadata.id,
        dataset.complaints,
        dataset.transactions,
        this.state.riskConfig,
        this.state.accountStatesByDataset?.[dataset.metadata.id],
        dataset.accountKycProfiles,
      );
      this.analysisCache.set(cacheKey, analysis);
    }
    return { dataset, analysis };
  }

  private ensureDatasetAccountMap(datasetId: string): Record<string, AccountLienState> {
    if (!this.state.accountStatesByDataset) {
      this.state.accountStatesByDataset = {};
    }
    if (!this.state.accountStatesByDataset[datasetId]) {
      this.state.accountStatesByDataset[datasetId] = {};
    }
    return this.state.accountStatesByDataset[datasetId];
  }

  applyPrecisionLien(
    datasetId: string,
    accountId: string,
    calc: PrecisionLienCalculation,
    mode: 'PRECISION_LIEN' | 'FULL_FREEZE' = 'PRECISION_LIEN',
    customReason?: string,
  ): AccountLienState {
    const key = accountId.toLowerCase();
    const map = this.ensureDatasetAccountMap(datasetId);
    const now = new Date();
    const nowIso = now.toISOString();
    const addDaysIso = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
    const cbsRef = `CBS-${mode === 'FULL_FREEZE' ? 'FRZ' : 'HOLD'}-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;

    const heldAmount = mode === 'FULL_FREEZE' ? calc.totalBalance : calc.heldAmount;
    const freeAmount = Math.max(0, calc.totalBalance - heldAmount);

    const statutory = computeRbiSopStatutorySchedule(
      nowIso,
      heldAmount,
      cbsRef,
      mode === 'FULL_FREEZE',
      0,
      2,
    );

    const nextState: AccountLienState = {
      totalBalance: calc.totalBalance,
      precisionLienHold: heldAmount,
      usableCleanBalance: freeAmount,
      accountStatus: mode === 'FULL_FREEZE' ? 'Full Freeze' : 'Precision Lien Active',
      lienDetails: {
        complaintId: calc.complaintId,
        taintedReceived: calc.taintedReceived,
        heldAmount,
        freeAmount,
        appliedAt: nowIso,
        reason:
          customReason?.trim() ||
          (mode === 'FULL_FREEZE'
            ? `Account-level debit freeze (last resort per RBI Annex III) applied on ₹${calc.totalBalance.toLocaleString('en-IN')} linked to ${calc.complaintId}.`
            : calc.explanation),
        cbsReferenceId: cbsRef,
      },
      rbiSopClock: {
        stage: 'Day 0: Notice Sent',
        dayCount: 0,
        noticeSentAt: nowIso,
        customerResponseDeadline: addDaysIso(20),
        nodalReviewDeadline: addDaysIso(30),
        autoExpiryDeadline: addDaysIso(60),
      },
      ...statutory,
    };

    map[key] = nextState;
    this.stateRevision++;
    this.analysisCache.clear();
    this.persist();
    return nextState;
  }

  recordDisputeSubmission(
    datasetId: string,
    accountId: string,
    submission: DisputeSubmission,
    currentTotalBalance: number,
  ): AccountLienState {
    const key = accountId.toLowerCase();
    const map = this.ensureDatasetAccountMap(datasetId);
    const existing = map[key];
    const now = new Date();
    const nowIso = now.toISOString();
    const addDaysIso = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

    const clock = existing?.rbiSopClock ?? {
      stage: 'Days 21-30: Nodal Review',
      dayCount: 1,
      noticeSentAt: nowIso,
      customerResponseDeadline: addDaysIso(20),
      nodalReviewDeadline: addDaysIso(30),
      autoExpiryDeadline: addDaysIso(60),
    };

    const statutory = computeRbiSopStatutorySchedule(
      existing?.temporaryDebitHold?.timestamp ?? clock.noticeSentAt,
      existing?.precisionLienHold ?? 0,
      existing?.temporaryDebitHold?.cbsRef ?? existing?.lienDetails?.cbsReferenceId ?? 'CBS-HOLD-ACTIVE',
      existing?.accountStatus === 'Full Freeze',
      Math.max(clock.dayCount, 21),
      4,
    );

    const nextState: AccountLienState = {
      totalBalance: existing?.totalBalance ?? currentTotalBalance,
      precisionLienHold: existing?.precisionLienHold ?? 0,
      usableCleanBalance: existing?.usableCleanBalance ?? currentTotalBalance,
      accountStatus: existing?.accountStatus ?? 'Precision Lien Active',
      lienDetails: existing?.lienDetails,
      rbiSopClock: {
        ...clock,
        stage: 'Days 21-30: Nodal Review',
        dayCount: Math.max(clock.dayCount, 1),
        disputeSubmission: submission,
      },
      ...statutory,
    };

    map[key] = nextState;
    this.stateRevision++;
    this.analysisCache.clear();
    this.persist();
    return nextState;
  }

  resolveLien(
    datasetId: string,
    accountId: string,
    decision: 'RELEASE' | 'CONFIRM_FREEZE',
    officerName: string,
    remarks: string,
    currentTotalBalance: number,
  ): { state: AccountLienState; report: LienResolutionReport } {
    const key = accountId.toLowerCase();
    const map = this.ensureDatasetAccountMap(datasetId);
    const existing = map[key];
    const nowIso = new Date().toISOString();
    const totalBal = existing?.totalBalance ?? currentTotalBalance;
    const prevHeld = existing?.precisionLienHold ?? 0;
    const complaintId = existing?.lienDetails?.complaintId ?? 'UNSPECIFIED';
    const cbsRef = existing?.lienDetails?.cbsReferenceId ?? `CBS-RES-${Date.now().toString(36).toUpperCase()}`;

    let nextState: AccountLienState;
    let report: LienResolutionReport;

    if (decision === 'RELEASE') {
      const releaseStatutory = computeRbiSopStatutorySchedule(
        existing?.temporaryDebitHold?.timestamp ?? existing?.rbiSopClock?.noticeSentAt ?? nowIso,
        0,
        cbsRef,
        false,
        61,
        6,
      );
      nextState = {
        totalBalance: totalBal,
        precisionLienHold: 0,
        usableCleanBalance: totalBal,
        accountStatus: 'Active',
        lienDetails: existing?.lienDetails
          ? {
              ...existing.lienDetails,
              heldAmount: 0,
              freeAmount: totalBal,
              reason: `Lien released by Nodal Fraud Officer (${officerName}): ${remarks}`,
            }
          : undefined,
        rbiSopClock: existing?.rbiSopClock
          ? {
              ...existing.rbiSopClock,
              stage: 'Resolved / Released',
            }
          : undefined,
        ...releaseStatutory,
      };
      report = {
        resolutionId: `RBI-RES-${Date.now().toString(36).toUpperCase()}`,
        accountId: key,
        complaintId,
        decision: 'RELEASE',
        officerName,
        remarks,
        resolvedAt: nowIso,
        cbsReferenceId: cbsRef,
        previousHeldAmount: prevHeld,
        releasedAmount: prevHeld,
        finalAccountStatus: 'Active',
        finalUsableCleanBalance: totalBal,
        statutoryComplianceNote:
          'Temporary debit hold removed in accordance with RBI Draft KYC Amendment Directions (Annex III) Step 4/6 Nodal Review determination. Full customer operating balance restored without interrupting clean commerce.',
      };
    } else {
      const escalateStatutory = computeRbiSopStatutorySchedule(
        existing?.temporaryDebitHold?.timestamp ?? existing?.rbiSopClock?.noticeSentAt ?? nowIso,
        totalBal,
        cbsRef,
        true,
        Math.max(existing?.rbiSopClock?.dayCount ?? 31, 31),
        5,
      );
      nextState = {
        totalBalance: totalBal,
        precisionLienHold: totalBal,
        usableCleanBalance: 0,
        accountStatus: 'Full Freeze',
        lienDetails: existing?.lienDetails
          ? {
              ...existing.lienDetails,
              heldAmount: totalBal,
              freeAmount: 0,
              reason: `Escalated via NCRP-CFCFRMS & account-level hold confirmed by Nodal Officer (${officerName}): ${remarks}`,
            }
          : undefined,
        rbiSopClock: existing?.rbiSopClock
          ? {
              ...existing.rbiSopClock,
              stage: 'Days 31-60: LEA Escalation',
              dayCount: Math.max(existing.rbiSopClock.dayCount, 31),
            }
          : undefined,
        ...escalateStatutory,
      };
      report = {
        resolutionId: `RBI-ESC-${Date.now().toString(36).toUpperCase()}`,
        accountId: key,
        complaintId,
        decision: 'CONFIRM_FREEZE',
        officerName,
        remarks,
        resolvedAt: nowIso,
        cbsReferenceId: cbsRef,
        previousHeldAmount: prevHeld,
        releasedAmount: 0,
        finalAccountStatus: 'Full Freeze',
        finalUsableCleanBalance: 0,
        statutoryComplianceNote:
          'Account escalated to Jurisdictional Police via NCRP-CFCFRMS under Step 5 (Days 31-60 LEA Review Window) of RBI Money Mule SOP (Annex III). Automatic hold removal applies on Day 61 if no formal LEA seizure order is received.',
      };
    }

    map[key] = nextState;
    this.stateRevision++;
    this.analysisCache.clear();
    this.persist();
    return { state: nextState, report };
  }

  saveTrace(trace: TraceResult): void {
    this.traceCache.set(trace.trace_id, trace);
    if (this.traceCache.size > 100) {
      const oldest = this.traceCache.keys().next().value;
      if (oldest) this.traceCache.delete(oldest);
    }
  }

  getTrace(traceId: string): TraceResult | undefined {
    return this.traceCache.get(traceId);
  }

  listInvestigations(datasetId?: string): InvestigationCase[] {
    const targetId = datasetId || this.state.activeDatasetId;
    return this.state.investigations
      .filter((c) => c.dataset_id === targetId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getInvestigation(caseId: string): InvestigationCase | undefined {
    return this.state.investigations.find((c) => c.case_id === caseId);
  }

  createInvestigation(payload: Omit<InvestigationCase, 'case_id' | 'created_at' | 'updated_at' | 'notes' | 'audit_log'> & { initialNote?: string; actor?: string }): InvestigationCase {
    const seq = this.state.investigations.length + 1;
    const caseId = `CASE-2026-${String(seq).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const actor = payload.actor || payload.assignee || 'Senior Analyst';

    const newCase: InvestigationCase = {
      case_id: caseId,
      dataset_id: payload.dataset_id,
      title: payload.title,
      cluster_id: payload.cluster_id,
      complaint_ids: [...new Set(payload.complaint_ids)],
      account_ids: [...new Set(payload.account_ids)],
      evidence_transaction_ids: [...new Set(payload.evidence_transaction_ids)],
      total_reported_amount: payload.total_reported_amount,
      assignee: payload.assignee,
      priority: payload.priority,
      status: payload.status || 'NEW',
      created_at: now,
      updated_at: now,
      notes: payload.initialNote
        ? [
            {
              id: `NOTE-${Date.now().toString(36).toUpperCase()}`,
              author: actor,
              timestamp: now,
              content: payload.initialNote,
            },
          ]
        : [],
      audit_log: [
        {
          id: `AUD-${Date.now().toString(36).toUpperCase()}`,
          timestamp: now,
          actor,
          action: 'CASE_CREATED',
          details: `Created case ${caseId} with ${payload.complaint_ids.length} linked complaint(s) and ${payload.account_ids.length} account(s).`,
        },
      ],
    };

    this.state.investigations.unshift(newCase);
    this.persist();
    return newCase;
  }

  updateInvestigation(
    caseId: string,
    updates: {
      status?: InvestigationCase['status'];
      priority?: InvestigationCase['priority'];
      assignee?: string;
      addNote?: { author: string; content: string };
      addComplaintIds?: string[];
      addAccountIds?: string[];
      addEvidenceTxIds?: string[];
      actor?: string;
    },
  ): InvestigationCase | null {
    const existing = this.state.investigations.find((c) => c.case_id === caseId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const actor = updates.actor || existing.assignee || 'Investigator';

    if (updates.status && updates.status !== existing.status) {
      const prev = existing.status;
      existing.status = updates.status;
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-S`,
        timestamp: now,
        actor,
        action: 'STATUS_CHANGED',
        details: `Changed case status from ${prev} to ${updates.status}.`,
      });
    }

    if (updates.priority && updates.priority !== existing.priority) {
      const prev = existing.priority;
      existing.priority = updates.priority;
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-P`,
        timestamp: now,
        actor,
        action: 'PRIORITY_UPDATED',
        details: `Updated priority from ${prev} to ${updates.priority}.`,
      });
    }

    if (updates.assignee && updates.assignee !== existing.assignee) {
      const prev = existing.assignee;
      existing.assignee = updates.assignee;
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-A`,
        timestamp: now,
        actor,
        action: 'ASSIGNEE_CHANGED',
        details: `Reassigned case from ${prev} to ${updates.assignee}.`,
      });
    }

    if (updates.addNote && updates.addNote.content.trim()) {
      existing.notes.push({
        id: `NOTE-${Date.now().toString(36).toUpperCase()}`,
        author: updates.addNote.author || actor,
        timestamp: now,
        content: updates.addNote.content.trim(),
      });
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-N`,
        timestamp: now,
        actor: updates.addNote.author || actor,
        action: 'NOTE_ADDED',
        details: 'Appended analyst investigation note.',
      });
    }

    if (updates.addComplaintIds?.length) {
      const merged = new Set([...existing.complaint_ids, ...updates.addComplaintIds]);
      existing.complaint_ids = [...merged];
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-C`,
        timestamp: now,
        actor,
        action: 'COMPLAINTS_ATTACHED',
        details: `Attached complaint(s): ${updates.addComplaintIds.join(', ')}.`,
      });
    }

    if (updates.addAccountIds?.length) {
      const merged = new Set([...existing.account_ids, ...updates.addAccountIds]);
      existing.account_ids = [...merged];
    }

    if (updates.addEvidenceTxIds?.length) {
      const merged = new Set([...existing.evidence_transaction_ids, ...updates.addEvidenceTxIds]);
      existing.evidence_transaction_ids = [...merged];
      existing.audit_log.push({
        id: `AUD-${Date.now().toString(36).toUpperCase()}-E`,
        timestamp: now,
        actor,
        action: 'EVIDENCE_ATTACHED',
        details: `Added transaction reference(s): ${updates.addEvidenceTxIds.join(', ')}.`,
      });
    }

    existing.updated_at = now;
    this.persist();
    return existing;
  }

  saveReport(report: InvestigationReportData): void {
    this.reportCache.set(report.report_id, report);
  }

  getReport(reportId: string): InvestigationReportData | undefined {
    return this.reportCache.get(reportId);
  }

  listReports(): InvestigationReportData[] {
    return [...this.reportCache.values()].sort((a, b) =>
      b.generated_at.localeCompare(a.generated_at),
    );
  }
}

export const store = new MuleShieldStore();
