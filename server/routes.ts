import express from 'express';
import Papa from 'papaparse';
import { z } from 'zod';
import type {
  GlobalSearchResult,
  InvestigationReportData,
  TransactionStatus,
} from '../src/shared/types.ts';
import {
  ANALYSIS_VERSION,
  buildDashboardSummary,
  calculatePrecisionLien,
  traceComplaintFunds,
  validateAndNormalizeImport,
} from './analyticsEngine.ts';
import {
  generateGroundedExplanation,
  verifyDisputeProofWithGemini,
} from './geminiService.ts';
import { store } from './store.ts';

export const apiRouter = express.Router();

function resolveDatasetId(req: express.Request): string | undefined {
  const q = req.query.datasetId;
  return typeof q === 'string' && q.trim() ? q.trim() : undefined;
}

// ---------------------------------------------------------------------------
// 1. DATASETS & CSV UPLOAD
// ---------------------------------------------------------------------------
apiRouter.get('/datasets', (_req, res) => {
  res.json({
    activeDatasetId: store.getActiveDatasetId(),
    datasets: store.listDatasets(),
  });
});

apiRouter.post('/datasets/select', (req, res) => {
  const schema = z.object({ datasetId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid datasetId', details: parsed.error.flatten() });
    return;
  }
  const meta = store.setActiveDataset(parsed.data.datasetId);
  if (!meta) {
    res.status(404).json({ error: `Dataset ${parsed.data.datasetId} not found.` });
    return;
  }
  res.json({ activeDatasetId: meta.id, dataset: meta });
});

apiRouter.post('/datasets/demo/reset', (_req, res) => {
  const meta = store.resetDemoWorkspace();
  res.json({
    message: 'Synthetic 50-complaint demonstration workspace loaded.',
    activeDatasetId: meta.id,
    dataset: meta,
  });
});

const uploadSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  complaintsCsv: z.string().optional(),
  transactionsCsv: z.string().optional(),
  complaintsRows: z.array(z.record(z.string(), z.unknown())).optional(),
  transactionsRows: z.array(z.record(z.string(), z.unknown())).optional(),
  complaintMapping: z.record(z.string(), z.string()).optional(),
  transactionMapping: z.record(z.string(), z.string()).optional(),
});

function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping?: Record<string, string>,
): Record<string, unknown>[] {
  if (!mapping || Object.keys(mapping).length === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [targetField, sourceHeader] of Object.entries(mapping)) {
      if (sourceHeader && sourceHeader in row) {
        out[targetField] = row[sourceHeader];
      }
    }
    return out;
  });
}

apiRouter.post('/datasets/upload', (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid dataset upload payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const data = parsed.data;
  let rawComplaints: Record<string, unknown>[] = data.complaintsRows ?? [];
  let rawTransactions: Record<string, unknown>[] = data.transactionsRows ?? [];

  if (data.complaintsCsv) {
    const p = Papa.parse<Record<string, unknown>>(data.complaintsCsv, {
      header: true,
      skipEmptyLines: true,
    });
    rawComplaints = p.data;
  }

  if (data.transactionsCsv) {
    const p = Papa.parse<Record<string, unknown>>(data.transactionsCsv, {
      header: true,
      skipEmptyLines: true,
    });
    rawTransactions = p.data;
  }

  if (rawComplaints.length === 0 || rawTransactions.length === 0) {
    res.status(400).json({
      error:
        'Both Fraud Complaints CSV and Complete Transaction Ledger CSV must contain at least one valid row.',
    });
    return;
  }

  const mappedComplaints = applyColumnMapping(rawComplaints, data.complaintMapping);
  const mappedTransactions = applyColumnMapping(rawTransactions, data.transactionMapping);

  const normalized = validateAndNormalizeImport(mappedComplaints, mappedTransactions);

  if (normalized.complaints.length === 0) {
    res.status(422).json({
      error: 'No valid fraud complaint rows remained after validation.',
      validation_summary: normalized.summary,
    });
    return;
  }
  if (normalized.transactions.length === 0) {
    res.status(422).json({
      error: 'No valid transaction ledger rows remained after validation.',
      validation_summary: normalized.summary,
    });
    return;
  }

  const uniqueAccts = new Set<string>();
  for (const c of normalized.complaints) {
    uniqueAccts.add(c.sender_upi);
    uniqueAccts.add(c.receiver_upi);
  }
  for (const t of normalized.transactions) {
    uniqueAccts.add(t.sender_upi);
    uniqueAccts.add(t.receiver_upi);
  }

  const id = `ds-${Date.now().toString(36)}`;
  const meta = store.addUploadedDataset({
    metadata: {
      id,
      name: data.name.trim(),
      description:
        data.description?.trim() ||
        'Analyst-uploaded complaints and transaction ledger workspace.',
      source_type: 'UPLOADED_CSV',
      created_at: new Date().toISOString(),
      analysis_version: ANALYSIS_VERSION,
      complaint_count: normalized.complaints.length,
      transaction_count: normalized.transactions.length,
      account_count: uniqueAccts.size,
      validation_summary: normalized.summary,
    },
    complaints: normalized.complaints,
    transactions: normalized.transactions,
  });

  res.status(201).json({
    activeDatasetId: meta.id,
    dataset: meta,
    validation_summary: normalized.summary,
  });
});

