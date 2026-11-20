import Graph from 'graphology';
import { connectedComponents } from 'graphology-components';
import type {
  AccountKycProfile,
  AccountLienState,
  AccountProfile,
  AccountRole,
  AccountStatus,
  AlertItem,
  DashboardSummary,
  DatasetMetadata,
  FraudComplaint,
  ImportValidationSummary,
  InvestigationCase,
  MatchedComplaint,
  NetworkCluster,
  NetworkEdge,
  NetworkNode,
  NetworkPathway,
  PrecisionLienCalculation,
  RbiSopStepNumber,
  RiskCategory,
  RiskSignalBreakdown,
  RiskWeightsConfig,
  StatutoryDeadlines,
  TemporaryDebitHold,
  TraceEdgeResult,
  TraceParameters,
  TracePatternFlag,
  TraceResult,
  TransactionRecord,
  TransactionStatus,
  TriggeredDetectionRule,
} from '../src/shared/types.ts';

export const DEFAULT_RISK_CONFIG: RiskWeightsConfig = {
  rapidPassThrough: 25,
  crossComplaintRecurrence: 25,
  fanIn: 15,
  fanOut: 15,
  transactionVelocity: 10,
  networkAndCircular: 10,
  mediumThreshold: 40,
  highThreshold: 70,
};

export const ANALYSIS_VERSION = 'MuleShield-Engine-v1.0.0-Deterministic';

/**
 * Pure UPI syntax validation, strictly separate from fraud or mule detection.
 * Never assumes fraud based on handle wording or appearance.
 */
export function validateUpiSyntax(upi: string): boolean {
  if (!upi || typeof upi !== 'string') return false;
  const trimmed = upi.trim();
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/.test(trimmed);
}

export function normalizeUpi(upi: string): string {
  return String(upi ?? '').trim().toLowerCase();
}

export function normalizeStatus(raw: string): TransactionStatus | null {
  const upper = String(raw ?? '').trim().toUpperCase();
  if (upper === 'SUCCESS' || upper === 'COMPLETED' || upper === 'SETTLED') return 'SUCCESS';
  if (upper === 'FAILED' || upper === 'FAILURE' || upper === 'DECLINED') return 'FAILED';
  if (upper === 'REVERSED' || upper === 'REFUNDED') return 'REVERSED';
  if (upper === 'PENDING' || upper === 'PROCESSING' || upper === 'INITIATED') return 'PENDING';
  return null;
}

export function validateAndNormalizeImport(
  rawComplaints: Record<string, unknown>[],
  rawTransactions: Record<string, unknown>[],
): {
  complaints: FraudComplaint[];
  transactions: TransactionRecord[];
  summary: ImportValidationSummary;
} {
  const warnings: string[] = [];
  const complaints: FraudComplaint[] = [];
  const transactions: TransactionRecord[] = [];

  let complaintsRejected = 0;
  let transactionsRejected = 0;
  let duplicateTxIds = 0;
  let invalidUpiSyntaxCount = 0;
  const nonSuccess = { failed: 0, reversed: 0, pending: 0 };

  const seenComplaintIds = new Set<string>();
  const seenTxIds = new Set<string>();

  for (let i = 0; i < rawComplaints.length; i++) {
    const row = rawComplaints[i];
    const complaint_id = String(row.complaint_id ?? '').trim();
    const victim_reference = String(row.victim_reference ?? '').trim();
    const reported_transaction_id = String(row.reported_transaction_id ?? '').trim();
    const utr = String(row.utr ?? '').trim();
    const transaction_timestamp = String(row.transaction_timestamp ?? '').trim();
    const amount = Number(row.amount);
    const sender_upi = normalizeUpi(String(row.sender_upi ?? ''));
    const receiver_upi = normalizeUpi(String(row.receiver_upi ?? ''));
    const complaint_date = String(row.complaint_date ?? '').trim();

    if (
      !complaint_id ||
      !victim_reference ||
      (!reported_transaction_id && !utr) ||
      !sender_upi ||
      !receiver_upi ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Number.isNaN(Date.parse(transaction_timestamp))
    ) {
      complaintsRejected++;
      if (warnings.length < 25) {
        warnings.push(`Complaint row ${i + 1}: missing mandatory fields or invalid amount/timestamp.`);
      }
      continue;
    }

    if (seenComplaintIds.has(complaint_id)) {
      complaintsRejected++;
      if (warnings.length < 25) {
        warnings.push(`Duplicate complaint_id skipped: ${complaint_id}`);
      }
      continue;
    }
    seenComplaintIds.add(complaint_id);

    if (!validateUpiSyntax(sender_upi)) invalidUpiSyntaxCount++;
    if (!validateUpiSyntax(receiver_upi)) invalidUpiSyntaxCount++;

    complaints.push({
      complaint_id,
      victim_reference,
      reported_transaction_id,
      utr,
      transaction_timestamp: new Date(transaction_timestamp).toISOString(),
      amount,
      sender_upi,
      receiver_upi,
      complaint_date: complaint_date || new Date(transaction_timestamp).toISOString().slice(0, 10),
      fraud_typology: row.fraud_typology ? String(row.fraud_typology).trim() : undefined,
    });
  }

  for (let i = 0; i < rawTransactions.length; i++) {
    const row = rawTransactions[i];
    const transaction_id = String(row.transaction_id ?? '').trim();
    const timestamp = String(row.timestamp ?? '').trim();
    const sender_upi = normalizeUpi(String(row.sender_upi ?? ''));
    const receiver_upi = normalizeUpi(String(row.receiver_upi ?? ''));
    const amount = Number(row.amount);
    const status = normalizeStatus(String(row.status ?? ''));
    const utr = String(row.utr ?? '').trim();
    const channel = String(row.channel ?? 'UPI').trim() || 'UPI';

    if (
      !transaction_id ||
      !sender_upi ||
      !receiver_upi ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !status ||
      Number.isNaN(Date.parse(timestamp))
    ) {
      transactionsRejected++;
      if (warnings.length < 25) {
        warnings.push(`Transaction row ${i + 1}: invalid mandatory fields, status, amount, or timestamp.`);
      }
      continue;
    }

    if (seenTxIds.has(transaction_id)) {
      duplicateTxIds++;
      transactionsRejected++;
      if (warnings.length < 25) {
        warnings.push(`Duplicate transaction_id skipped: ${transaction_id}`);
      }
      continue;
    }
    seenTxIds.add(transaction_id);

    if (status === 'FAILED') nonSuccess.failed++;
    if (status === 'REVERSED') nonSuccess.reversed++;
    if (status === 'PENDING') nonSuccess.pending++;

    if (!validateUpiSyntax(sender_upi)) invalidUpiSyntaxCount++;
    if (!validateUpiSyntax(receiver_upi)) invalidUpiSyntaxCount++;

    transactions.push({
      transaction_id,
      timestamp: new Date(timestamp).toISOString(),
      sender_upi,
      receiver_upi,
      amount,
      status,
      utr,
      channel,
    });
  }

  transactions.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return {
    complaints,
    transactions,
    summary: {
      complaints_received: rawComplaints.length,
      complaints_imported: complaints.length,
      complaints_rejected: complaintsRejected,
      transactions_received: rawTransactions.length,
      transactions_imported: transactions.length,
      transactions_rejected: transactionsRejected,
      duplicate_transaction_ids: duplicateTxIds,
      non_success_transactions: nonSuccess,
      invalid_upi_syntax_count: invalidUpiSyntaxCount,
      warnings,
    },
  };
}

/**
 * Match reported complaints against the complete transaction ledger using exact
 * transaction_id or UTR identifiers.
 */
export function matchComplaintsToLedger(
  complaints: FraudComplaint[],
  transactions: TransactionRecord[],
): MatchedComplaint[] {
  const byTxId = new Map<string, TransactionRecord>();
  const byUtr = new Map<string, TransactionRecord>();

  for (const tx of transactions) {
    byTxId.set(tx.transaction_id, tx);
    if (tx.utr) byUtr.set(tx.utr, tx);
  }

  return complaints.map((cmp) => {
    const match =
      (cmp.reported_transaction_id ? byTxId.get(cmp.reported_transaction_id) : undefined) ??
      (cmp.utr ? byUtr.get(cmp.utr) : undefined);

    let match_status: MatchedComplaint['match_status'] = 'UNMATCHED';
    if (match) {
      match_status = match.status === 'SUCCESS' ? 'MATCHED_SUCCESS' : 'MATCHED_NON_SUCCESS';
    }

    return {
      ...cmp,
      match_status,
      matched_transaction: match,
      cluster_id: null,
      linked_account_count: match && match.status === 'SUCCESS' ? 2 : 0,
      traced_hops: 0,
    };
  });
}

interface FifoLot {
  source: 'TRACEABLE' | 'UNRELATED';
  remaining: number;
  timestampMs: number;
}

/**
 * Multi-hop transaction tracing engine with conservative FIFO fund attribution.
 * Strictly respects transaction timestamps, directionality, and settled status.
 */
