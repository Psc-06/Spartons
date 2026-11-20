export type TransactionStatus = 'SUCCESS' | 'FAILED' | 'REVERSED' | 'PENDING';

export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AccountRole =
  | 'VICTIM'
  | 'INITIAL_RECIPIENT'
  | 'INTERMEDIARY'
  | 'DOWNSTREAM'
  | 'CONTROL';

export type AccountStatus =
  | 'Active'
  | 'Under Investigation'
  | 'Precision Lien Active'
  | 'Full Freeze';

export type RbiSopStage =
  | 'Day 0: Notice Sent'
  | 'Days 1-20: Customer Dispute Window'
  | 'Days 21-30: Nodal Review'
  | 'Days 31-60: LEA Escalation'
  | 'Resolved / Released';

export type DisputeDocumentType =
  | 'GST Tax Invoice'
  | 'Delivery Challan'
  | 'Commercial Contract';

export type DisputeRecommendation =
  | 'RELEASE_LIEN'
  | 'MAINTAIN_LIEN'
  | 'ESCALATE_TO_LEA';

export interface LienDetails {
  complaintId: string;
  taintedReceived: number;
  heldAmount: number;
  freeAmount: number;
  appliedAt: string;
  reason: string;
  cbsReferenceId: string;
}

export interface DisputeSubmission {
  submittedAt: string;
  invoiceNumber: string;
  gstin: string;
  counterpartyName: string;
  documentType: DisputeDocumentType;
  claimedAmount?: number;
  referencedUtr?: string;
  aiVerificationScore: number;
  aiRecommendation: DisputeRecommendation;
  aiReasoning: string;
}

export interface RbiSopClock {
  stage: RbiSopStage;
  dayCount: number;
  noticeSentAt: string;
  customerResponseDeadline: string; // 20 days from notice
  nodalReviewDeadline: string; // 10 days after response (Day 30)
  autoExpiryDeadline: string; // Day 60 circuit breaker
  disputeSubmission?: DisputeSubmission;
}

export type RbiSopStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface TemporaryDebitHold {
  amount: number;
  timestamp: string;
  cbsRef: string;
  isAccountLevel: boolean;
}

export interface StatutoryDeadlines {
  customerExplanationDue: string; // Day 20 from temporary debit hold
  bankReviewDue: string; // Day 30 (or 10 days after customer response)
  leaResponseDue: string; // Day 60 (30 days from date of reference to LEA)
  maxHoldExpiry: string; // Day 61 statutory circuit breaker auto-release
}

export type DetectionRuleCode =
  | 'RULE_STUDENT_TIER_OVERFLOW'
  | 'RULE_6M_HISTORICAL_VOL_SPIKE'
  | 'RULE_BRANCHING_MULTI_HOP_DAG'
  | 'RULE_SUSPICIOUS_LOOKALIKE_VPA';

export interface TriggeredDetectionRule {
  code: DetectionRuleCode;
  name: string;
  severity: 'HIGH' | 'CRITICAL';
  points: number;
  reason: string;
  metricSummary: string;
  evidence: Record<string, string | number | boolean>;
}

export interface AccountKycProfile {
  accountHolderName?: string;
  age?: number;
  occupation?: 'Student' | 'Salaried' | 'Merchant' | 'Self-Employed' | 'Retired' | 'Unknown';
  accountAgeMonths?: number;
  monthlyHistoricalTurnover?: Array<{ month: string; volume: number }>;
  isNewlyRegisteredVpa?: boolean;
}

export interface AccountLienState {
  totalBalance: number;
  precisionLienHold: number;
  usableCleanBalance: number;
  accountStatus: AccountStatus;
  lienDetails?: LienDetails;
  rbiSopClock?: RbiSopClock;
  rbiSopStep?: RbiSopStepNumber;
  temporaryDebitHold?: TemporaryDebitHold;
  statutoryDeadlines?: StatutoryDeadlines;
}

export interface PrecisionLienCalculation {
  accountId: string;
  complaintId: string;
  totalBalance: number;
  taintedReceived: number;
  victimDeficit: number;
  heldAmount: number;
  usableCleanBalance: number;
  hopDepth: number;
  matchedUtrs: string[];
  supportingTransactionIds: string[];
  reasonCodes: string[];
  explanation: string;
  formulaSummary: string;
}