// Downloadable CSV templates
apiRouter.get('/templates/:type', (req, res) => {
  const type = req.params.type;
  if (type === 'complaints') {
    const csv = [
      'complaint_id,victim_reference,reported_transaction_id,utr,transaction_timestamp,amount,sender_upi,receiver_upi,complaint_date',
      'CMP-SAMPLE-001,VIC-9001,TXN-S0001,UTR8800001001,2026-11-10T10:15:00.000Z,45000,victim.alpha@demo,mule.recv01@demo,2026-11-11',
      'CMP-SAMPLE-002,VIC-9002,TXN-S0002,UTR8800001002,2026-11-10T11:20:00.000Z,62000,victim.beta@demo,mule.recv01@demo,2026-11-11',
      'CMP-SAMPLE-003,VIC-9003,TXN-S0003,UTR8800001003,2026-11-10T12:05:00.000Z,38000,victim.gamma@demo,mule.recv02@demo,2026-11-12',
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="muleshield_complaints_template.csv"');
    res.send(csv);
    return;
  }
  if (type === 'transactions') {
    const csv = [
      'transaction_id,timestamp,sender_upi,receiver_upi,amount,status,utr,channel',
      'TXN-S0001,2026-11-10T10:15:00.000Z,victim.alpha@demo,mule.recv01@demo,45000,SUCCESS,UTR8800001001,UPI_INTENT',
      'TXN-S0004,2026-11-10T10:26:00.000Z,mule.recv01@demo,intermediary.hub@demo,42000,SUCCESS,UTR8800001004,UPI_P2P',
      'TXN-S0002,2026-11-10T11:20:00.000Z,victim.beta@demo,mule.recv01@demo,62000,SUCCESS,UTR8800001002,UPI_COLLECT',
      'TXN-S0005,2026-11-10T11:32:00.000Z,mule.recv01@demo,intermediary.hub@demo,59000,SUCCESS,UTR8800001005,UPI_P2P',
      'TXN-S0003,2026-11-10T12:05:00.000Z,victim.gamma@demo,mule.recv02@demo,38000,SUCCESS,UTR8800001003,UPI_QR',
      'TXN-S0006,2026-11-10T12:18:00.000Z,mule.recv02@demo,intermediary.hub@demo,36000,SUCCESS,UTR8800001006,UPI_P2P',
      'TXN-S0007,2026-11-10T12:40:00.000Z,intermediary.hub@demo,exit.downstream@demo,125000,SUCCESS,UTR8800001007,UPI_P2P',
      'TXN-S0008,2026-11-10T12:45:00.000Z,intermediary.hub@demo,exit.downstream@demo,15000,FAILED,UTR8800001008,UPI_P2P',
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="muleshield_transactions_template.csv"');
    res.send(csv);
    return;
  }
  res.status(404).json({ error: 'Unknown template type. Use "complaints" or "transactions".' });
});

// ---------------------------------------------------------------------------
// 2. EXECUTIVE DASHBOARD SUMMARY
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard/summary', (req, res) => {
  try {
    const { dataset, analysis } = store.getAnalysis(resolveDatasetId(req));
    const investigations = store.listInvestigations(dataset.metadata.id);
    const summary = buildDashboardSummary(dataset.metadata, analysis, investigations);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Dashboard calculation failed.' });
  }
});

// ---------------------------------------------------------------------------
// 3. COMPLAINTS
// ---------------------------------------------------------------------------
apiRouter.get('/complaints', (req, res) => {
  const { analysis } = store.getAnalysis(resolveDatasetId(req));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const matchFilter = typeof req.query.matchStatus === 'string' ? req.query.matchStatus : '';
  const clusterFilter = typeof req.query.clusterId === 'string' ? req.query.clusterId : '';

  let items = analysis.complaints;
  if (search) {
    items = items.filter(
      (c) =>
        c.complaint_id.toLowerCase().includes(search) ||
        c.victim_reference.toLowerCase().includes(search) ||
        c.sender_upi.toLowerCase().includes(search) ||
        c.receiver_upi.toLowerCase().includes(search) ||
        c.reported_transaction_id.toLowerCase().includes(search) ||
        c.utr.toLowerCase().includes(search),
    );
  }
  if (matchFilter && matchFilter !== 'ALL') {
    items = items.filter((c) => c.match_status === matchFilter);
  }
  if (clusterFilter && clusterFilter !== 'ALL') {
    items = items.filter((c) => c.cluster_id === clusterFilter);
  }

  res.json({ total: items.length, complaints: items });
});

apiRouter.get('/complaints/:id', (req, res) => {
  const { dataset, analysis } = store.getAnalysis(resolveDatasetId(req));
  const complaint = analysis.complaints.find((c) => c.complaint_id === req.params.id);
  if (!complaint) {
    res.status(404).json({ error: `Complaint ${req.params.id} not found.` });
    return;
  }

  const defaultTrace = traceComplaintFunds(dataset.metadata.id, complaint, dataset.transactions, {
    complaintId: complaint.complaint_id,
    maxHops: 4,
    windowHours: 72,
    minAmount: 0,
    statuses: ['SUCCESS'],
  });
  const receiverProfile = analysis.accounts.get(complaint.receiver_upi) ?? null;

  res.json({
    complaint,
    receiver_profile: receiverProfile,
    default_trace: defaultTrace,
  });
});

// ---------------------------------------------------------------------------
// 4. TRANSACTION TRACING ENGINE
// ---------------------------------------------------------------------------
const traceRequestSchema = z.object({
  datasetId: z.string().optional(),
  complaintId: z.string().min(1),
  maxHops: z.number().int().min(1).max(5).default(3),
  windowHours: z.number().min(1).max(168).default(24),
  minAmount: z.number().min(0).default(0),
  statuses: z
    .array(z.enum(['SUCCESS', 'FAILED', 'REVERSED', 'PENDING']))
    .min(1)
    .default(['SUCCESS']),
});

apiRouter.post('/traces', (req, res) => {
  const parsed = traceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tracing parameters.', details: parsed.error.flatten() });
    return;
  }

  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const complaint = analysis.complaints.find((c) => c.complaint_id === parsed.data.complaintId);
  if (!complaint) {
    res.status(404).json({ error: `Complaint ${parsed.data.complaintId} not found in active dataset.` });
    return;
  }

  const trace = traceComplaintFunds(dataset.metadata.id, complaint, dataset.transactions, {
    complaintId: parsed.data.complaintId,
    maxHops: parsed.data.maxHops,
    windowHours: parsed.data.windowHours,
    minAmount: parsed.data.minAmount,
    statuses: parsed.data.statuses as TransactionStatus[],
  });

  // Enrich trace nodes with deterministic risk scores from full dataset analysis
  trace.nodes = trace.nodes.map((node) => {
    const profile = analysis.accounts.get(node.id);
    if (!profile) return node;
    return {
      ...node,
      risk_score: profile.risk_score,
      risk_category: profile.risk_category,
      connected_complaints: profile.connected_complaints,
      is_shared_account: profile.connected_complaints.length >= 2 && profile.role !== 'VICTIM',
    };
  });

  // Compute deterministic Precision Lien allocations for every non-victim recipient in the traced DAG
  trace.account_lien_allocations = trace.nodes
    .filter((n) => n.role !== 'VICTIM')
    .map((n) => {
      const profile = analysis.accounts.get(n.id);
      const balance = profile?.totalBalance ?? 150000;
      return calculatePrecisionLien(
        n.id,
        complaint.complaint_id,
        dataset.complaints,
        dataset.transactions,
        balance,
      );
    })
    .filter((alloc) => alloc.taintedReceived > 0);

  store.saveTrace(trace);
  res.json(trace);
});

apiRouter.get('/traces/:id', (req, res) => {
  const trace = store.getTrace(req.params.id);
  if (!trace) {
    res.status(404).json({ error: `Trace ${req.params.id} not found.` });
    return;
  }
  res.json(trace);
});