export function traceComplaintFunds(
  datasetId: string,
  complaint: MatchedComplaint,
  allTransactions: TransactionRecord[],
  params: TraceParameters,
): TraceResult {
  const warnings: string[] = [];
  const maxHops = Math.max(1, Math.min(5, Math.round(params.maxHops)));
  const windowMs = Math.max(1, params.windowHours) * 3_600_000;
  const minAmount = Math.max(0, params.minAmount || 0);

  // Never treat FAILED, REVERSED, or PENDING transactions as successful transfers.
  const includeNonSuccessDisplay = params.statuses.some((s) => s !== 'SUCCESS');
  if (includeNonSuccessDisplay) {
    warnings.push(
      'Non-settled statuses (FAILED/REVERSED/PENDING) are shown strictly for audit visibility and excluded from active money-flow continuation and FIFO attribution.',
    );
  }

  const originTx = complaint.matched_transaction;
  const traceId = `TRC-${complaint.complaint_id}-${Date.now().toString(36).slice(-5).toUpperCase()}`;

  const attributionAssumptions = [
    'Conservative FIFO allocation applied chronologically to observed inflows within the configured tracing window.',
    'Opening account balances prior to the uploaded ledger window are unobserved; mixed-fund accounts cannot prove 1:1 rupee identity.',
    'Only transactions with status SUCCESS propagate traceable balances forward; FAILED, REVERSED, and PENDING records are excluded from fund flow.',
    'Onward attributed amounts represent analytical upper bounds of potentially linked funds and require institutional bank-statement verification.',
  ];

  if (!originTx) {
    warnings.push(
      `Reported transaction (${complaint.reported_transaction_id || complaint.utr}) was not found in the uploaded transaction ledger. Onward tracing cannot proceed without a matched settled source record.`,
    );
    return {
      trace_id: traceId,
      dataset_id: datasetId,
      generated_at: new Date().toISOString(),
      parameters: params,
      complaint,
      original_amount: complaint.amount,
      total_outgoing_observed: 0,
      total_potentially_attributed: 0,
      untraced_amount: complaint.amount,
      mixed_funds_detected: false,
      attribution_method: 'Conservative Chronological FIFO Queue',
      attribution_assumptions: attributionAssumptions,
      patterns: [],
      nodes: [
        {
          id: complaint.sender_upi,
          label: complaint.sender_upi,
          role: 'VICTIM',
          risk_score: 0,
          risk_category: 'LOW',
          connected_complaints: [complaint.complaint_id],
          total_incoming: 0,
          total_outgoing: complaint.amount,
          is_shared_account: false,
        },
        {
          id: complaint.receiver_upi,
          label: complaint.receiver_upi,
          role: 'INITIAL_RECIPIENT',
          risk_score: 0,
          risk_category: 'LOW',
          connected_complaints: [complaint.complaint_id],
          total_incoming: 0,
          total_outgoing: 0,
          is_shared_account: false,
        },
      ],
      edges: [],
      timeline: [],
      warnings,
    };
  }

  if (originTx.status !== 'SUCCESS') {
    warnings.push(
      `Matched initial transaction ${originTx.transaction_id} has status ${originTx.status}. Because funds did not settle, downstream mule tracing is halted.`,
    );
    return {
      trace_id: traceId,
      dataset_id: datasetId,
      generated_at: new Date().toISOString(),
      parameters: params,
      complaint,
      original_amount: originTx.amount,
      total_outgoing_observed: 0,
      total_potentially_attributed: 0,
      untraced_amount: originTx.amount,
      mixed_funds_detected: false,
      attribution_method: 'Conservative Chronological FIFO Queue',
      attribution_assumptions: attributionAssumptions,
      patterns: [],
      nodes: [
        {
          id: originTx.sender_upi,
          label: originTx.sender_upi,
          role: 'VICTIM',
          risk_score: 0,
          risk_category: 'LOW',
          connected_complaints: [complaint.complaint_id],
          total_incoming: 0,
          total_outgoing: 0,
          is_shared_account: false,
        },
        {
          id: originTx.receiver_upi,
          label: originTx.receiver_upi,
          role: 'INITIAL_RECIPIENT',
          risk_score: 0,
          risk_category: 'LOW',
          connected_complaints: [complaint.complaint_id],
          total_incoming: 0,
          total_outgoing: 0,
          is_shared_account: false,
        },
      ],
      edges: [
        {
          transaction_id: originTx.transaction_id,
          utr: originTx.utr,
          timestamp: originTx.timestamp,
          sender_upi: originTx.sender_upi,
          receiver_upi: originTx.receiver_upi,
          amount: originTx.amount,
          potentially_attributed_amount: 0,
          attribution_status: 'NON_SETTLED_EXCLUDED',
          status: originTx.status,
          hop: 1,
          minutes_since_origin: 0,
          minutes_since_prev_inflow: 0,
          is_circular: false,
          channel: originTx.channel,
        },
      ],
      timeline: [],
      warnings,
    };
  }

  const originTimeMs = new Date(originTx.timestamp).getTime();
  const maxTimeMs = originTimeMs + windowMs;

  // Build adjacency indexes over the relevant time window
  const outgoingByAccount = new Map<string, TransactionRecord[]>();
  const incomingByAccount = new Map<string, TransactionRecord[]>();

  for (const tx of allTransactions) {
    const tMs = new Date(tx.timestamp).getTime();
    // Pre-window buffer of 24h for detecting prior unrelated mixed inflows on visited accounts
    if (tMs >= originTimeMs - 24 * 3_600_000 && tMs <= maxTimeMs) {
      if (tx.status === 'SUCCESS') {
        const inc = incomingByAccount.get(tx.receiver_upi) ?? [];
        inc.push(tx);
        incomingByAccount.set(tx.receiver_upi, inc);
      }
    }
    if (tMs >= originTimeMs && tMs <= maxTimeMs) {
      if (params.statuses.includes(tx.status) && tx.amount >= minAmount) {
        const out = outgoingByAccount.get(tx.sender_upi) ?? [];
        out.push(tx);
        outgoingByAccount.set(tx.sender_upi, out);
      }
    }
  }

  // FIFO queues per account: initialized with unrelated credits that arrived before/during window
  const fifoQueues = new Map<string, FifoLot[]>();
  const accountHasMixedFunds = new Set<string>();
  const accountProcessedOutIndex = new Map<string, number>();

  const ensureAccountQueue = (account: string, firstTraceableTimeMs: number, traceableTxId: string) => {
    if (fifoQueues.has(account)) return;
    const lots: FifoLot[] = [];
    const priorInflows = incomingByAccount.get(account) ?? [];
    for (const tx of priorInflows) {
      const tMs = new Date(tx.timestamp).getTime();
      if (tx.transaction_id !== traceableTxId && tMs <= firstTraceableTimeMs) {
        lots.push({
          source: 'UNRELATED',
          remaining: tx.amount,
          timestampMs: tMs,
        });
        accountHasMixedFunds.add(account);
      }
    }
    fifoQueues.set(account, lots);
    accountProcessedOutIndex.set(account, 0);
  };

  const addTraceableLot = (account: string, amount: number, timestampMs: number, txId: string) => {
    ensureAccountQueue(account, timestampMs, txId);
    const lots = fifoQueues.get(account)!;
    // Check if any unrelated credit arrived between previous lot and now
    const inflows = incomingByAccount.get(account) ?? [];
    for (const tx of inflows) {
      const tMs = new Date(tx.timestamp).getTime();
      if (
        tx.transaction_id !== txId &&
        tMs > originTimeMs &&
        tMs <= timestampMs &&
        !tracedTxIds.has(tx.transaction_id)
      ) {
        accountHasMixedFunds.add(account);
      }
    }
    lots.push({
      source: 'TRACEABLE',
      remaining: amount,
      timestampMs,
    });
    lots.sort((a, b) => a.timestampMs - b.timestampMs);
  };

  const consumeFifo = (account: string, debitAmount: number): { attributed: number; mixed: boolean } => {
    const lots = fifoQueues.get(account) ?? [];
    let toConsume = debitAmount;
    let attributed = 0;
    let mixed = accountHasMixedFunds.has(account);

    for (const lot of lots) {
      if (toConsume <= 0) break;
      if (lot.remaining <= 0) continue;
      const take = Math.min(lot.remaining, toConsume);
      lot.remaining -= take;
      toConsume -= take;
      if (lot.source === 'TRACEABLE') {
        attributed += take;
      } else {
        mixed = true;
      }
    }
    // If debit exceeded observed inflows, unobserved prior balance existed -> mixed!
    if (toConsume > 0) {
      mixed = true;
    }
    return { attributed: Math.round(attributed), mixed };
  };

  const tracedEdges: TraceEdgeResult[] = [];
  const tracedTxIds = new Set<string>([originTx.transaction_id]);
  const visitedAccounts = new Set<string>([originTx.sender_upi, originTx.receiver_upi]);
  const accountFirstHop = new Map<string, number>([
    [originTx.sender_upi, 0],
    [originTx.receiver_upi, 1],
  ]);

  // Hop 1: Original fraud transaction
  tracedEdges.push({
    transaction_id: originTx.transaction_id,
    utr: originTx.utr,
    timestamp: originTx.timestamp,
    sender_upi: originTx.sender_upi,
    receiver_upi: originTx.receiver_upi,
    amount: originTx.amount,
    potentially_attributed_amount: originTx.amount,
    attribution_status: 'DIRECT_FIFO',
    status: originTx.status,
    hop: 1,
    minutes_since_origin: 0,
    minutes_since_prev_inflow: 0,
    is_circular: false,
    channel: originTx.channel,
  });

  addTraceableLot(originTx.receiver_upi, originTx.amount, originTimeMs, originTx.transaction_id);

  // BFS queue by hop level
  interface QueueItem {
    account: string;
    hop: number;
    inflowTimeMs: number;
    pathAncestors: Set<string>;
  }

  const queue: QueueItem[] = [
    {
      account: originTx.receiver_upi,
      hop: 1,
      inflowTimeMs: originTimeMs,
      pathAncestors: new Set([originTx.sender_upi, originTx.receiver_upi]),
    },
  ];

  let circularDetected = false;
  const circularAccounts = new Set<string>();
  let totalOutgoingObserved = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hop >= maxHops) continue;

    const outgoing = outgoingByAccount.get(current.account) ?? [];
    for (const tx of outgoing) {
      if (tracedTxIds.has(tx.transaction_id)) continue;
      const txTimeMs = new Date(tx.timestamp).getTime();
      if (txTimeMs < current.inflowTimeMs || txTimeMs > maxTimeMs) continue;

      const isCircular = current.pathAncestors.has(tx.receiver_upi);

      if (tx.status !== 'SUCCESS') {
        // Show non-settled audit record if explicitly enabled, but do not propagate funds
        tracedTxIds.add(tx.transaction_id);
        tracedEdges.push({
          transaction_id: tx.transaction_id,
          utr: tx.utr,
          timestamp: tx.timestamp,
          sender_upi: tx.sender_upi,
          receiver_upi: tx.receiver_upi,
          amount: tx.amount,
          potentially_attributed_amount: 0,
          attribution_status: 'NON_SETTLED_EXCLUDED',
          status: tx.status,
          hop: current.hop + 1,
          minutes_since_origin: Math.round((txTimeMs - originTimeMs) / 60_000),
          minutes_since_prev_inflow: Math.round((txTimeMs - current.inflowTimeMs) / 60_000),
          is_circular: isCircular,
          channel: tx.channel,
        });
        continue;
      }

      // Check remaining traceable balance in current account before consuming
      const lots = fifoQueues.get(current.account) ?? [];
      const remainingTraceable = lots
        .filter((l) => l.source === 'TRACEABLE')
        .reduce((acc, l) => acc + l.remaining, 0);
      if (remainingTraceable <= 0) continue;

      const { attributed, mixed } = consumeFifo(current.account, tx.amount);
      if (attributed <= 0 && !isCircular) continue;

      tracedTxIds.add(tx.transaction_id);
      totalOutgoingObserved += tx.amount;

      if (isCircular) {
        circularDetected = true;
        circularAccounts.add(tx.sender_upi);
        circularAccounts.add(tx.receiver_upi);
      }

      const nextHop = current.hop + 1;
      visitedAccounts.add(tx.receiver_upi);
      if (!accountFirstHop.has(tx.receiver_upi)) {
        accountFirstHop.set(tx.receiver_upi, nextHop);
      }

      tracedEdges.push({
        transaction_id: tx.transaction_id,
        utr: tx.utr,
        timestamp: tx.timestamp,
        sender_upi: tx.sender_upi,
        receiver_upi: tx.receiver_upi,
        amount: tx.amount,
        potentially_attributed_amount: attributed,
        attribution_status: mixed ? 'ESTIMATED_MIXED_FUNDS' : 'DIRECT_FIFO',
        status: tx.status,
        hop: nextHop,
        minutes_since_origin: Math.round((txTimeMs - originTimeMs) / 60_000),
        minutes_since_prev_inflow: Math.round((txTimeMs - current.inflowTimeMs) / 60_000),
        is_circular: isCircular,
        channel: tx.channel,
      });

      // Continue propagating if not a circular return back to an already-visited ancestor
      if (!isCircular && attributed > 0) {
        addTraceableLot(tx.receiver_upi, attributed, txTimeMs, tx.transaction_id);
        const nextAncestors = new Set(current.pathAncestors);
        nextAncestors.add(tx.receiver_upi);
        queue.push({
          account: tx.receiver_upi,
          hop: nextHop,
          inflowTimeMs: txTimeMs,
          pathAncestors: nextAncestors,
        });
      }
    }
  }

  // Compute attributed onward flow from hop 2 (first onward movement from initial recipient)
  const hop2Attributed = tracedEdges
    .filter((e) => e.hop === 2 && e.status === 'SUCCESS')
    .reduce((sum, e) => sum + e.potentially_attributed_amount, 0);
  const totalPotentiallyAttributed = Math.min(originTx.amount, hop2Attributed);
  const untracedAmount = Math.max(0, originTx.amount - totalPotentiallyAttributed);
  const mixedFundsDetected =
    accountHasMixedFunds.size > 0 ||
    tracedEdges.some((e) => e.attribution_status === 'ESTIMATED_MIXED_FUNDS');

  // Pattern detection on the traced subgraph
  const patterns: TracePatternFlag[] = [];
  const outDegree = new Map<string, Set<string>>();
  const inDegree = new Map<string, Set<string>>();
  const rapidAccounts = new Set<string>();
  let observedMaxHop = 1;

  for (const edge of tracedEdges) {
    if (edge.status !== 'SUCCESS') continue;
    observedMaxHop = Math.max(observedMaxHop, edge.hop);
    if (edge.hop >= 2) {
      if (!outDegree.has(edge.sender_upi)) outDegree.set(edge.sender_upi, new Set());
      outDegree.get(edge.sender_upi)!.add(edge.receiver_upi);
      if (!inDegree.has(edge.receiver_upi)) inDegree.set(edge.receiver_upi, new Set());
      inDegree.get(edge.receiver_upi)!.add(edge.sender_upi);
      if (edge.minutes_since_prev_inflow <= 60) {
        rapidAccounts.add(edge.sender_upi);
      }
    }
  }

  const fanOutAccts = [...outDegree.entries()]
    .filter(([, targets]) => targets.size >= 2)
    .map(([acct]) => acct);
  if (fanOutAccts.length > 0) {
    patterns.push({
      code: 'ONE_TO_MANY',
      label: 'One-to-Many Dispersion',
      detail: `${fanOutAccts.length} account(s) split incoming funds across multiple downstream recipients.`,
      accounts: fanOutAccts,
    });
  }

  const fanInAccts = [...inDegree.entries()]
    .filter(([, sources]) => sources.size >= 2)
    .map(([acct]) => acct);
  if (fanInAccts.length > 0) {
    patterns.push({
      code: 'MANY_TO_ONE',
      label: 'Many-to-One Aggregation',
      detail: `Multiple traced branches converged into ${fanInAccts.length} common downstream recipient(s).`,
      accounts: fanInAccts,
    });
    patterns.push({
      code: 'COMMON_DOWNSTREAM',
      label: 'Common Downstream Recipient',
      detail: `Shared downstream concentration observed at ${fanInAccts.join(', ')}.`,
      accounts: fanInAccts,
    });
  }

  if (rapidAccounts.size > 0) {
    patterns.push({
      code: 'RAPID_PASS_THROUGH',
      label: 'Rapid Pass-Through (≤ 60m)',
      detail: `${rapidAccounts.size} account(s) forwarded funds within 60 minutes of receipt.`,
      accounts: [...rapidAccounts],
    });
  }

  if (observedMaxHop >= 3) {
    patterns.push({
      code: 'MULTI_HOP',
      label: `Multi-Hop Layering (${observedMaxHop} Hops)`,
      detail: `Funds traversed ${observedMaxHop} sequential transaction hops within the ${params.windowHours}h window.`,
      accounts: [...visitedAccounts].filter((a) => a !== originTx.sender_upi),
    });
  }

  if (circularDetected) {
    patterns.push({
      code: 'CIRCULAR_FLOW',
      label: 'Circular Transaction Loop',
      detail: `Traced funds returned to a previously visited account (${[...circularAccounts].join(', ')}).`,
      accounts: [...circularAccounts],
    });
  }

  // Build nodes list for trace visualization
  const nodes: NetworkNode[] = [...visitedAccounts].map((acct) => {
    const hop = accountFirstHop.get(acct) ?? 2;
    let role: AccountRole = 'INTERMEDIARY';
    if (acct === originTx.sender_upi) role = 'VICTIM';
    else if (acct === originTx.receiver_upi) role = 'INITIAL_RECIPIENT';
    else if (!outDegree.has(acct) || outDegree.get(acct)!.size === 0) role = 'DOWNSTREAM';

    const inc = tracedEdges
      .filter((e) => e.receiver_upi === acct && e.status === 'SUCCESS')
      .reduce((s, e) => s + e.amount, 0);
    const out = tracedEdges
      .filter((e) => e.sender_upi === acct && e.status === 'SUCCESS')
      .reduce((s, e) => s + e.amount, 0);

    return {
      id: acct,
      label: acct,
      role,
      risk_score: hop === 0 ? 0 : 50,
      risk_category: hop === 0 ? 'LOW' : 'MEDIUM',
      connected_complaints: [complaint.complaint_id],
      total_incoming: inc,
      total_outgoing: out,
      is_shared_account: false,
    };
  });

  const timeline = [...tracedEdges].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return {
    trace_id: traceId,
    dataset_id: datasetId,
    generated_at: new Date().toISOString(),
    parameters: params,
    complaint,
    original_amount: originTx.amount,
    total_outgoing_observed: totalOutgoingObserved,
    total_potentially_attributed: totalPotentiallyAttributed,
    untraced_amount: untracedAmount,
    mixed_funds_detected: mixedFundsDetected,
    attribution_method: 'Conservative Chronological FIFO Queue',
    attribution_assumptions: attributionAssumptions,
    patterns,
    nodes,
    edges: tracedEdges,
    timeline,
    warnings,
  };
}