export interface LienResolutionReport {
  resolutionId: string;
  accountId: string;
  complaintId: string;
  decision: 'RELEASE' | 'CONFIRM_FREEZE';
  officerName: string;
  remarks: string;
  resolvedAt: string;
  cbsReferenceId: string;
  previousHeldAmount: number;
  releasedAmount: number;
  finalAccountStatus: AccountStatus;
  finalUsableCleanBalance: number;
  statutoryComplianceNote: string;
}

export type InvestigationStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'ESCALATED'
  | 'REPORT_GENERATED'
  | 'CLOSED';

export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FraudComplaint {
  complaint_id: string;
  victim_reference: string;
  reported_transaction_id: string;
  utr: string;
  transaction_timestamp: string;
  amount: number;
  sender_upi: string;
  receiver_upi: string;
  complaint_date: string;
  fraud_typology?: string;
}

export interface TransactionRecord {
  transaction_id: string;
  timestamp: string;
  sender_upi: string;
  receiver_upi: string;
  amount: number;
  status: TransactionStatus;
  utr: string;
  channel: string;
}

export interface MatchedComplaint extends FraudComplaint {
  match_status: 'MATCHED_SUCCESS' | 'MATCHED_NON_SUCCESS' | 'UNMATCHED';
  matched_transaction?: TransactionRecord;
  cluster_id: string | null;
  linked_account_count: number;
  traced_hops: number;
}

export interface RiskWeightsConfig {
  rapidPassThrough: number; // default 25
  crossComplaintRecurrence: number; // default 25
  fanIn: number; // default 15
  fanOut: number; // default 15
  transactionVelocity: number; // default 10
  networkAndCircular: number; // default 10
  mediumThreshold: number; // default 40
  highThreshold: number; // default 70
}

export interface RiskSignalBreakdown {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  metricValue: string;
  description: string;
}

export interface AccountProfile {
  upi_id: string;
  upi_syntax_valid: boolean;
  role: AccountRole;
  risk_score: number;
  risk_category: RiskCategory;
  connected_complaints: string[];
  connected_accounts: string[];
  cluster_id: string | null;
  incoming_count: number;
  outgoing_count: number;
  total_incoming_amount: number;
  total_outgoing_amount: number;
  unique_senders: number;
  unique_recipients: number;
  rapid_pass_through_pct: number;
  velocity_1h_max: number;
  velocity_24h_max: number;
  max_hop_depth: number;
  has_circular_pattern: boolean;
  signals: RiskSignalBreakdown[];
  supporting_transaction_ids: string[];
  explanation: string;
  investigative_advisory: string;
  // Precision Lien Protocol & RBI 60-Day Money Mule SOP fields (Annex III, effective Apr 1, 2027)
  totalBalance: number;
  precisionLienHold: number;
  usableCleanBalance: number;
  accountStatus: AccountStatus;
  lienDetails?: LienDetails;
  rbiSopClock?: RbiSopClock;
  rbiSopStep?: RbiSopStepNumber;
  temporaryDebitHold?: TemporaryDebitHold;
  statutoryDeadlines?: StatutoryDeadlines;
  // KYC & Historical Baseline + 4 Deterministic Detection Rules
  accountHolderName?: string;
  age?: number;
  occupation?: 'Student' | 'Salaried' | 'Merchant' | 'Self-Employed' | 'Retired' | 'Unknown';
  accountAgeMonths?: number;
  monthlyHistoricalTurnover?: Array<{ month: string; volume: number }>;
  sixMonthAvgMonthlyVolume?: number;
  current24hCreditVolume?: number;
  current24hCreditCount?: number;
  isNewlyRegisteredVpa?: boolean;
  triggeredRules: TriggeredDetectionRule[];
  first_transaction_at?: string;
  last_transaction_at?: string;
}

export type Account = AccountProfile;