// ---------------------------------------------------------------------------
// 5. NETWORK INTELLIGENCE & CLUSTERS
// ---------------------------------------------------------------------------
apiRouter.get('/networks', (req, res) => {
  const { analysis } = store.getAnalysis(resolveDatasetId(req));
  res.json({
    total: analysis.clusters.length,
    clusters: analysis.clusters,
  });
});

apiRouter.get('/networks/:id', (req, res) => {
  const { analysis } = store.getAnalysis(resolveDatasetId(req));
  const cluster = analysis.clusters.find((c) => c.cluster_id === req.params.id);
  if (!cluster) {
    res.status(404).json({ error: `Network cluster ${req.params.id} not found.` });
    return;
  }
  const linkedComplaints = analysis.complaints.filter((c) =>
    cluster.complaint_ids.includes(c.complaint_id),
  );
  const memberAccounts = cluster.account_ids
    .map((id) => analysis.accounts.get(id))
    .filter(Boolean);

  res.json({
    cluster,
    linked_complaints: linkedComplaints,
    member_accounts: memberAccounts,
  });
});

const networkPathSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  datasetId: z.string().optional(),
});

apiRouter.post('/networks/:id/path', (req, res) => {
  const parsed = networkPathSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid path query payload.' });
    return;
  }
  const { analysis } = store.getAnalysis(parsed.data.datasetId);
  const cluster = analysis.clusters.find((c) => c.cluster_id === req.params.id);
  if (!cluster) {
    res.status(404).json({ error: `Network cluster ${req.params.id} not found.` });
    return;
  }

  const source = parsed.data.source.trim().toLowerCase();
  const target = parsed.data.target.trim().toLowerCase();

  if (source === target) {
    res.json({
      found: true,
      source,
      target,
      path_nodes: [source],
      path_edge_ids: [],
      total_path_amount: 0,
      hop_count: 0,
      message: `Source and target refer to the same account (${source}).`,
    });
    return;
  }

  // Directed BFS over cluster edges (preferring settled edges)
  const adj = new Map<string, typeof cluster.edges>();
  for (const edge of cluster.edges) {
    if (edge.status !== 'SUCCESS') continue;
    const list = adj.get(edge.source) ?? [];
    list.push(edge);
    adj.set(edge.source, list);
  }

  const queue: Array<{ node: string; nodes: string[]; edgeIds: string[]; totalAmount: number }> = [
    { node: source, nodes: [source], edgeIds: [], totalAmount: 0 },
  ];
  const visited = new Set<string>([source]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = adj.get(current.node) ?? [];
    for (const edge of outgoing) {
      if (visited.has(edge.target)) continue;
      const nextNodes = [...current.nodes, edge.target];
      const nextEdgeIds = [...current.edgeIds, edge.id];
      const nextAmount = current.totalAmount + edge.amount;
      if (edge.target === target) {
        res.json({
          found: true,
          source,
          target,
          path_nodes: nextNodes,
          path_edge_ids: nextEdgeIds,
          total_path_amount: nextAmount,
          hop_count: nextEdgeIds.length,
          message: `Found ${nextEdgeIds.length}-hop directed transfer path from ${source} to ${target}.`,
        });
        return;
      }
      visited.add(edge.target);
      queue.push({
        node: edge.target,
        nodes: nextNodes,
        edgeIds: nextEdgeIds,
        totalAmount: nextAmount,
      });
    }
  }

  res.json({
    found: false,
    source,
    target,
    path_nodes: [],
    path_edge_ids: [],
    total_path_amount: 0,
    hop_count: 0,
    message: `No directed settled transfer path found from ${source} to ${target} inside ${cluster.cluster_id}.`,
  });
});