/**
 * Deterministic realistic account balance derivation when an explicit CBS
 * balance snapshot is not supplied. Uses a stable string hash + net observed
 * inflows so demo accounts display realistic mixed clean + disputed balances.
 */
export function computeDeterministicAccountBalance(
  accountId: string,
  totalIncoming: number,
  totalOutgoing: number,
): number {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) {
    hash = (hash * 31 + accountId.charCodeAt(i)) >>> 0;
  }
  const baseCleanReserve = 85_000 + (hash % 18) * 15_000; // ₹85,000 – ₹3,40,000
  const retainedNet = Math.max(0, totalIncoming - totalOutgoing);
  return Math.round(baseCleanReserve + Math.min(retainedNet, 250_000));
}

/**
 * 100% deterministic Precision Lien Protocol mathematical engine.
 * Traces the Directed Acyclic Graph (DAG) of a complaint's stolen funds using
 * conservative chronological FIFO attribution and computes:
 *
 *   heldAmount = Math.min(taintedReceived, currentAccountBalance, victimDeficit)
 *   usableCleanBalance = currentAccountBalance - heldAmount
 *
 * Strictly zero LLM or probabilistic inputs are used for monetary math.
 */
export function calculatePrecisionLien(
  accountId: string,
  complaintId: string,
  complaints: FraudComplaint[],
  transactions: TransactionRecord[],
  currentAccountBalance: number,
  victimDeficitOverride?: number,
): PrecisionLienCalculation {
  const normalizedAccount = normalizeUpi(accountId);
  const safeBalance = Math.max(0, Math.round(currentAccountBalance));

  const matchedList = matchComplaintsToLedger(complaints, transactions);
  const complaint = matchedList.find((c) => c.complaint_id === complaintId);

  if (!complaint) {
    return {
      accountId: normalizedAccount,
      complaintId,
      totalBalance: safeBalance,
      taintedReceived: 0,
      victimDeficit: 0,
      heldAmount: 0,
      usableCleanBalance: safeBalance,
      hopDepth: 0,
      matchedUtrs: [],
      supportingTransactionIds: [],
      reasonCodes: ['COMPLAINT_NOT_FOUND'],
      explanation: `Complaint ${complaintId} was not found in the active dataset; no precision lien can be computed.`,
      formulaSummary: `min(₹0, ₹${safeBalance.toLocaleString('en-IN')}, ₹0) = ₹0`,
    };
  }

  const victimDeficit = Math.max(
    0,
    Math.round(
      typeof victimDeficitOverride === 'number'
        ? victimDeficitOverride
        : complaint.amount,
    ),
  );

  if (complaint.match_status !== 'MATCHED_SUCCESS' || !complaint.matched_transaction) {
    return {
      accountId: normalizedAccount,
      complaintId,
      totalBalance: safeBalance,
      taintedReceived: 0,
      victimDeficit,
      heldAmount: 0,
      usableCleanBalance: safeBalance,
      hopDepth: 0,
      matchedUtrs: complaint.utr ? [complaint.utr] : [],
      supportingTransactionIds: [],
      reasonCodes: ['NON_SETTLED_OR_UNMATCHED_SOURCE'],
      explanation: `Reported transfer for ${complaintId} has ledger status ${complaint.match_status}. Per RBI SOP, no lien may be placed without a verified settled debit.`,
      formulaSummary: `min(₹0, ₹${safeBalance.toLocaleString('en-IN')}, ₹${victimDeficit.toLocaleString('en-IN')}) = ₹0`,
    };
  }

  // Trace the Directed Acyclic Graph (DAG) of settled funds forward using conservative FIFO
  const trace = traceComplaintFunds('precision-lien', complaint, transactions, {
    complaintId: complaint.complaint_id,
    maxHops: 5,
    windowHours: 72,
    minAmount: 0,
    statuses: ['SUCCESS'],
  });

  // Collect all acyclic settled incoming edges targeting this account
  const incomingDagEdges = trace.edges.filter(
    (e) =>
      e.status === 'SUCCESS' &&
      !e.is_circular &&
      normalizeUpi(e.receiver_upi) === normalizedAccount,
  );

  const rawTaintedReceived = incomingDagEdges.reduce(
    (sum, e) => sum + e.potentially_attributed_amount,
    0,
  );
  // Tainted inflow attributed to one complaint can never exceed the complaint's settled origin amount
  const taintedReceived = Math.min(complaint.amount, Math.round(rawTaintedReceived));

  // Core deterministic precision lien formula
  const heldAmount = Math.max(
    0,
    Math.min(taintedReceived, safeBalance, victimDeficit),
  );
  const usableCleanBalance = Math.max(0, safeBalance - heldAmount);

  const hopDepth = incomingDagEdges.reduce(
    (minHop, e) => Math.min(minHop, e.hop),
    incomingDagEdges.length > 0 ? Number.POSITIVE_INFINITY : 0,
  );
  const matchedUtrs = [...new Set(incomingDagEdges.map((e) => e.utr).filter(Boolean))];
  const supportingTransactionIds = [
    ...new Set(incomingDagEdges.map((e) => e.transaction_id)),
  ];

  const reasonCodes: string[] = [];
  if (taintedReceived <= 0) {
    reasonCodes.push('NO_TAINTED_DAG_INFLOW_ATTRIBUTED');
  } else {
    reasonCodes.push(
      hopDepth === 1 ? 'FIFO_HOP1_DIRECT_ATTRIBUTION' : `FIFO_HOP${hopDepth}_DAG_ATTRIBUTION`,
    );
    if (trace.mixed_funds_detected) {
      reasonCodes.push('CONSERVATIVE_FIFO_MIXED_FUNDS_APPLIED');
    }
    if (usableCleanBalance > 0) {
      reasonCodes.push('CLEAN_OPERATING_BALANCE_PROTECTED');
    }
    if (heldAmount === safeBalance && safeBalance < taintedReceived) {
      reasonCodes.push('HOLD_CAPPED_AT_AVAILABLE_BALANCE');
    }
    if (heldAmount === victimDeficit && victimDeficit < taintedReceived) {
      reasonCodes.push('HOLD_CAPPED_AT_VICTIM_DEFICIT');
    }
  }

  const explanation =
    taintedReceived <= 0
      ? `Account ${normalizedAccount} did not receive settled FIFO-attributed funds along the directed path of ${complaintId}. Zero lien recommended.`
      : `Deterministic FIFO DAG trace attributed ₹${taintedReceived.toLocaleString('en-IN')} across ${incomingDagEdges.length} settled hop-${hopDepth} transfer(s) from ${complaintId}. Holding exactly ₹${heldAmount.toLocaleString('en-IN')} protects ₹${usableCleanBalance.toLocaleString('en-IN')} in clean customer funds (avoiding blanket account freeze).`;

  const formulaSummary = `min(tainted ₹${taintedReceived.toLocaleString('en-IN')}, balance ₹${safeBalance.toLocaleString('en-IN')}, deficit ₹${victimDeficit.toLocaleString('en-IN')}) = ₹${heldAmount.toLocaleString('en-IN')}`;

  return {
    accountId: normalizedAccount,
    complaintId,
    totalBalance: safeBalance,
    taintedReceived,
    victimDeficit,
    heldAmount,
    usableCleanBalance,
    hopDepth: Number.isFinite(hopDepth) ? hopDepth : 0,
    matchedUtrs,
    supportingTransactionIds,
    reasonCodes,
    explanation,
    formulaSummary,
  };
}