export interface TwoAccountPathResult {
  found: boolean;
  source: string;
  target: string;
  path_nodes: string[];
  path_edge_ids: string[];
  total_path_amount: number;
  hop_count: number;
  message: string;
}

export interface AnalyzedTransaction extends TransactionRecord {
  risk_score: number;
  risk_tier: RiskTier;
  is_suspicious: boolean;
  suspicious_reason: string;
  linked_complaint_id: string | null;
  cluster_id: string | null;
}

export interface TransactionsQueryResponse {
  total: number;
  transactions: AnalyzedTransaction[];
  summary: {
    total_transactions: number;
    total_volume: number;
    unique_accounts: number;
    suspicious_transactions: number;
    identified_chains: number;
  };
}

export interface NetworkPathway {
  path: string[];
  complaint_ids: string[];
  total_amount: number;
  hop_count: number;
}

export interface NetworkNode {
  id: string;
  label: string;
  role: AccountRole;
  risk_score: number;
  risk_category: RiskCategory;
  connected_complaints: string[];
  total_incoming: number;
  total_outgoing: number;
  is_shared_account: boolean;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  amount: number;
  timestamp: string;
  utr: string;
  status: TransactionStatus;
  hop: number;
  complaint_ids: string[];
  is_circular: boolean;
  relationship_type: 'DIRECT_COMPLAINT' | 'SHARED_ACCOUNT_FLOW' | 'INFERRED_MULTI_HOP';
}