// ---------------------------------------------------------------------------
// 5B. ANALYZED TRANSACTIONS LEDGER QUERY
// ---------------------------------------------------------------------------
apiRouter.get('/transactions', (req, res) => {
  const { dataset, analysis } = store.getAnalysis(resolveDatasetId(req));

  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
  const minAmount = req.query.minAmount ? Number(req.query.minAmount) : undefined;
  const maxAmount = req.query.maxAmount ? Number(req.query.maxAmount) : undefined;
  const sender = typeof req.query.sender === 'string' ? req.query.sender.trim().toLowerCase() : '';
  const receiver = typeof req.query.receiver === 'string' ? req.query.receiver.trim().toLowerCase() : '';
  const riskLevel = typeof req.query.riskLevel === 'string' ? req.query.riskLevel.toUpperCase() : 'ALL';
  const channel = typeof req.query.channel === 'string' ? req.query.channel.toUpperCase() : 'ALL';
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';
  const onlySuspicious = req.query.onlySuspicious === 'true';

  const complaintByTxId = new Map<string, string>();
  const complaintByUtr = new Map<string, string>();
  for (const c of analysis.complaints) {
    if (c.matched_transaction?.transaction_id) {
      complaintByTxId.set(c.matched_transaction.transaction_id, c.complaint_id);
    }
    if (c.utr) {
      complaintByUtr.set(c.utr.toLowerCase(), c.complaint_id);
    }
  }

  const toRiskTier = (score: number) =>
    score >= 85 ? 'CRITICAL' : score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

  const allEnriched = dataset.transactions.map((tx) => {
    const sProf = analysis.accounts.get(tx.sender_upi);
    const rProf = analysis.accounts.get(tx.receiver_upi);
    const sScore = sProf && sProf.role !== 'VICTIM' ? sProf.risk_score : 0;
    const rScore = rProf && rProf.role !== 'VICTIM' ? rProf.risk_score : 0;
    const risk_score = Math.max(sScore, rScore);
    const risk_tier = toRiskTier(risk_score);
    const linked_complaint_id =
      complaintByTxId.get(tx.transaction_id) ??
      complaintByUtr.get(tx.utr.toLowerCase()) ??
      rProf?.connected_complaints[0] ??
      sProf?.connected_complaints[0] ??
      null;
    const cluster_id = rProf?.cluster_id ?? sProf?.cluster_id ?? null;
    const is_suspicious = risk_score >= 40 || Boolean(cluster_id);
    const suspicious_reason =
      risk_score >= 70
        ? `High-risk counterparty (${rScore >= sScore ? tx.receiver_upi : tx.sender_upi})`
        : cluster_id
        ? `Linked to network cluster ${cluster_id}`
        : risk_score >= 40
        ? 'Elevated pass-through / fan-in velocity'
        : '';

    return {
      ...tx,
      risk_score,
      risk_tier,
      is_suspicious,
      suspicious_reason,
      linked_complaint_id,
      cluster_id,
    };
  });

  const uniqueAccounts = new Set<string>();
  let totalVolume = 0;
  let suspiciousCount = 0;
  for (const tx of allEnriched) {
    uniqueAccounts.add(tx.sender_upi);
    uniqueAccounts.add(tx.receiver_upi);
    if (tx.status === 'SUCCESS') totalVolume += tx.amount;
    if (tx.is_suspicious) suspiciousCount += 1;
  }

  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).getTime() : null;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : null;

  const filtered = allEnriched
    .filter((tx) => {
      if (onlySuspicious && !tx.is_suspicious) return false;
      if (riskLevel !== 'ALL' && tx.risk_tier !== riskLevel) return false;
      if (channel !== 'ALL' && tx.channel.toUpperCase() !== channel) return false;
      if (status !== 'ALL' && tx.status.toUpperCase() !== status) return false;
      if (sender && !tx.sender_upi.toLowerCase().includes(sender)) return false;
      if (receiver && !tx.receiver_upi.toLowerCase().includes(receiver)) return false;
      if (minAmount !== undefined && !Number.isNaN(minAmount) && tx.amount < minAmount) return false;
      if (maxAmount !== undefined && !Number.isNaN(maxAmount) && tx.amount > maxAmount) return false;
      const txMs = new Date(tx.timestamp).getTime();
      if (fromMs !== null && !Number.isNaN(fromMs) && txMs < fromMs) return false;
      if (toMs !== null && !Number.isNaN(toMs) && txMs > toMs) return false;
      if (search) {
        return (
          tx.transaction_id.toLowerCase().includes(search) ||
          tx.utr.toLowerCase().includes(search) ||
          tx.sender_upi.toLowerCase().includes(search) ||
          tx.receiver_upi.toLowerCase().includes(search) ||
          (tx.linked_complaint_id && tx.linked_complaint_id.toLowerCase().includes(search))
        );
      }
      return true;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({
    total: filtered.length,
    transactions: filtered,
    summary: {
      total_transactions: allEnriched.length,
      total_volume: totalVolume,
      unique_accounts: uniqueAccounts.size,
      suspicious_transactions: suspiciousCount,
      identified_chains: analysis.clusters.length,
    },
  });
});

// ---------------------------------------------------------------------------
// 6. ACCOUNTS & SUSPICIOUS ACCOUNT DETECTION
// ---------------------------------------------------------------------------
apiRouter.get('/accounts', (req, res) => {
  const { analysis } = store.getAnalysis(resolveDatasetId(req));
  const risk = typeof req.query.risk === 'string' ? req.query.risk.toUpperCase() : 'ALL';
  const role = typeof req.query.role === 'string' ? req.query.role.toUpperCase() : 'ALL';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const includeVictims = req.query.includeVictims === 'true';

  let accounts = includeVictims
    ? analysis.accountsList
    : analysis.accountsList.filter((a) => a.role !== 'VICTIM');

  if (risk !== 'ALL') {
    accounts = accounts.filter((a) => a.risk_category === risk);
  }
  if (role !== 'ALL') {
    accounts = accounts.filter((a) => a.role === role);
  }
  if (search) {
    accounts = accounts.filter((a) => a.upi_id.toLowerCase().includes(search));
  }

  res.json({ total: accounts.length, accounts });
});

apiRouter.get('/accounts/:id', (req, res) => {
  const accountId = decodeURIComponent(req.params.id).toLowerCase();
  const { dataset, analysis } = store.getAnalysis(resolveDatasetId(req));
  const profile = analysis.accounts.get(accountId);
  if (!profile) {
    res.status(404).json({ error: `Account ${accountId} not found in active dataset.` });
    return;
  }

  const transactions = dataset.transactions
    .filter((t) => t.sender_upi === accountId || t.receiver_upi === accountId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const linkedComplaints = analysis.complaints.filter((c) =>
    profile.connected_complaints.includes(c.complaint_id),
  );

  const neighborProfiles = profile.connected_accounts
    .map((id) => analysis.accounts.get(id))
    .filter(Boolean)
    .slice(0, 30);

  const cluster = profile.cluster_id
    ? analysis.clusters.find((c) => c.cluster_id === profile.cluster_id) ?? null
    : null;

  const primaryComplaintId =
    profile.lienDetails?.complaintId ?? profile.connected_complaints[0] ?? null;
  const precision_lien_preview = primaryComplaintId
    ? calculatePrecisionLien(
        accountId,
        primaryComplaintId,
        dataset.complaints,
        dataset.transactions,
        profile.totalBalance,
      )
    : null;

  res.json({
    account: profile,
    transactions,
    linked_complaints: linkedComplaints,
    neighbor_accounts: neighborProfiles,
    cluster,
    precision_lien_preview,
  });
});

// ---------------------------------------------------------------------------
// 6B. AUTOMATED PRECISION LIEN PROTOCOL & RBI 60-DAY MONEY MULE SOP ENDPOINTS
// ---------------------------------------------------------------------------
const calcLienSchema = z.object({
  complaintId: z.string().min(1),
  datasetId: z.string().optional(),
  victimDeficitOverride: z.number().min(0).optional(),
});

apiRouter.post('/accounts/:id/calculate-precision-lien', (req, res) => {
  const parsed = calcLienSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid precision lien calculation payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const accountId = decodeURIComponent(req.params.id).toLowerCase();
  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const profile = analysis.accounts.get(accountId);
  if (!profile) {
    res.status(404).json({ error: `Account ${accountId} not found in active dataset.` });
    return;
  }

  const calculation = calculatePrecisionLien(
    accountId,
    parsed.data.complaintId,
    dataset.complaints,
    dataset.transactions,
    profile.totalBalance,
    parsed.data.victimDeficitOverride,
  );

  res.json(calculation);
});

const applyLienSchema = z.object({
  complaintId: z.string().min(1),
  datasetId: z.string().optional(),
  mode: z.enum(['PRECISION_LIEN', 'FULL_FREEZE']).default('PRECISION_LIEN'),
  reason: z.string().max(500).optional(),
});

apiRouter.post('/accounts/:id/apply-precision-lien', (req, res) => {
  const parsed = applyLienSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid apply-precision-lien payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const accountId = decodeURIComponent(req.params.id).toLowerCase();
  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const profile = analysis.accounts.get(accountId);
  if (!profile) {
    res.status(404).json({ error: `Account ${accountId} not found in active dataset.` });
    return;
  }

  const calculation = calculatePrecisionLien(
    accountId,
    parsed.data.complaintId,
    dataset.complaints,
    dataset.transactions,
    profile.totalBalance,
  );

  if (parsed.data.mode === 'PRECISION_LIEN' && calculation.heldAmount <= 0) {
    res.status(422).json({
      error:
        'Cannot execute precision lien: deterministic FIFO trace found ₹0 settled tainted inflow or ₹0 available balance for this complaint.',
      calculation,
    });
    return;
  }

  const updatedState = store.applyPrecisionLien(
    dataset.metadata.id,
    accountId,
    calculation,
    parsed.data.mode,
    parsed.data.reason,
  );

  const refreshed = store.getAnalysis(dataset.metadata.id).analysis.accounts.get(accountId);
  res.json({
    account: refreshed,
    lienState: updatedState,
    calculation,
  });
});

const submitDisputeSchema = z.object({
  datasetId: z.string().optional(),
  invoiceNumber: z.string().min(2).max(80),
  gstin: z.string().min(5).max(30),
  counterpartyName: z.string().min(2).max(120),
  documentType: z.enum(['GST Tax Invoice', 'Delivery Challan', 'Commercial Contract']),
  claimedAmount: z.number().positive(),
  referencedUtr: z.string().min(3).max(80),
});

apiRouter.post('/accounts/:id/submit-dispute-proof', async (req, res) => {
  const parsed = submitDisputeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid customer dispute proof payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const accountId = decodeURIComponent(req.params.id).toLowerCase();
  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const profile = analysis.accounts.get(accountId);
  if (!profile) {
    res.status(404).json({ error: `Account ${accountId} not found.` });
    return;
  }
  if (!profile.lienDetails || profile.precisionLienHold <= 0) {
    res.status(422).json({
      error: 'No active precision lien exists on this account to dispute.',
    });
    return;
  }

  const calc = calculatePrecisionLien(
    accountId,
    profile.lienDetails.complaintId,
    dataset.complaints,
    dataset.transactions,
    profile.totalBalance,
  );

  const expectedUtrs = [
    ...new Set([
      ...calc.matchedUtrs,
      ...dataset.transactions
        .filter((t) => t.receiver_upi === accountId && t.status === 'SUCCESS')
        .map((t) => t.utr),
    ]),
  ];

  try {
    const aiResult = await verifyDisputeProofWithGemini({
      accountId,
      complaintId: profile.lienDetails.complaintId,
      heldAmount: profile.precisionLienHold,
      expectedUtrs,
      accountRiskScore: profile.risk_score,
      rapidPassThroughPct: profile.rapid_pass_through_pct,
      hasCircularPattern: profile.has_circular_pattern,
      connectedComplaintsCount: profile.connected_complaints.length,
      invoiceNumber: parsed.data.invoiceNumber,
      gstin: parsed.data.gstin,
      counterpartyName: parsed.data.counterpartyName,
      documentType: parsed.data.documentType,
      claimedAmount: parsed.data.claimedAmount,
      referencedUtr: parsed.data.referencedUtr,
    });

    const submission = {
      submittedAt: new Date().toISOString(),
      invoiceNumber: parsed.data.invoiceNumber,
      gstin: parsed.data.gstin.trim().toUpperCase(),
      counterpartyName: parsed.data.counterpartyName,
      documentType: parsed.data.documentType,
      claimedAmount: parsed.data.claimedAmount,
      referencedUtr: parsed.data.referencedUtr.trim(),
      ...aiResult,
    };

    const updatedState = store.recordDisputeSubmission(
      dataset.metadata.id,
      accountId,
      submission,
      profile.totalBalance,
    );

    const refreshed = store.getAnalysis(dataset.metadata.id).analysis.accounts.get(accountId);
    res.json({
      account: refreshed,
      lienState: updatedState,
      disputeSubmission: submission,
    });
  } catch (err) {
    res.status(502).json({
      error:
        err instanceof Error
          ? err.message
          : 'Gemini dispute proof verification failed.',
    });
  }
});

const resolveLienSchema = z.object({
  datasetId: z.string().optional(),
  decision: z.enum(['RELEASE', 'CONFIRM_FREEZE']),
  officerName: z.string().min(2).max(80).default('Nodal Officer Insp. R. Deshmukh'),
  remarks: z.string().min(2).max(600).default('Resolved per RBI 60-Day Money Mule SOP review.'),
});

apiRouter.post('/accounts/:id/resolve-lien', (req, res) => {
  const parsed = resolveLienSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid lien resolution payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const accountId = decodeURIComponent(req.params.id).toLowerCase();
  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const profile = analysis.accounts.get(accountId);
  if (!profile) {
    res.status(404).json({ error: `Account ${accountId} not found.` });
    return;
  }

  const { state, report } = store.resolveLien(
    dataset.metadata.id,
    accountId,
    parsed.data.decision,
    parsed.data.officerName,
    parsed.data.remarks,
    profile.totalBalance,
  );

  const refreshed = store.getAnalysis(dataset.metadata.id).analysis.accounts.get(accountId);
  res.json({
    account: refreshed,
    lienState: state,
    complianceReport: report,
  });
});

// ---------------------------------------------------------------------------
// 7. ALERTS
// ---------------------------------------------------------------------------
apiRouter.get('/alerts', (req, res) => {
  const { analysis } = store.getAnalysis(resolveDatasetId(req));
  res.json({ total: analysis.alerts.length, alerts: analysis.alerts });
});

// ---------------------------------------------------------------------------
// 8. INVESTIGATIONS (CASE MANAGEMENT)
// ---------------------------------------------------------------------------
apiRouter.get('/investigations', (req, res) => {
  const dataset = store.getDataset(resolveDatasetId(req));
  const cases = store.listInvestigations(dataset?.metadata.id);
  res.json({ total: cases.length, investigations: cases });
});

const createInvestigationSchema = z.object({
  datasetId: z.string().optional(),
  title: z.string().min(3).max(160),
  cluster_id: z.string().nullable().default(null),
  complaint_ids: z.array(z.string()).default([]),
  account_ids: z.array(z.string()).default([]),
  evidence_transaction_ids: z.array(z.string()).default([]),
  assignee: z.string().min(2).max(80).default('Insp. R. Deshmukh'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
  status: z
    .enum(['NEW', 'UNDER_REVIEW', 'ESCALATED', 'REPORT_GENERATED', 'CLOSED'])
    .default('NEW'),
  initialNote: z.string().max(2000).optional(),
  actor: z.string().optional(),
});

apiRouter.post('/investigations', (req, res) => {
  const parsed = createInvestigationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid case payload.', details: parsed.error.flatten() });
    return;
  }

  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  let complaintIds = [...parsed.data.complaint_ids];
  let accountIds = [...parsed.data.account_ids];
  let evidenceTxIds = [...parsed.data.evidence_transaction_ids];

  // If created from a cluster without explicit complaint list, hydrate from cluster
  if (parsed.data.cluster_id) {
    const cluster = analysis.clusters.find((c) => c.cluster_id === parsed.data.cluster_id);
    if (cluster) {
      if (complaintIds.length === 0) complaintIds = [...cluster.complaint_ids];
      if (accountIds.length === 0) accountIds = [...cluster.shared_recipient_accounts];
      if (evidenceTxIds.length === 0) evidenceTxIds = cluster.edges.slice(0, 15).map((e) => e.id);
    }
  }

  const totalAmount = analysis.complaints
    .filter((c) => complaintIds.includes(c.complaint_id))
    .reduce((sum, c) => sum + c.amount, 0);

  const created = store.createInvestigation({
    dataset_id: dataset.metadata.id,
    title: parsed.data.title.trim(),
    cluster_id: parsed.data.cluster_id,
    complaint_ids: complaintIds,
    account_ids: accountIds,
    evidence_transaction_ids: evidenceTxIds,
    total_reported_amount: totalAmount,
    assignee: parsed.data.assignee,
    priority: parsed.data.priority,
    status: parsed.data.status,
    initialNote: parsed.data.initialNote,
    actor: parsed.data.actor,
  });

  res.status(201).json(created);
});

const patchInvestigationSchema = z.object({
  status: z.enum(['NEW', 'UNDER_REVIEW', 'ESCALATED', 'REPORT_GENERATED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignee: z.string().min(2).max(80).optional(),
  addNote: z
    .object({
      author: z.string().min(1).max(80),
      content: z.string().min(1).max(2000),
    })
    .optional(),
  addComplaintIds: z.array(z.string()).optional(),
  addAccountIds: z.array(z.string()).optional(),
  addEvidenceTxIds: z.array(z.string()).optional(),
  actor: z.string().optional(),
});

apiRouter.patch('/investigations/:id', (req, res) => {
  const parsed = patchInvestigationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid case update payload.', details: parsed.error.flatten() });
    return;
  }
  const updated = store.updateInvestigation(req.params.id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: `Investigation case ${req.params.id} not found.` });
    return;
  }
  res.json(updated);
});

// ---------------------------------------------------------------------------
// 9. INVESTIGATION REPORT GENERATION
// ---------------------------------------------------------------------------
const generateReportSchema = z.object({
  caseId: z.string().min(1),
  includeAiSummary: z.boolean().default(true),
  datasetId: z.string().optional(),
});

apiRouter.post('/reports/generate', async (req, res) => {
  const parsed = generateReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid report generation request.', details: parsed.error.flatten() });
    return;
  }

  const caseRecord = store.getInvestigation(parsed.data.caseId);
  if (!caseRecord) {
    res.status(404).json({ error: `Case ${parsed.data.caseId} not found.` });
    return;
  }

  const { dataset, analysis } = store.getAnalysis(caseRecord.dataset_id);
  const linkedComplaints = analysis.complaints.filter((c) =>
    caseRecord.complaint_ids.includes(c.complaint_id),
  );
  const cluster = caseRecord.cluster_id
    ? analysis.clusters.find((c) => c.cluster_id === caseRecord.cluster_id) ?? null
    : null;

  const accountIdSet = new Set<string>(caseRecord.account_ids);
  for (const cmp of linkedComplaints) accountIdSet.add(cmp.receiver_upi);
  if (cluster) {
    for (const a of cluster.account_ids) accountIdSet.add(a);
  }

  const connectedAccounts = [...accountIdSet]
    .map((id) => analysis.accounts.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .sort((a, b) => b.risk_score - a.risk_score);

  // Compile traced multi-hop transactions from up to 10 linked complaints
  const traceEdgesMap = new Map<string, InvestigationReportData['traced_transactions'][number]>();
  let mixedFundsObserved = false;
  for (const cmp of linkedComplaints.slice(0, 12)) {
    if (cmp.match_status !== 'MATCHED_SUCCESS') continue;
    const t = traceComplaintFunds(dataset.metadata.id, cmp, dataset.transactions, {
      complaintId: cmp.complaint_id,
      maxHops: 5,
      windowHours: 72,
      minAmount: 0,
      statuses: ['SUCCESS'],
    });
    if (t.mixed_funds_detected) mixedFundsObserved = true;
    for (const edge of t.edges) {
      if (!traceEdgesMap.has(edge.transaction_id)) {
        traceEdgesMap.set(edge.transaction_id, edge);
      }
    }
  }

  const tracedTransactions = [...traceEdgesMap.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const originalTransactions = linkedComplaints
    .map((c) => c.matched_transaction)
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const missingLimitations: string[] = [
    'Opening account balances prior to the uploaded transaction ledger window are unavailable; onward fund attribution is therefore conservative and estimated where accounts hold mixed funds.',
    'UPI identifiers in this dataset have not been corroborated against bank KYC records, device fingerprints, IP logs, or beneficiary identity registries.',
    'Risk scores are computed using configurable prototype weights and do not represent court-admissible or bank-validated fraud classifications.',
  ];
  if (dataset.metadata.source_type === 'SYNTHETIC_DEMO') {
    missingLimitations.unshift(
      'SYNTHETIC DATA NOTICE: All accounts (@demo), complaints, and UTR references in this workspace are simulated demonstration records and not verified banking records.',
    );
  }
  const unmatchedCount = linkedComplaints.filter((c) => c.match_status === 'UNMATCHED').length;
  if (unmatchedCount > 0) {
    missingLimitations.push(
      `${unmatchedCount} linked complaint(s) could not be matched to a settled record in the uploaded transaction ledger.`,
    );
  }
  if (mixedFundsObserved) {
    missingLimitations.push(
      'Mixed incoming funds were detected on one or more intermediary accounts; FIFO attribution estimates cannot definitively prove individual rupee provenance.',
    );
  }

  let aiSummary = null;
  if (parsed.data.includeAiSummary) {
    try {
      aiSummary = await generateGroundedExplanation({
        question:
          'Generate an executive preliminary analytical investigation summary for this case, highlighting linked complaints, observed multi-hop patterns, key accounts requiring review, and data limitations.',
        contextType: 'CASE',
        evidenceContext: {
          case_id: caseRecord.case_id,
          title: caseRecord.title,
          status: caseRecord.status,
          total_reported_amount: caseRecord.total_reported_amount,
          linked_complaints: linkedComplaints.slice(0, 15).map((c) => ({
            complaint_id: c.complaint_id,
            amount: c.amount,
            sender_upi: c.sender_upi,
            receiver_upi: c.receiver_upi,
            reported_transaction_id: c.reported_transaction_id,
            utr: c.utr,
            match_status: c.match_status,
          })),
          cluster_summary: cluster
            ? {
                cluster_id: cluster.cluster_id,
                name: cluster.name,
                shared_recipient_accounts: cluster.shared_recipient_accounts,
                intermediary_accounts: cluster.intermediary_accounts,
                downstream_accounts: cluster.downstream_accounts,
                has_circular_pattern: cluster.has_circular_pattern,
                common_pathways: cluster.common_pathways.slice(0, 5),
              }
            : null,
          top_accounts: connectedAccounts.slice(0, 10).map((a) => ({
            upi_id: a.upi_id,
            role: a.role,
            risk_score: a.risk_score,
            risk_category: a.risk_category,
            connected_complaints: a.connected_complaints.slice(0, 8),
            rapid_pass_through_pct: a.rapid_pass_through_pct,
            has_circular_pattern: a.has_circular_pattern,
            supporting_transaction_ids: a.supporting_transaction_ids.slice(0, 6),
          })),
          sample_traced_transactions: tracedTransactions.slice(0, 20).map((t) => ({
            transaction_id: t.transaction_id,
            utr: t.utr,
            sender_upi: t.sender_upi,
            receiver_upi: t.receiver_upi,
            amount: t.amount,
            potentially_attributed_amount: t.potentially_attributed_amount,
            attribution_status: t.attribution_status,
            hop: t.hop,
            is_circular: t.is_circular,
          })),
          limitations: missingLimitations,
        },
      });
    } catch {
      // If Gemini is unavailable or key missing, report still generates with explicit null AI summary
      aiSummary = null;
    }
  }

  const report: InvestigationReportData = {
    report_id: `RPT-${caseRecord.case_id}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
    label: 'PRELIMINARY ANALYTICAL INVESTIGATION REPORT',
    disclaimer:
      'This report contains analytical findings based on the transaction data supplied to MuleShield. Risk indicators are investigative leads and do not independently establish fraud, criminal intent, account ownership, or legal liability. All findings require verification by authorised investigators.',
    generated_at: new Date().toISOString(),
    dataset_source: dataset.metadata.name,
    source_type: dataset.metadata.source_type,
    analysis_version: dataset.metadata.analysis_version,
    case_record: caseRecord,
    linked_complaints: linkedComplaints,
    total_reported_amount: linkedComplaints.reduce((s, c) => s + c.amount, 0),
    connected_accounts: connectedAccounts,
    network_cluster: cluster,
    traced_transactions: tracedTransactions,
    original_transactions: originalTransactions,
    attribution_method: 'Conservative Chronological FIFO Queue',
    attribution_assumptions: [
      'Traceable inflows are allocated chronologically via FIFO alongside any observed unrelated inflows in the tracing window.',
      'Only settled (SUCCESS) transactions propagate traceable funds forward; FAILED, REVERSED, and PENDING records are excluded.',
      'Where accounts receive mixed funds or lack opening balance records, onward amounts are labelled as estimated / potentially linked.',
    ],
    missing_evidence_and_limitations: missingLimitations,
    ai_summary: aiSummary,
  };

  store.saveReport(report);
  store.updateInvestigation(caseRecord.case_id, {
    status: caseRecord.status === 'CLOSED' ? 'CLOSED' : 'REPORT_GENERATED',
    actor: caseRecord.assignee,
  });

  res.json(report);
});

apiRouter.get('/reports', (_req, res) => {
  res.json({ reports: store.listReports() });
});

// ---------------------------------------------------------------------------
// 10. GEMINI AI INVESTIGATION ASSISTANT
// ---------------------------------------------------------------------------
const aiExplainSchema = z.object({
  datasetId: z.string().optional(),
  question: z.string().min(3).max(800),
  contextType: z.enum(['DATASET', 'CLUSTER', 'ACCOUNT', 'COMPLAINT', 'TRACE', 'CASE']).default('DATASET'),
  entityId: z.string().optional(),
});

apiRouter.post('/ai/explain', async (req, res) => {
  const parsed = aiExplainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid AI query payload.', details: parsed.error.flatten() });
    return;
  }

  const { dataset, analysis } = store.getAnalysis(parsed.data.datasetId);
  const { contextType, entityId, question } = parsed.data;

  // Retrieve strictly verified structured backend context matching the query scope
  let evidenceContext: Record<string, unknown> = {};

  if (contextType === 'ACCOUNT' && entityId) {
    const acctId = entityId.toLowerCase();
    const profile = analysis.accounts.get(acctId);
    if (!profile) {
      res.status(404).json({ error: `Account ${entityId} not found in active dataset.` });
      return;
    }
    const acctTxs = dataset.transactions
      .filter((t) => t.sender_upi === acctId || t.receiver_upi === acctId)
      .slice(0, 30);
    evidenceContext = {
      dataset_source_type: dataset.metadata.source_type,
      account: profile,
      recent_transactions: acctTxs,
      linked_complaints: analysis.complaints
        .filter((c) => profile.connected_complaints.includes(c.complaint_id))
        .slice(0, 20),
    };
  } else if (contextType === 'CLUSTER' && entityId) {
    const cluster = analysis.clusters.find((c) => c.cluster_id === entityId);
    if (!cluster) {
      res.status(404).json({ error: `Cluster ${entityId} not found.` });
      return;
    }
    evidenceContext = {
      dataset_source_type: dataset.metadata.source_type,
      cluster_id: cluster.cluster_id,
      name: cluster.name,
      complaint_ids: cluster.complaint_ids,
      unique_victims_count: cluster.unique_victims.length,
      total_reported_amount: cluster.total_reported_amount,
      shared_recipient_accounts: cluster.shared_recipient_accounts,
      intermediary_accounts: cluster.intermediary_accounts,
      downstream_accounts: cluster.downstream_accounts,
      has_circular_pattern: cluster.has_circular_pattern,
      common_pathways: cluster.common_pathways,
      sample_edges: cluster.edges.slice(0, 35),
      member_risk_scores: cluster.account_ids.map((id) => {
        const p = analysis.accounts.get(id);
        return {
          upi_id: id,
          role: p?.role,
          risk_score: p?.risk_score,
          risk_category: p?.risk_category,
          connected_complaints_count: p?.connected_complaints.length,
          rapid_pass_through_pct: p?.rapid_pass_through_pct,
        };
      }),
    };
  } else if (contextType === 'COMPLAINT' && entityId) {
    const cmp = analysis.complaints.find((c) => c.complaint_id === entityId);
    if (!cmp) {
      res.status(404).json({ error: `Complaint ${entityId} not found.` });
      return;
    }
    const trace = traceComplaintFunds(dataset.metadata.id, cmp, dataset.transactions, {
      complaintId: cmp.complaint_id,
      maxHops: 5,
      windowHours: 72,
      minAmount: 0,
      statuses: ['SUCCESS'],
    });
    evidenceContext = {
      dataset_source_type: dataset.metadata.source_type,
      complaint: cmp,
      trace_summary: {
        original_amount: trace.original_amount,
        total_potentially_attributed: trace.total_potentially_attributed,
        untraced_amount: trace.untraced_amount,
        mixed_funds_detected: trace.mixed_funds_detected,
        patterns: trace.patterns,
        warnings: trace.warnings,
      },
      traced_edges: trace.edges.slice(0, 30),
    };
  } else if (contextType === 'CASE' && entityId) {
    const inv = store.getInvestigation(entityId);
    if (!inv) {
      res.status(404).json({ error: `Case ${entityId} not found.` });
      return;
    }
    evidenceContext = {
      dataset_source_type: dataset.metadata.source_type,
      case: inv,
      accounts: inv.account_ids.map((id) => analysis.accounts.get(id)).filter(Boolean),
    };
  } else {
    // Dataset-wide executive context
    const topAccounts = analysis.accountsList
      .filter((a) => a.role !== 'VICTIM')
      .slice(0, 15)
      .map((a) => ({
        upi_id: a.upi_id,
        role: a.role,
        risk_score: a.risk_score,
        risk_category: a.risk_category,
        connected_complaints: a.connected_complaints.slice(0, 8),
        connected_complaints_count: a.connected_complaints.length,
        rapid_pass_through_pct: a.rapid_pass_through_pct,
        unique_senders: a.unique_senders,
        unique_recipients: a.unique_recipients,
        has_circular_pattern: a.has_circular_pattern,
        supporting_transaction_ids: a.supporting_transaction_ids.slice(0, 5),
      }));

    evidenceContext = {
      dataset_name: dataset.metadata.name,
      dataset_source_type: dataset.metadata.source_type,
      total_complaints: analysis.complaints.length,
      matched_success_complaints: analysis.complaints.filter((c) => c.match_status === 'MATCHED_SUCCESS').length,
      unmatched_complaints: analysis.complaints.filter((c) => c.match_status === 'UNMATCHED').map((c) => c.complaint_id),
      non_success_complaints: analysis.complaints.filter((c) => c.match_status === 'MATCHED_NON_SUCCESS').map((c) => c.complaint_id),
      clusters: analysis.clusters.map((c) => ({
        cluster_id: c.cluster_id,
        name: c.name,
        complaint_count: c.complaint_ids.length,
        sample_complaints: c.complaint_ids.slice(0, 8),
        total_reported_amount: c.total_reported_amount,
        shared_recipient_accounts: c.shared_recipient_accounts,
        downstream_accounts: c.downstream_accounts,
        has_circular_pattern: c.has_circular_pattern,
      })),
      top_flagged_accounts: topAccounts,
    };
  }

  try {
    const explanation = await generateGroundedExplanation({
      question,
      contextType,
      evidenceContext,
    });
    res.json(explanation);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate AI explanation.';
    res.status(502).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 11. RISK CONFIGURATION SETTINGS
// ---------------------------------------------------------------------------
apiRouter.get('/settings/risk-config', (_req, res) => {
  res.json({
    config: store.getRiskConfig(),
    disclaimer:
      'Prototype analytical weights and thresholds for investigative prioritization. Not validated banking or legal fraud thresholds.',
  });
});

const riskConfigSchema = z.object({
  rapidPassThrough: z.number().min(0).max(50),
  crossComplaintRecurrence: z.number().min(0).max(50),
  fanIn: z.number().min(0).max(50),
  fanOut: z.number().min(0).max(50),
  transactionVelocity: z.number().min(0).max(50),
  networkAndCircular: z.number().min(0).max(50),
  mediumThreshold: z.number().min(10).max(80),
  highThreshold: z.number().min(20).max(95),
});

apiRouter.patch('/settings/risk-config', (req, res) => {
  const parsed = riskConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid risk configuration.', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (d.highThreshold <= d.mediumThreshold) {
    res.status(400).json({ error: 'High-risk threshold must be strictly greater than medium-risk threshold.' });
    return;
  }
  const updated = store.updateRiskConfig(d);
  res.json({ config: updated });
});

// ---------------------------------------------------------------------------
// 12. GLOBAL SEARCH
// ---------------------------------------------------------------------------
apiRouter.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (!q || q.length < 2) {
    const empty: GlobalSearchResult = {
      accounts: [],
      complaints: [],
      transactions: [],
      clusters: [],
      investigations: [],
    };
    res.json(empty);
    return;
  }

  const { dataset, analysis } = store.getAnalysis(resolveDatasetId(req));
  const cases = store.listInvestigations(dataset.metadata.id);

  const result: GlobalSearchResult = {
    accounts: analysis.accountsList
      .filter((a) => a.upi_id.toLowerCase().includes(q))
      .slice(0, 6)
      .map((a) => ({
        upi_id: a.upi_id,
        risk_score: a.risk_score,
        risk_category: a.risk_category,
        role: a.role,
      })),
    complaints: analysis.complaints
      .filter(
        (c) =>
          c.complaint_id.toLowerCase().includes(q) ||
          c.victim_reference.toLowerCase().includes(q) ||
          c.receiver_upi.toLowerCase().includes(q) ||
          c.utr.toLowerCase().includes(q),
      )
      .slice(0, 6)
      .map((c) => ({
        complaint_id: c.complaint_id,
        receiver_upi: c.receiver_upi,
        amount: c.amount,
        complaint_date: c.complaint_date,
      })),
    transactions: dataset.transactions
      .filter(
        (t) =>
          t.transaction_id.toLowerCase().includes(q) ||
          t.utr.toLowerCase().includes(q),
      )
      .slice(0, 6)
      .map((t) => ({
        transaction_id: t.transaction_id,
        utr: t.utr,
        sender_upi: t.sender_upi,
        receiver_upi: t.receiver_upi,
        amount: t.amount,
        status: t.status,
      })),
    clusters: analysis.clusters
      .filter(
        (c) =>
          c.cluster_id.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      )
      .slice(0, 4)
      .map((c) => ({
        cluster_id: c.cluster_id,
        name: c.name,
        complaint_count: c.complaint_ids.length,
        total_reported_amount: c.total_reported_amount,
      })),
    investigations: cases
      .filter(
        (i) =>
          i.case_id.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q),
      )
      .slice(0, 4)
      .map((i) => ({
        case_id: i.case_id,
        title: i.title,
        status: i.status,
        priority: i.priority,
      })),
  };

  res.json(result);
});