// ---------------------------------------------------------------------------
// 4 ADVANCED DETERMINISTIC DETECTION RULES & OFFICIAL RBI MONEY MULE SOP ENGINE
// (RBI Draft KYC Amendment Directions, 2026 — Annex III, effective April 1, 2027)
// ---------------------------------------------------------------------------

export const PROTECTED_BRAND_DICTIONARY = [
  'patanjali',
  'sbi',
  'sbi.upi',
  'hdfc',
  'hdfcbank',
  'icici',
  'axisbank',
  'paytm',
  'phonepe',
  'amazonpay',
  'flipkart',
  'irctc',
  'jiomart',
  'airtel',
  'zomato',
  'swiggy',
  'bharatpe',
  'npci',
  'uidai',
  'licindia',
  'tataneu',
  'reliance',
  'incometax',
];

/** Exact deterministic Levenshtein edit distance */
export function levenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/** Deterministic homoglyph normalizer (e.g., 0->o, 1->l, 3->e, 5->s, rn->m) */
export function normalizeHomoglyphs(input: string): string {
  return input
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's');
}

function collapseDoubleLetters(input: string): string {
  return input.replace(/(.)\1+/g, '$1');
}

/**
 * Rule 4: Lookalike VPA / Brand Impersonation (`RULE_SUSPICIOUS_LOOKALIKE_VPA`)
 * Deterministic Levenshtein (<= 2) + homoglyph / double-letter checks against
 * protected brand/merchant dictionary.
 */
export function evaluateLookalikeVpa(
  upiId: string,
  uniqueSenders: number,
  isNewlyRegisteredVpa?: boolean,
): TriggeredDetectionRule | null {
  const normalized = normalizeUpi(upiId);
  const handle = normalized.split('@')[0] ?? '';
  if (!handle || handle.length < 3) return null;

  // Exclude exact legitimate brand handles
  if (PROTECTED_BRAND_DICTIONARY.includes(handle)) return null;

  const homoglyphNorm = normalizeHomoglyphs(handle);
  const collapsed = collapseDoubleLetters(homoglyphNorm);

  let matchedBrand: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let matchMode = 'edit-distance';

  for (const brand of PROTECTED_BRAND_DICTIONARY) {
    const brandCollapsed = collapseDoubleLetters(brand);

    if (handle !== brand && homoglyphNorm === brand) {
      matchedBrand = brand;
      bestDistance = levenshteinDistance(handle, brand);
      matchMode = 'homoglyph-substitution';
      break;
    }

    if (handle !== brand && collapsed === brandCollapsed && Math.abs(handle.length - brand.length) <= 2) {
      matchedBrand = brand;
      bestDistance = levenshteinDistance(handle, brand);
      matchMode = 'double-letter-spoof';
      break;
    }

    if (brand.length >= 4 && Math.abs(handle.length - brand.length) <= 2) {
      const dist = levenshteinDistance(handle, brand);
      const normDist = levenshteinDistance(homoglyphNorm, brand);
      const effectiveDist = Math.min(dist, normDist);
      if (effectiveDist >= 1 && effectiveDist <= 2 && effectiveDist < bestDistance) {
        bestDistance = effectiveDist;
        matchedBrand = brand;
        matchMode = normDist < dist ? 'homoglyph+levenshtein' : 'levenshtein';
      }
    }
  }

  if (!matchedBrand) return null;

  // Trigger when newly registered or receiving transfers from multiple first-time payers
  if (isNewlyRegisteredVpa === false && uniqueSenders < 3) return null;
  if (!isNewlyRegisteredVpa && uniqueSenders < 2) return null;

  return {
    code: 'RULE_SUSPICIOUS_LOOKALIKE_VPA',
    name: 'Lookalike VPA / Brand Impersonation',
    severity: 'HIGH',
    points: 40,
    reason: 'Suspected lookalike VPA / brand impersonation scam.',
    metricSummary: `Handle "${handle}" impersonates "${matchedBrand}" (edit distance ${bestDistance}, ${uniqueSenders} first-time payers)`,
    evidence: {
      vpaHandle: handle,
      impersonatedBrand: matchedBrand,
      editDistance: bestDistance,
      detectionMethod: matchMode,
      firstTimePayers: uniqueSenders,
      isNewlyRegisteredVpa: Boolean(isNewlyRegisteredVpa),
    },
  };
}

/**
 * Official RBI Money Mule SOP (Annex III, effective April 1, 2027) statutory
 * deadline & 6-step phase calculator.
 */
export function computeRbiSopStatutorySchedule(
  holdTimestampIso: string,
  heldAmount: number,
  cbsRef: string,
  isAccountLevel: boolean,
  dayCount = 0,
  explicitStep?: RbiSopStepNumber,
): {
  rbiSopStep: RbiSopStepNumber;
  temporaryDebitHold: TemporaryDebitHold;
  statutoryDeadlines: StatutoryDeadlines;
} {
  const baseMs = Number.isNaN(Date.parse(holdTimestampIso))
    ? Date.now()
    : new Date(holdTimestampIso).getTime();
  const addDaysIso = (days: number) =>
    new Date(baseMs + days * 86_400_000).toISOString();

  let derivedStep: RbiSopStepNumber = 2;
  if (explicitStep) {
    derivedStep = explicitStep;
  } else if (dayCount >= 61) {
    derivedStep = 6;
  } else if (dayCount >= 31) {
    derivedStep = 5;
  } else if (dayCount >= 21) {
    derivedStep = 4;
  } else if (dayCount >= 1) {
    derivedStep = 3;
  } else {
    derivedStep = 2;
  }

  return {
    rbiSopStep: derivedStep,
    temporaryDebitHold: {
      amount: Math.max(0, Math.round(heldAmount)),
      timestamp: new Date(baseMs).toISOString(),
      cbsRef,
      isAccountLevel,
    },
    statutoryDeadlines: {
      customerExplanationDue: addDaysIso(20),
      bankReviewDue: addDaysIso(30),
      leaResponseDue: addDaysIso(60),
      maxHoldExpiry: addDaysIso(61),
    },
  };
}

function deriveDefaultSixMonthHistory(
  accountId: string,
  totalInc: number,
  occupation?: AccountKycProfile['occupation'],
): Array<{ month: string; volume: number }> {
  const months = ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'];
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) {
    hash = (hash * 31 + accountId.charCodeAt(i)) >>> 0;
  }
  const base =
    occupation === 'Student'
      ? 3_000 + (hash % 5) * 600
      : occupation === 'Merchant'
      ? Math.max(150_000, Math.round(totalInc * 0.85))
      : Math.max(25_000, Math.round(totalInc * 0.65));

  return months.map((month, idx) => {
    const jitter = 0.88 + (((hash >> (idx * 3)) & 0x7) / 7) * 0.24;
    return { month, volume: Math.round((base * jitter) / 100) * 100 };
  });
}

export interface DetectionRuleInput {
  upiId: string;
  isVictim: boolean;
  kyc?: AccountKycProfile;
  maxSingleCredit: number;
  peak24hCreditVolume: number;
  peak24hCreditCount: number;
  sixMonthAvgMonthlyVolume: number;
  hasExplicitHistoricalBaseline: boolean;
  maxFanOut30m: number;
  rapidNcrpMultiHop?: {
    hop: number;
    latencyMinutes: number;
    complaintId: string;
  } | null;
  uniqueSenders: number;
}

/**
 * Evaluates all 4 deterministic detection rules cleanly with zero probabilistic / LLM inputs.
 */