export interface NetworkCluster {
  cluster_id: string;
  name: string;
  complaint_ids: string[];
  unique_victims: string[];
  total_reported_amount: number;
  account_ids: string[];
  shared_recipient_accounts: string[];
  intermediary_accounts: string[];
  downstream_accounts: string[];
  inferred_link_accounts: string[];
  common_pathways: NetworkPathway[];
  earliest_timestamp: string;
  latest_timestamp: string;
  has_circular_pattern: boolean;
  max_risk_score: number;
  avg_risk_score: number;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface TraceParameters {
  complaintId: string;
  maxHops: number; // 1-5
  windowHours: number; // 1, 6, 24, 72, 168
  minAmount: number;
  statuses: TransactionStatus[];
  includeBackward?: boolean;
}

export interface TraceEdgeResult {
  transaction_id: string;
  utr: string;
  timestamp: string;
  sender_upi: string;
  receiver_upi: string;
  amount: number;
  potentially_attributed_amount: number;
  attribution_status: 'DIRECT_FIFO' | 'ESTIMATED_MIXED_FUNDS' | 'NON_SETTLED_EXCLUDED';
  status: TransactionStatus;
  hop: number;
  minutes_since_origin: number;
  minutes_since_prev_inflow: number;
  is_circular: boolean;
  channel: string;
}

export interface TracePatternFlag {
  code:
    | 'ONE_TO_MANY'
    | 'MANY_TO_ONE'
    | 'RAPID_PASS_THROUGH'
    | 'MULTI_HOP'
    | 'CIRCULAR_FLOW'
    | 'COMMON_DOWNSTREAM';
  label: string;
  detail: string;
  accounts: string[];
}

export interface TraceResult {
  trace_id: string;
  dataset_id: string;
  generated_at: string;
  parameters: TraceParameters;
  complaint: MatchedComplaint;
  original_amount: number;
  total_outgoing_observed: number;
  total_potentially_attributed: number;
  untraced_amount: number;
  mixed_funds_detected: boolean;
  attribution_method: string;
  attribution_assumptions: string[];
  patterns: TracePatternFlag[];
  nodes: NetworkNode[];
  edges: TraceEdgeResult[];
  timeline: TraceEdgeResult[];
  warnings: string[];
  account_lien_allocations?: PrecisionLienCalculation[];
}

export interface ImportValidationSummary {
  complaints_received: number;
  complaints_imported: number;
  complaints_rejected: number;
  transactions_received: number;
  transactions_imported: number;
  transactions_rejected: number;
  duplicate_transaction_ids: number;
  non_success_transactions: {
    failed: number;
    reversed: number;
    pending: number;
  };
  invalid_upi_syntax_count: number;
  warnings: string[];
}

export interface GroundTruthLabel {
  upi_id: string;
  planted_role: string;
  planted_cluster: string | null;
  is_false_positive_control: boolean;
}

export interface DatasetMetadata {
  id: string;
  name: string;
  description: string;
  source_type: 'SYNTHETIC_DEMO' | 'UPLOADED_CSV';
  created_at: string;
  analysis_version: string;
  complaint_count: number;
  transaction_count: number;
  account_count: number;
  validation_summary: ImportValidationSummary;
}

export interface InvestigationNote {
  id: string;
  author: string;
  timestamp: string;
  content: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

export interface InvestigationCase {
  case_id: string;
  dataset_id: string;
  title: string;
  cluster_id: string | null;
  complaint_ids: string[];
  account_ids: string[];
  evidence_transaction_ids: string[];
  total_reported_amount: number;
  assignee: string;
  priority: PriorityLevel;
  status: InvestigationStatus;
  created_at: string;
  updated_at: string;
  notes: InvestigationNote[];
  audit_log: AuditLogEntry[];
  // Official RBI Money Mule SOP tracking at Case Level
  rbiSopStep?: RbiSopStepNumber;
  temporaryDebitHold?: TemporaryDebitHold;
  statutoryDeadlines?: StatutoryDeadlines;
}

export type Investigation = InvestigationCase;

export interface AlertItem {
  id: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  account_id?: string;
  cluster_id?: string;
  timestamp: string;
  metric: string;
}

export interface DashboardSummary {
  dataset: DatasetMetadata;
  kpis: {
    total_complaints: number;
    matched_complaints: number;
    total_reported_amount: number;
    unique_recipient_upis: number;
    accounts_linked_multi_complaint: number;
    suspicious_network_clusters: number;
    high_priority_accounts: number;
  };
  complaint_trends: Array<{
    date: string;
    complaints: number;
    amount: number;
  }>;
  risk_distribution: Array<{
    category: RiskCategory;
    count: number;
  }>;
  top_recipients: Array<{
    upi_id: string;
    complaint_count: number;
    total_reported_amount: number;
    risk_score: number;
    risk_category: RiskCategory;
    cluster_id: string | null;
  }>;
  recent_networks: Array<{
    cluster_id: string;
    name: string;
    account_count: number;
    complaint_count: number;
    total_reported_amount: number;
    max_risk_score: number;
    has_circular_pattern: boolean;
  }>;
  recent_investigations: InvestigationCase[];
}

export interface AiStructuredExplanation {
  summary: string;
  observed_patterns: string[];
  relevant_complaint_ids: string[];
  relevant_transaction_ids: string[];
  relevant_account_ids: string[];
  supporting_facts: string[];
  data_limitations: string[];
  suggested_investigation_checks: string[];
  disclaimer: string;
  generated_at: string;
  model_used: string;
}

export interface InvestigationReportData {
  report_id: string;
  label: string;
  disclaimer: string;
  generated_at: string;
  dataset_source: string;
  source_type: 'SYNTHETIC_DEMO' | 'UPLOADED_CSV';
  analysis_version: string;
  case_record: InvestigationCase;
  linked_complaints: MatchedComplaint[];
  total_reported_amount: number;
  connected_accounts: AccountProfile[];
  network_cluster: NetworkCluster | null;
  traced_transactions: TraceEdgeResult[];
  original_transactions: TransactionRecord[];
  attribution_method: string;
  attribution_assumptions: string[];
  missing_evidence_and_limitations: string[];
  ai_summary: AiStructuredExplanation | null;
}

export interface GlobalSearchResult {
  accounts: Array<{ upi_id: string; risk_score: number; risk_category: RiskCategory; role: AccountRole }>;
  complaints: Array<{ complaint_id: string; receiver_upi: string; amount: number; complaint_date: string }>;
  transactions: Array<{ transaction_id: string; utr: string; sender_upi: string; receiver_upi: string; amount: number; status: TransactionStatus }>;
  clusters: Array<{ cluster_id: string; name: string; complaint_count: number; total_reported_amount: number }>;
  investigations: Array<{ case_id: string; title: string; status: InvestigationStatus; priority: PriorityLevel }>;
}