export function evaluateDeterministicDetectionRules(
  input: DetectionRuleInput,
): TriggeredDetectionRule[] {
  if (input.isVictim) return [];
  const triggered: TriggeredDetectionRule[] = [];

  // Rule 1: Student Account ₹1 Lakh Outlier (RULE_STUDENT_TIER_OVERFLOW)
  const isStudentProfile =
    input.kyc?.occupation === 'Student' ||
    (typeof input.kyc?.age === 'number' && input.kyc.age < 22);
  if (
    isStudentProfile &&
    (input.maxSingleCredit >= 100_000 || input.peak24hCreditVolume >= 100_000)
  ) {
    triggered.push({
      code: 'RULE_STUDENT_TIER_OVERFLOW',
      name: 'Student Account ₹1 Lakh Outlier',
      severity: 'HIGH',
      points: 40,
      reason: 'Transaction volume disproportionate to declared student profile.',
      metricSummary: `₹${Math.max(input.maxSingleCredit, input.peak24hCreditVolume).toLocaleString('en-IN')} credited within 24h on Student KYC (Age ${input.kyc?.age ?? 'N/A'})`,
      evidence: {
        declaredOccupation: input.kyc?.occupation ?? 'Student',
        age: input.kyc?.age ?? 0,
        maxSingleCredit: input.maxSingleCredit,
        peak24hCreditVolume: input.peak24hCreditVolume,
        thresholdInr: 100_000,
      },
    });
  }

  // Rule 2: 6-Month Baseline Anomaly & Velocity Spike (RULE_6M_HISTORICAL_VOL_SPIKE)
  const accountAgeMonths = input.kyc?.accountAgeMonths ?? 0;
  if (input.hasExplicitHistoricalBaseline && accountAgeMonths > 6) {
    const avgMonthly = input.sixMonthAvgMonthlyVolume;
    const isDormant = avgMonthly < 5_000;
    const dormantTriggered = isDormant && input.peak24hCreditVolume > 50_000;
    const activeSpikeTriggered =
      !isDormant &&
      avgMonthly > 0 &&
      input.peak24hCreditVolume > avgMonthly * 3.5 &&
      input.peak24hCreditCount >= 4;

    if (dormantTriggered || activeSpikeTriggered) {
      const multiplier =
        avgMonthly > 0
          ? Number((input.peak24hCreditVolume / avgMonthly).toFixed(1))
          : 0;
      triggered.push({
        code: 'RULE_6M_HISTORICAL_VOL_SPIKE',
        name: '6-Month Baseline Anomaly & Velocity Spike',
        severity: 'CRITICAL',
        points: 45,
        reason: 'Sudden velocity spike relative to 6-month transaction profile.',
        metricSummary: isDormant
          ? `Dormant account (avg ₹${avgMonthly.toLocaleString('en-IN')}/mo) spiked to ₹${input.peak24hCreditVolume.toLocaleString('en-IN')} in 24h`
          : `24h inflow ₹${input.peak24hCreditVolume.toLocaleString('en-IN')} (${input.peak24hCreditCount} txs) is ${multiplier}× the ₹${avgMonthly.toLocaleString('en-IN')}/mo 6m avg`,
        evidence: {
          accountAgeMonths,
          sixMonthAvgMonthlyVolume: avgMonthly,
          peak24hCreditVolume: input.peak24hCreditVolume,
          peak24hCreditCount: input.peak24hCreditCount,
          spikeMultiple: multiplier,
          dormantProfile: isDormant,
        },
      });
    }
  }

  // Rule 3: Branching Multi-Hop Layering (RULE_BRANCHING_MULTI_HOP_DAG)
  const hasRapidFanOut = input.maxFanOut30m >= 3;
  const hasRapidMultiHopNcrp = Boolean(input.rapidNcrpMultiHop);
  if (hasRapidFanOut || hasRapidMultiHopNcrp) {
    const detailParts: string[] = [];
    if (hasRapidFanOut) {
      detailParts.push(`branched into ${input.maxFanOut30m} distinct recipients within 30m`);
    }
    if (input.rapidNcrpMultiHop) {
      detailParts.push(
        `Hop ${input.rapidNcrpMultiHop.hop} on ${input.rapidNcrpMultiHop.complaintId} (${input.rapidNcrpMultiHop.latencyMinutes}m latency ≤ 120m)`,
      );
    }
    triggered.push({
      code: 'RULE_BRANCHING_MULTI_HOP_DAG',
      name: 'Branching Multi-Hop Layering',
      severity: 'CRITICAL',
      points: 50,
      reason: 'Detected multi-hop branching and rapid fan-out layering.',
      metricSummary: detailParts.join(' · '),
      evidence: {
        maxFanOutWithin30m: input.maxFanOut30m,
        ncrpMultiHopDepth: input.rapidNcrpMultiHop?.hop ?? 0,
        hopLatencyMinutes: input.rapidNcrpMultiHop?.latencyMinutes ?? 0,
        ncrpComplaintId: input.rapidNcrpMultiHop?.complaintId ?? '',
      },
    });
  }

  // Rule 4: Lookalike VPA / Brand Impersonation (RULE_SUSPICIOUS_LOOKALIKE_VPA)
  const lookalikeRule = evaluateLookalikeVpa(
    input.upiId,
    input.uniqueSenders,
    input.kyc?.isNewlyRegisteredVpa,
  );
  if (lookalikeRule) {
    triggered.push(lookalikeRule);
  }

  return triggered;
}

export interface FullDatasetAnalysis {
  complaints: MatchedComplaint[];
  accounts: Map<string, AccountProfile>;
  accountsList: AccountProfile[];
  clusters: NetworkCluster[];
  alerts: AlertItem[];
}

/**
 * Runs complete deterministic cross-complaint intelligence, Graphology cluster
 * discovery, and 6-signal explainable 0-100 risk scoring on a dataset.
 * Never uses ground-truth labels as detection inputs.
 */
export function analyzeDataset(
  datasetId: string,
  rawComplaints: FraudComplaint[],
  transactions: TransactionRecord[],
  riskConfig: RiskWeightsConfig = DEFAULT_RISK_CONFIG,
  accountStates?: Record<string, AccountLienState>,
  accountKycProfiles?: Record<string, AccountKycProfile>,
): FullDatasetAnalysis {
  const matchedComplaints = matchComplaintsToLedger(rawComplaints, transactions);
  const successTxs = transactions.filter((t) => t.status === 'SUCCESS');

  // Collect all unique accounts from complaints and transactions
  const allAccounts = new Set<string>();
  const victimSet = new Set<string>();
  const initialRecipientSet = new Set<string>();

  for (const c of matchedComplaints) {
    allAccounts.add(c.sender_upi);
    allAccounts.add(c.receiver_upi);
    victimSet.add(c.sender_upi);
    initialRecipientSet.add(c.receiver_upi);
  }
  for (const t of transactions) {
    allAccounts.add(t.sender_upi);
    allAccounts.add(t.receiver_upi);
  }

  // Per-account ledger aggregations (SUCCESS transactions only for fund-flow stats)
  const incomingTxsByAcct = new Map<string, TransactionRecord[]>();
  const outgoingTxsByAcct = new Map<string, TransactionRecord[]>();
  const neighborsByAcct = new Map<string, Set<string>>();

  for (const acct of allAccounts) {
    incomingTxsByAcct.set(acct, []);
    outgoingTxsByAcct.set(acct, []);
    neighborsByAcct.set(acct, new Set());
  }

  for (const tx of successTxs) {
    incomingTxsByAcct.get(tx.receiver_upi)!.push(tx);
    outgoingTxsByAcct.get(tx.sender_upi)!.push(tx);
    neighborsByAcct.get(tx.sender_upi)!.add(tx.receiver_upi);
    neighborsByAcct.get(tx.receiver_upi)!.add(tx.sender_upi);
  }

  // Run multi-hop forward traces for every matched successful complaint
  const accountComplaints = new Map<string, Set<string>>();
  const accountMaxHop = new Map<string, number>();
  const accountCircular = new Set<string>();
  const accountSupportingTxs = new Map<string, Set<string>>();
  const accountRapidNcrpMultiHop = new Map<
    string,
    { hop: number; latencyMinutes: number; complaintId: string }
  >();
  const complaintTraces = new Map<string, TraceResult>();

  for (const acct of allAccounts) {
    accountComplaints.set(acct, new Set());
    accountMaxHop.set(acct, 0);
    accountSupportingTxs.set(acct, new Set());
  }

  for (const cmp of matchedComplaints) {
    accountComplaints.get(cmp.sender_upi)!.add(cmp.complaint_id);
    accountComplaints.get(cmp.receiver_upi)!.add(cmp.complaint_id);

    if (cmp.match_status !== 'MATCHED_SUCCESS') continue;

    const trace = traceComplaintFunds(datasetId, cmp, transactions, {
      complaintId: cmp.complaint_id,
      maxHops: 5,
      windowHours: 72,
      minAmount: 1000,
      statuses: ['SUCCESS'],
    });
    complaintTraces.set(cmp.complaint_id, trace);
    cmp.linked_account_count = trace.nodes.length;
    cmp.traced_hops = trace.edges.reduce((m, e) => Math.max(m, e.hop), 0);

    for (const edge of trace.edges) {
      if (edge.status !== 'SUCCESS') continue;
      accountComplaints.get(edge.sender_upi)!.add(cmp.complaint_id);
      accountComplaints.get(edge.receiver_upi)!.add(cmp.complaint_id);
      accountSupportingTxs.get(edge.sender_upi)!.add(edge.transaction_id);
      accountSupportingTxs.get(edge.receiver_upi)!.add(edge.transaction_id);
      accountMaxHop.set(
        edge.receiver_upi,
        Math.max(accountMaxHop.get(edge.receiver_upi) ?? 0, edge.hop),
      );
      if (
        edge.hop >= 2 &&
        edge.hop <= 4 &&
        edge.minutes_since_prev_inflow <= 120
      ) {
        const existing = accountRapidNcrpMultiHop.get(edge.receiver_upi);
        if (!existing || edge.minutes_since_prev_inflow < existing.latencyMinutes) {
          accountRapidNcrpMultiHop.set(edge.receiver_upi, {
            hop: edge.hop,
            latencyMinutes: edge.minutes_since_prev_inflow,
            complaintId: cmp.complaint_id,
          });
        }
      }
      if (edge.is_circular) {
        accountCircular.add(edge.sender_upi);
        accountCircular.add(edge.receiver_upi);
      }
    }
  }

  // Build Graphology graph of non-victim complaint-linked accounts to discover connected clusters
  const clusterGraph = new Graph({ type: 'undirected', multi: false });
  const edgeMetaMap = new Map<
    string,
    {
      tx: TransactionRecord;
      hop: number;
      complaints: Set<string>;
      isCircular: boolean;
    }
  >();

  for (const [cmpId, trace] of complaintTraces.entries()) {
    for (const edge of trace.edges) {
      if (edge.status !== 'SUCCESS') continue;
      const existing = edgeMetaMap.get(edge.transaction_id);
      if (existing) {
        existing.complaints.add(cmpId);
        existing.isCircular = existing.isCircular || edge.is_circular;
      } else {
        const rawTx = successTxs.find((t) => t.transaction_id === edge.transaction_id);
        if (rawTx) {
          edgeMetaMap.set(edge.transaction_id, {
            tx: rawTx,
            hop: edge.hop,
            complaints: new Set([cmpId]),
            isCircular: edge.is_circular,
          });
        }
      }

      // Add non-victim accounts into the correlation graph
      if (!victimSet.has(edge.receiver_upi) && !clusterGraph.hasNode(edge.receiver_upi)) {
        clusterGraph.addNode(edge.receiver_upi);
      }
      if (!victimSet.has(edge.sender_upi)) {
        if (!clusterGraph.hasNode(edge.sender_upi)) clusterGraph.addNode(edge.sender_upi);
        if (
          !victimSet.has(edge.receiver_upi) &&
          edge.sender_upi !== edge.receiver_upi &&
          !clusterGraph.hasEdge(edge.sender_upi, edge.receiver_upi)
        ) {
          clusterGraph.addEdge(edge.sender_upi, edge.receiver_upi);
        }
      }
    }
  }

  // Extract connected components using graphology-components
  const rawComponents = connectedComponents(clusterGraph);
  const accountToCluster = new Map<string, string>();
  const clusterComponents: Array<{
    accounts: string[];
    complaintIds: string[];
    totalAmount: number;
  }> = [];

  for (const comp of rawComponents) {
    const linkedCmpIds = new Set<string>();
    for (const acct of comp) {
      for (const cId of accountComplaints.get(acct) ?? []) {
        linkedCmpIds.add(cId);
      }
    }
    // A cross-complaint network cluster links >= 2 complaints OR >= 3 accounts in a multi-hop trail
    if (linkedCmpIds.size >= 2 || comp.length >= 3) {
      let totalAmount = 0;
      for (const cId of linkedCmpIds) {
        const cmp = matchedComplaints.find((c) => c.complaint_id === cId);
        if (cmp) totalAmount += cmp.amount;
      }
      clusterComponents.push({
        accounts: comp,
        complaintIds: [...linkedCmpIds].sort(),
        totalAmount,
      });
    }
  }

  clusterComponents.sort((a, b) => b.complaintIds.length - a.complaintIds.length || b.totalAmount - a.totalAmount);

  const clusterIdsByIndex = clusterComponents.map((_, idx) => `NET-${String(idx + 1).padStart(3, '0')}`);
  clusterComponents.forEach((cc, idx) => {
    const cid = clusterIdsByIndex[idx];
    for (const acct of cc.accounts) {
      accountToCluster.set(acct, cid);
    }
    for (const cmpId of cc.complaintIds) {
      const cmp = matchedComplaints.find((c) => c.complaint_id === cmpId);
      if (cmp) cmp.cluster_id = cid;
    }
  });

  // Helper: calculate sliding-window velocity & rapid pass-through for an account
  const computeAccountBehavioralMetrics = (acct: string) => {
    const inc = incomingTxsByAcct.get(acct) ?? [];
    const out = outgoingTxsByAcct.get(acct) ?? [];
    const allAcctTxs = [...inc, ...out].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Max transactions in any 1h and 24h sliding window
    let max1h = 0;
    let max24h = 0;
    let left1h = 0;
    let left24h = 0;
    const times = allAcctTxs.map((t) => new Date(t.timestamp).getTime());

    for (let right = 0; right < times.length; right++) {
      while (times[right] - times[left1h] > 3_600_000) left1h++;
      while (times[right] - times[left24h] > 86_400_000) left24h++;
      max1h = Math.max(max1h, right - left1h + 1);
      max24h = Math.max(max24h, right - left24h + 1);
    }

    // Rapid pass-through: % of incoming funds followed by outgoing transfers within 60 minutes
    const totalInc = inc.reduce((s, t) => s + t.amount, 0);
    const totalOut = out.reduce((s, t) => s + t.amount, 0);
    let rapidForwarded = 0;

    if (totalInc > 0 && out.length > 0) {
      for (const inTx of inc) {
        const inMs = new Date(inTx.timestamp).getTime();
        let matchedOutForIn = 0;
        for (const outTx of out) {
          const outMs = new Date(outTx.timestamp).getTime();
          if (outMs >= inMs && outMs <= inMs + 3_600_000) {
            matchedOutForIn += outTx.amount;
          }
        }
        rapidForwarded += Math.min(inTx.amount, matchedOutForIn);
      }
    }

    const rapidPassThroughPct = totalInc > 0 ? Math.min(100, Math.round((rapidForwarded / totalInc) * 100)) : 0;
    const uniqueSenders = new Set(inc.map((t) => t.sender_upi)).size;
    const uniqueRecipients = new Set(out.map((t) => t.receiver_upi)).size;
    const firstTransactionAt = allAcctTxs[0]?.timestamp;
    const lastTransactionAt = allAcctTxs[allAcctTxs.length - 1]?.timestamp;

    // Max single incoming credit + rolling 24h peak incoming credit volume & tx count
    const sortedInc = [...inc].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    let maxSingleCredit = 0;
    let peak24hCreditVolume = 0;
    let peak24hCreditCount = 0;
    let incLeft = 0;
    let windowSum = 0;
    const incTimes = sortedInc.map((t) => new Date(t.timestamp).getTime());

    for (let right = 0; right < sortedInc.length; right++) {
      const amt = sortedInc[right].amount;
      if (amt > maxSingleCredit) maxSingleCredit = amt;
      windowSum += amt;
      while (incTimes[right] - incTimes[incLeft] > 86_400_000) {
        windowSum -= sortedInc[incLeft].amount;
        incLeft++;
      }
      const winCount = right - incLeft + 1;
      if (
        windowSum > peak24hCreditVolume ||
        (windowSum === peak24hCreditVolume && winCount > peak24hCreditCount)
      ) {
        peak24hCreditVolume = windowSum;
        peak24hCreditCount = winCount;
      }
    }

    // Rule 3 metric: Max distinct downstream recipients funded within 30 minutes of an incoming credit
    let maxFanOut30m = 0;
    if (sortedInc.length > 0 && out.length > 0) {
      for (const inTx of sortedInc) {
        const inMs = new Date(inTx.timestamp).getTime();
        const distinctDownstream = new Set<string>();
        for (const outTx of out) {
          const outMs = new Date(outTx.timestamp).getTime();
          if (outMs >= inMs && outMs <= inMs + 30 * 60_000) {
            distinctDownstream.add(outTx.receiver_upi);
          }
        }
        if (distinctDownstream.size > maxFanOut30m) {
          maxFanOut30m = distinctDownstream.size;
        }
      }
    }

    return {
      totalInc,
      totalOut,
      incomingCount: inc.length,
      outgoingCount: out.length,
      uniqueSenders,
      uniqueRecipients,
      rapidPassThroughPct,
      max1h,
      max24h,
      maxSingleCredit,
      peak24hCreditVolume,
      peak24hCreditCount,
      maxFanOut30m,
      firstTransactionAt,
      lastTransactionAt,
    };
  };

  // Compute AccountProfile & explainable 0-100 risk score for every account
  const accountsMap = new Map<string, AccountProfile>();

  for (const acct of allAccounts) {
    const m = computeAccountBehavioralMetrics(acct);
    const linkedComplaints = [...(accountComplaints.get(acct) ?? [])].sort();
    const maxHop = accountMaxHop.get(acct) ?? 0;
    const hasCircular = accountCircular.has(acct);
    const clusterId = accountToCluster.get(acct) ?? null;

    // Determine functional role in the dataset
    let role: AccountRole = 'CONTROL';
    if (victimSet.has(acct)) {
      role = 'VICTIM';
    } else if (initialRecipientSet.has(acct)) {
      role = 'INITIAL_RECIPIENT';
    } else if (linkedComplaints.length > 0) {
      // Distinguish intermediary vs downstream (terminal)
      const hasComplaintOutgoing = [...edgeMetaMap.values()].some(
        (em) => em.tx.sender_upi === acct,
      );
      role = hasComplaintOutgoing ? 'INTERMEDIARY' : 'DOWNSTREAM';
    }

    // Victims are reporting parties, not scored as mule suspects
    const isVictim = role === 'VICTIM';

    // Six independent deterministic behavioral signal scores scaled to configurable weights
    // A. Rapid pass-through (default weight 25)
    const rapidRatio = isVictim ? 0 : Math.min(1, m.rapidPassThroughPct / 75);
    const rapidScore = Math.round(rapidRatio * riskConfig.rapidPassThrough);

    // B. Cross-complaint recurrence (default weight 25)
    const complaintRatio = isVictim
      ? 0
      : linkedComplaints.length === 0
      ? 0
      : linkedComplaints.length === 1
      ? 0.35
      : linkedComplaints.length === 2
      ? 0.65
      : Math.min(1, 0.7 + (linkedComplaints.length - 2) * 0.1);
    const recurrenceScore = Math.round(complaintRatio * riskConfig.crossComplaintRecurrence);

    // C. Fan-in (default weight 15) — scaled smoothly from 2 to 8+ unique senders
    const fanInRatio = isVictim
      ? 0
      : m.uniqueSenders <= 1
      ? 0
      : Math.min(1, (m.uniqueSenders - 1) / 6);
    const fanInScore = Math.round(fanInRatio * riskConfig.fanIn);

    // D. Fan-out (default weight 15) — scaled smoothly from 2 to 7+ unique recipients
    const fanOutRatio = isVictim
      ? 0
      : m.uniqueRecipients <= 1
      ? 0
      : Math.min(1, (m.uniqueRecipients - 1) / 5);
    const fanOutScore = Math.round(fanOutRatio * riskConfig.fanOut);

    // E. Transaction velocity (default weight 10)
    const velRatio = isVictim
      ? 0
      : Math.min(1, Math.max((m.max1h - 1) / 5, (m.max24h - 3) / 14, 0));
    const velocityScore = Math.round(velRatio * riskConfig.transactionVelocity);

    // F. Network & circular patterns (default weight 10)
    let netRatio = 0;
    if (!isVictim) {
      if (hasCircular) netRatio += 0.6;
      if (maxHop >= 2) netRatio += 0.25;
      if (clusterId) netRatio += 0.25;
      netRatio = Math.min(1, netRatio);
    }
    const networkScore = Math.round(netRatio * riskConfig.networkAndCircular);

    // Evaluate 4 advanced deterministic detection rules
    const kycProfile = accountKycProfiles?.[acct];
    const hasExplicitHistoricalBaseline = Boolean(
      kycProfile?.monthlyHistoricalTurnover && kycProfile.monthlyHistoricalTurnover.length > 0,
    );
    const monthlyHistoricalTurnover = hasExplicitHistoricalBaseline
      ? kycProfile!.monthlyHistoricalTurnover!
      : deriveDefaultSixMonthHistory(acct, m.totalInc, kycProfile?.occupation);
    const sixMonthAvgMonthlyVolume =
      monthlyHistoricalTurnover.length > 0
        ? Math.round(
            monthlyHistoricalTurnover.reduce((s, item) => s + item.volume, 0) /
              monthlyHistoricalTurnover.length,
          )
        : 0;

    const triggeredRules = evaluateDeterministicDetectionRules({
      upiId: acct,
      isVictim,
      kyc: kycProfile,
      maxSingleCredit: m.maxSingleCredit,
      peak24hCreditVolume: m.peak24hCreditVolume,
      peak24hCreditCount: m.peak24hCreditCount,
      sixMonthAvgMonthlyVolume,
      hasExplicitHistoricalBaseline,
      maxFanOut30m: m.maxFanOut30m,
      rapidNcrpMultiHop: accountRapidNcrpMultiHop.get(acct) ?? null,
      uniqueSenders: m.uniqueSenders,
    });

    const deterministicRulePoints = triggeredRules.reduce((s, r) => s + r.points, 0);

    const totalScore = Math.min(
      100,
      rapidScore +
        recurrenceScore +
        fanInScore +
        fanOutScore +
        velocityScore +
        networkScore +
        deterministicRulePoints,
    );

    const risk_category: RiskCategory =
      totalScore >= riskConfig.highThreshold
        ? 'HIGH'
        : totalScore >= riskConfig.mediumThreshold
        ? 'MEDIUM'
        : 'LOW';

    const signals: RiskSignalBreakdown[] = [
      {
        key: 'rapidPassThrough',
        label: 'Rapid Pass-Through',
        score: rapidScore,
        maxScore: riskConfig.rapidPassThrough,
        metricValue: `${m.rapidPassThroughPct}% within 60m`,
        description: 'Share of settled incoming value followed by onward transfers within 60 minutes.',
      },
      {
        key: 'crossComplaintRecurrence',
        label: 'Cross-Complaint Recurrence',
        score: recurrenceScore,
        maxScore: riskConfig.crossComplaintRecurrence,
        metricValue: `${linkedComplaints.length} complaint(s)`,
        description: 'Distinct reported fraud complaints linked directly or via multi-hop trails.',
      },
      {
        key: 'fanIn',
        label: 'Fan-In Concentration',
        score: fanInScore,
        maxScore: riskConfig.fanIn,
        metricValue: `${m.uniqueSenders} unique sender(s)`,
        description: 'Distinct sending accounts transferring funds into this identifier.',
      },
      {
        key: 'fanOut',
        label: 'Fan-Out Dispersion',
        score: fanOutScore,
        maxScore: riskConfig.fanOut,
        metricValue: `${m.uniqueRecipients} unique recipient(s)`,
        description: 'Distinct receiving accounts funded from this identifier.',
      },
      {
        key: 'transactionVelocity',
        label: 'Transaction Velocity',
        score: velocityScore,
        maxScore: riskConfig.transactionVelocity,
        metricValue: `${m.max1h}/hr · ${m.max24h}/24h peak`,
        description: 'Peak successful transfer throughput inside rolling 1-hour and 24-hour windows.',
      },
      {
        key: 'networkAndCircular',
        label: 'Multi-Hop & Circular Structure',
        score: networkScore,
        maxScore: riskConfig.networkAndCircular,
        metricValue: hasCircular
          ? `Circular loop · Hop ${maxHop}`
          : maxHop > 0
          ? `Hop depth ${maxHop}`
          : 'No multi-hop trail',
        description: 'Presence of circular return loops or multi-hop complaint cluster participation.',
      },
    ];

    // Supporting transaction references (prioritize complaint-linked txs, fallback to recent ledger txs)
    const linkedTxIds = [...(accountSupportingTxs.get(acct) ?? [])];
    if (linkedTxIds.length === 0) {
      const sample = [
        ...(incomingTxsByAcct.get(acct) ?? []).slice(0, 5),
        ...(outgoingTxsByAcct.get(acct) ?? []).slice(0, 5),
      ];
      for (const s of sample) linkedTxIds.push(s.transaction_id);
    }

    // Build neutral, evidence-based investigative explanation
    const reasons: string[] = [];
    for (const rule of triggeredRules) {
      reasons.push(`[${rule.code}] ${rule.reason}`);
    }
    if (linkedComplaints.length >= 2) {
      reasons.push(`appears across ${linkedComplaints.length} distinct fraud complaints`);
    } else if (linkedComplaints.length === 1) {
      reasons.push(`linked to 1 reported complaint (${linkedComplaints[0]})`);
    }
    if (m.rapidPassThroughPct >= 50) {
      reasons.push(`exhibits ${m.rapidPassThroughPct}% rapid pass-through within 60 minutes`);
    }
    if (m.uniqueSenders >= 4) {
      reasons.push(`high fan-in from ${m.uniqueSenders} unique senders`);
    }
    if (m.uniqueRecipients >= 3) {
      reasons.push(`fan-out to ${m.uniqueRecipients} unique recipients`);
    }
    if (hasCircular) {
      reasons.push('participates in a circular transfer cycle');
    }

    let explanation = '';
    if (isVictim) {
      explanation = `Reporting victim account associated with ${linkedComplaints.length} complaint(s). Excluded from suspect risk scoring.`;
    } else if (reasons.length === 0) {
      explanation = 'Observed transaction behavior falls within low-priority baseline thresholds with no complaint correlation.';
    } else {
      const prefix =
        linkedComplaints.length === 0 && triggeredRules.length === 0
          ? 'Unlinked high-activity account (0 fraud complaints; verify for legitimate commercial or payroll activity): '
          : 'Requires investigative review because account ';
      explanation = `${prefix}${reasons.join('; ')}.`;
    }

    const investigative_advisory =
      risk_category === 'HIGH'
        ? 'High-priority investigative lead requiring manual analyst verification, KYC corroboration, and RBI Money Mule SOP (Annex III) temporary debit hold review. Indicator score does not establish fraud or criminal liability.'
        : risk_category === 'MEDIUM'
        ? 'Medium-priority review candidate. Verify business context and check whether inflows reflect legitimate commerce or shared complaint trails.'
        : 'Low-priority baseline indicator. No elevated mule-like pattern detected under current prototype thresholds.';

    const savedState = accountStates?.[acct];
    const totalBalance =
      savedState?.totalBalance ??
      computeDeterministicAccountBalance(acct, m.totalInc, m.totalOut);
    const precisionLienHold = savedState?.precisionLienHold ?? 0;
    const usableCleanBalance = Math.max(0, totalBalance - precisionLienHold);
    const defaultStatus: AccountStatus =
      risk_category === 'HIGH' && (linkedComplaints.length > 0 || triggeredRules.length > 0)
        ? 'Under Investigation'
        : 'Active';
    const accountStatus: AccountStatus = savedState?.accountStatus ?? defaultStatus;

    // Derive Official 6-Step RBI Money Mule SOP statutory state whenever a hold/clock exists
    let rbiSopStep = savedState?.rbiSopStep;
    let temporaryDebitHold = savedState?.temporaryDebitHold;
    let statutoryDeadlines = savedState?.statutoryDeadlines;

    if (
      (!rbiSopStep || !temporaryDebitHold || !statutoryDeadlines) &&
      savedState?.lienDetails &&
      savedState?.rbiSopClock
    ) {
      const computed = computeRbiSopStatutorySchedule(
        savedState.lienDetails.appliedAt || savedState.rbiSopClock.noticeSentAt,
        savedState.lienDetails.heldAmount,
        savedState.lienDetails.cbsReferenceId,
        accountStatus === 'Full Freeze',
        savedState.rbiSopClock.dayCount,
        savedState.rbiSopStep ??
          (savedState.rbiSopClock.stage === 'Resolved / Released'
            ? 6
            : savedState.rbiSopClock.stage === 'Days 31-60: LEA Escalation'
            ? 5
            : savedState.rbiSopClock.stage === 'Days 21-30: Nodal Review'
            ? 4
            : savedState.rbiSopClock.stage === 'Days 1-20: Customer Dispute Window'
            ? 3
            : 2),
      );
      rbiSopStep = rbiSopStep ?? computed.rbiSopStep;
      temporaryDebitHold = temporaryDebitHold ?? computed.temporaryDebitHold;
      statutoryDeadlines = statutoryDeadlines ?? computed.statutoryDeadlines;
    }

    accountsMap.set(acct, {
      upi_id: acct,
      upi_syntax_valid: validateUpiSyntax(acct),
      role,
      risk_score: totalScore,
      risk_category,
      connected_complaints: linkedComplaints,
      connected_accounts: [...(neighborsByAcct.get(acct) ?? [])].sort(),
      cluster_id: clusterId,
      incoming_count: m.incomingCount,
      outgoing_count: m.outgoingCount,
      total_incoming_amount: m.totalInc,
      total_outgoing_amount: m.totalOut,
      unique_senders: m.uniqueSenders,
      unique_recipients: m.uniqueRecipients,
      rapid_pass_through_pct: m.rapidPassThroughPct,
      velocity_1h_max: m.max1h,
      velocity_24h_max: m.max24h,
      max_hop_depth: maxHop,
      has_circular_pattern: hasCircular,
      signals,
      supporting_transaction_ids: linkedTxIds.slice(0, 40),
      explanation,
      investigative_advisory,
      totalBalance,
      precisionLienHold,
      usableCleanBalance,
      accountStatus,
      lienDetails: savedState?.lienDetails,
      rbiSopClock: savedState?.rbiSopClock,
      rbiSopStep,
      temporaryDebitHold,
      statutoryDeadlines,
      accountHolderName: kycProfile?.accountHolderName,
      age: kycProfile?.age,
      occupation: kycProfile?.occupation,
      accountAgeMonths: kycProfile?.accountAgeMonths,
      monthlyHistoricalTurnover,
      sixMonthAvgMonthlyVolume,
      current24hCreditVolume: m.peak24hCreditVolume,
      current24hCreditCount: m.peak24hCreditCount,
      isNewlyRegisteredVpa: kycProfile?.isNewlyRegisteredVpa,
      triggeredRules,
      first_transaction_at: m.firstTransactionAt,
      last_transaction_at: m.lastTransactionAt,
    });
  }

  // Assemble rich NetworkCluster objects with graph nodes, directed edges, and common pathways
  const clusterNames = [
    'Multi-Hop Layering Network Alpha',
    'Circular Relay Syndicate Beta',
    'Funnel Aggregation Cluster Gamma',
    'Interconnected Transfer Ring Delta',
    'Cross-Complaint Cluster Epsilon',
  ];

  const clusters: NetworkCluster[] = clusterComponents.map((cc, idx) => {
    const cid = clusterIdsByIndex[idx];
    const compAccountSet = new Set(cc.accounts);
    const compComplaintSet = new Set(cc.complaintIds);

    const uniqueVictims = new Set<string>();
    for (const cmpId of cc.complaintIds) {
      const cmp = matchedComplaints.find((c) => c.complaint_id === cmpId);
      if (cmp) uniqueVictims.add(cmp.victim_reference);
    }

    const sharedRecipientAccounts: string[] = [];
    const intermediaryAccounts: string[] = [];
    const downstreamAccounts: string[] = [];
    const inferredLinkAccounts: string[] = [];

    for (const acct of cc.accounts) {
      const prof = accountsMap.get(acct);
      if (!prof) continue;
      if (prof.connected_complaints.length >= 2) {
        sharedRecipientAccounts.push(acct);
      } else {
        inferredLinkAccounts.push(acct);
      }
      if (prof.role === 'INTERMEDIARY') intermediaryAccounts.push(acct);
      if (prof.role === 'DOWNSTREAM') downstreamAccounts.push(acct);
    }

    // Collect relevant edges & victim nodes connected to this cluster
    const clusterEdges: NetworkEdge[] = [];
    const clusterNodeIds = new Set<string>(cc.accounts);
    let earliestMs = Number.POSITIVE_INFINITY;
    let latestMs = 0;
    let hasCircular = false;

    for (const [, em] of edgeMetaMap.entries()) {
      const touchesCluster =
        compAccountSet.has(em.tx.receiver_upi) || compAccountSet.has(em.tx.sender_upi);
      const hasClusterComplaint = [...em.complaints].some((c) => compComplaintSet.has(c));
      if (!touchesCluster || !hasClusterComplaint) continue;

      clusterNodeIds.add(em.tx.sender_upi);
      clusterNodeIds.add(em.tx.receiver_upi);

      const tMs = new Date(em.tx.timestamp).getTime();
      earliestMs = Math.min(earliestMs, tMs);
      latestMs = Math.max(latestMs, tMs);
      if (em.isCircular) hasCircular = true;

      const relationship_type: NetworkEdge['relationship_type'] =
        em.hop === 1
          ? 'DIRECT_COMPLAINT'
          : (accountsMap.get(em.tx.receiver_upi)?.connected_complaints.length ?? 0) >= 2
          ? 'SHARED_ACCOUNT_FLOW'
          : 'INFERRED_MULTI_HOP';

      clusterEdges.push({
        id: em.tx.transaction_id,
        source: em.tx.sender_upi,
        target: em.tx.receiver_upi,
        amount: em.tx.amount,
        timestamp: em.tx.timestamp,
        utr: em.tx.utr,
        status: em.tx.status,
        hop: em.hop,
        complaint_ids: [...em.complaints].sort(),
        is_circular: em.isCircular,
        relationship_type,
      });
    }

    clusterEdges.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const nodes: NetworkNode[] = [...clusterNodeIds].map((id) => {
      const prof = accountsMap.get(id)!;
      return {
        id,
        label: id,
        role: prof.role,
        risk_score: prof.risk_score,
        risk_category: prof.risk_category,
        connected_complaints: prof.connected_complaints,
        total_incoming: prof.total_incoming_amount,
        total_outgoing: prof.total_outgoing_amount,
        is_shared_account: prof.connected_complaints.length >= 2 && prof.role !== 'VICTIM',
      };
    });

    // Derive top common pathways (L1 -> L2 -> L3)
    const pathwayMap = new Map<string, { path: string[]; complaints: Set<string>; totalAmount: number }>();
    for (const cmpId of cc.complaintIds) {
      const trace = complaintTraces.get(cmpId);
      if (!trace) continue;
      const hop1 = trace.edges.find((e) => e.hop === 1);
      if (!hop1) continue;
      const hop2s = trace.edges.filter((e) => e.hop === 2 && e.status === 'SUCCESS');
      for (const h2 of hop2s) {
        const hop3s = trace.edges.filter(
          (e) => e.hop === 3 && e.sender_upi === h2.receiver_upi && e.status === 'SUCCESS',
        );
        if (hop3s.length > 0) {
          for (const h3 of hop3s) {
            const path = [hop1.receiver_upi, h2.receiver_upi, h3.receiver_upi];
            const key = path.join('->');
            const curr = pathwayMap.get(key) ?? { path, complaints: new Set(), totalAmount: 0 };
            curr.complaints.add(cmpId);
            curr.totalAmount += h3.amount;
            pathwayMap.set(key, curr);
          }
        } else {
          const path = [hop1.receiver_upi, h2.receiver_upi];
          const key = path.join('->');
          const curr = pathwayMap.get(key) ?? { path, complaints: new Set(), totalAmount: 0 };
          curr.complaints.add(cmpId);
          curr.totalAmount += h2.amount;
          pathwayMap.set(key, curr);
        }
      }
    }

    const common_pathways: NetworkPathway[] = [...pathwayMap.values()]
      .sort((a, b) => b.complaints.size - a.complaints.size || b.totalAmount - a.totalAmount)
      .slice(0, 8)
      .map((p) => ({
        path: p.path,
        complaint_ids: [...p.complaints].sort(),
        total_amount: p.totalAmount,
        hop_count: p.path.length,
      }));

    const nonVictimProfiles = cc.accounts
      .map((a) => accountsMap.get(a))
      .filter((p): p is AccountProfile => Boolean(p));
    const maxRisk = nonVictimProfiles.reduce((m, p) => Math.max(m, p.risk_score), 0);
    const avgRisk =
      nonVictimProfiles.length > 0
        ? Math.round(
            nonVictimProfiles.reduce((s, p) => s + p.risk_score, 0) / nonVictimProfiles.length,
          )
        : 0;

    return {
      cluster_id: cid,
      name: clusterNames[idx] ?? `Connected Network Cluster ${idx + 1}`,
      complaint_ids: cc.complaintIds,
      unique_victims: [...uniqueVictims].sort(),
      total_reported_amount: cc.totalAmount,
      account_ids: cc.accounts.sort(),
      shared_recipient_accounts: sharedRecipientAccounts.sort(),
      intermediary_accounts: intermediaryAccounts.sort(),
      downstream_accounts: downstreamAccounts.sort(),
      inferred_link_accounts: inferredLinkAccounts.sort(),
      common_pathways,
      earliest_timestamp: Number.isFinite(earliestMs) ? new Date(earliestMs).toISOString() : '',
      latest_timestamp: latestMs > 0 ? new Date(latestMs).toISOString() : '',
      has_circular_pattern: hasCircular,
      max_risk_score: maxRisk,
      avg_risk_score: avgRisk,
      nodes,
      edges: clusterEdges,
    };
  });

  const accountsList = [...accountsMap.values()].sort(
    (a, b) =>
      b.risk_score - a.risk_score ||
      b.connected_complaints.length - a.connected_complaints.length ||
      b.total_incoming_amount - a.total_incoming_amount,
  );

  // Build actionable investigative alerts from deterministic findings
  const alerts: AlertItem[] = [];
  for (const cluster of clusters) {
    alerts.push({
      id: `ALT-${cluster.cluster_id}`,
      severity: cluster.has_circular_pattern || cluster.complaint_ids.length >= 10 ? 'HIGH' : 'MEDIUM',
      title: `${cluster.name} links ${cluster.complaint_ids.length} complaints`,
      description: `${cluster.shared_recipient_accounts.length} shared accounts connected across ₹${cluster.total_reported_amount.toLocaleString('en-IN')} in reported exposure.${cluster.has_circular_pattern ? ' Circular transaction cycle detected.' : ''}`,
      cluster_id: cluster.cluster_id,
      timestamp: cluster.latest_timestamp || new Date().toISOString(),
      metric: `${cluster.complaint_ids.length} complaints`,
    });
  }

  for (const acct of accountsList.filter((a) => a.risk_category === 'HIGH').slice(0, 6)) {
    alerts.push({
      id: `ALT-ACCT-${acct.upi_id}`,
      severity: 'HIGH',
      title: `High-priority account review: ${acct.upi_id}`,
      description: `Risk score ${acct.risk_score}/100 · ${acct.connected_complaints.length} linked complaints · ${acct.rapid_pass_through_pct}% rapid pass-through.`,
      account_id: acct.upi_id,
      cluster_id: acct.cluster_id ?? undefined,
      timestamp: new Date().toISOString(),
      metric: `Score ${acct.risk_score}`,
    });
  }

  return {
    complaints: matchedComplaints,
    accounts: accountsMap,
    accountsList,
    clusters,
    alerts,
  };
}

export function buildDashboardSummary(
  dataset: DatasetMetadata,
  analysis: FullDatasetAnalysis,
  investigations: InvestigationCase[],
): DashboardSummary {
  const matched = analysis.complaints.filter((c) => c.match_status === 'MATCHED_SUCCESS').length;
  const totalAmount = analysis.complaints.reduce((sum, c) => sum + c.amount, 0);
  const uniqueRecipients = new Set(analysis.complaints.map((c) => c.receiver_upi)).size;

  const nonVictimAccounts = analysis.accountsList.filter((a) => a.role !== 'VICTIM');
  const multiComplaintAccounts = nonVictimAccounts.filter(
    (a) => a.connected_complaints.length >= 2,
  ).length;
  const highPriorityAccounts = nonVictimAccounts.filter((a) => a.risk_category === 'HIGH').length;

  // Daily complaint trend sorted chronologically
  const trendMap = new Map<string, { complaints: number; amount: number }>();
  for (const cmp of analysis.complaints) {
    const day = cmp.complaint_date || cmp.transaction_timestamp.slice(0, 10);
    const curr = trendMap.get(day) ?? { complaints: 0, amount: 0 };
    curr.complaints += 1;
    curr.amount += cmp.amount;
    trendMap.set(day, curr);
  }
  const complaint_trends = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({ date, complaints: val.complaints, amount: val.amount }));

  // Risk distribution across all non-victim accounts
  const riskCounts: Record<RiskCategory, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const a of nonVictimAccounts) {
    riskCounts[a.risk_category]++;
  }

  // Most frequently reported initial recipient UPI IDs
  const recipientStats = new Map<string, { count: number; amount: number }>();
  for (const cmp of analysis.complaints) {
    const curr = recipientStats.get(cmp.receiver_upi) ?? { count: 0, amount: 0 };
    curr.count += 1;
    curr.amount += cmp.amount;
    recipientStats.set(cmp.receiver_upi, curr);
  }

  const top_recipients = [...recipientStats.entries()]
    .map(([upi_id, stats]) => {
      const profile = analysis.accounts.get(upi_id);
      return {
        upi_id,
        complaint_count: stats.count,
        total_reported_amount: stats.amount,
        risk_score: profile?.risk_score ?? 0,
        risk_category: profile?.risk_category ?? ('LOW' as RiskCategory),
        cluster_id: profile?.cluster_id ?? null,
      };
    })
    .sort((a, b) => b.complaint_count - a.complaint_count || b.total_reported_amount - a.total_reported_amount)
    .slice(0, 10);

  const recent_networks = analysis.clusters.map((c) => ({
    cluster_id: c.cluster_id,
    name: c.name,
    account_count: c.account_ids.length,
    complaint_count: c.complaint_ids.length,
    total_reported_amount: c.total_reported_amount,
    max_risk_score: c.max_risk_score,
    has_circular_pattern: c.has_circular_pattern,
  }));

  return {
    dataset,
    kpis: {
      total_complaints: analysis.complaints.length,
      matched_complaints: matched,
      total_reported_amount: totalAmount,
      unique_recipient_upis: uniqueRecipients,
      accounts_linked_multi_complaint: multiComplaintAccounts,
      suspicious_network_clusters: analysis.clusters.length,
      high_priority_accounts: highPriorityAccounts,
    },
    complaint_trends,
    risk_distribution: [
      { category: 'LOW', count: riskCounts.LOW },
      { category: 'MEDIUM', count: riskCounts.MEDIUM },
      { category: 'HIGH', count: riskCounts.HIGH },
    ],
    top_recipients,
    recent_networks,
    recent_investigations: investigations
      .filter((inv) => inv.dataset_id === dataset.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8),
  };
}
