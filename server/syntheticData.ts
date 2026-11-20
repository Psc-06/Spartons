import type {
  AccountKycProfile,
  AccountLienState,
  FraudComplaint,
  GroundTruthLabel,
  TransactionRecord,
  TransactionStatus,
} from '../src/shared/types.ts';
import { computeRbiSopStatutorySchedule } from './analyticsEngine.ts';

/**
 * Deterministic pseudo-random generator (Mulberry32) so the synthetic
 * demonstration workspace is reproducible across reloads and tests.
 */
function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function addMinutes(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

function addDays(baseIso: string, days: number): string {
  return new Date(new Date(baseIso).getTime() + days * 86_400_000).toISOString();
}

export interface SyntheticDatasetBundle {
  complaints: FraudComplaint[];
  transactions: TransactionRecord[];
  groundTruth: GroundTruthLabel[];
  initialAccountStates: Record<string, AccountLienState>;
  accountKycProfiles: Record<string, AccountKycProfile>;
}

export function generateSyntheticDemoDataset(): SyntheticDatasetBundle {
  const rng = createRng(20261119);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const randInt = (min: number, max: number) =>
    Math.floor(rng() * (max - min + 1)) + min;

  const complaints: FraudComplaint[] = [];
  const transactions: TransactionRecord[] = [];
  const groundTruth: GroundTruthLabel[] = [];

  let txSeq = 10001;
  let utrSeq = 631890000100;
  let cmpSeq = 1;

  const channels = ['UPI_P2P', 'UPI_INTENT', 'UPI_QR', 'UPI_COLLECT'];
  const fraudTypologies = [
    'Investment App Scam',
    'Digital Arrest Extortion',
    'Fake KYC Update Link',
    'Part-Time Task Fraud',
    'Customer Care Impersonation',
  ];

  const makeTx = (
    sender_upi: string,
    receiver_upi: string,
    amount: number,
    timestamp: string,
    status: TransactionStatus = 'SUCCESS',
    channel?: string,
  ): TransactionRecord => {
    const id = `TXN-${pad(txSeq++, 6)}`;
    const utr = `UTR${utrSeq++}`;
    const tx: TransactionRecord = {
      transaction_id: id,
      timestamp,
      sender_upi,
      receiver_upi,
      amount: Math.round(amount),
      status,
      utr,
      channel: channel ?? pick(channels),
    };
    transactions.push(tx);
    return tx;
  };

  const makeComplaint = (
    victimRef: string,
    tx: TransactionRecord,
    daysAfter = 1,
    typology?: string,
  ): FraudComplaint => {
    const id = `CMP-2026-${pad(cmpSeq++, 3)}`;
    const complaintDate = new Date(
      new Date(tx.timestamp).getTime() + daysAfter * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const cmp: FraudComplaint = {
      complaint_id: id,
      victim_reference: victimRef,
      reported_transaction_id: tx.transaction_id,
      utr: tx.utr,
      transaction_timestamp: tx.timestamp,
      amount: tx.amount,
      sender_upi: tx.sender_upi,
      receiver_upi: tx.receiver_upi,
      complaint_date: complaintDate,
      fraud_typology: typology ?? pick(fraudTypologies),
    };
    complaints.push(cmp);
    return cmp;
  };

  // ---------------------------------------------------------------------------
  // 100 Fictional @demo Accounts organized cleanly
  // ---------------------------------------------------------------------------
  // 35 victim accounts (some victims file 1-2 complaints)
  const victimAccounts: string[] = Array.from(
    { length: 35 },
    (_, i) => `citizen.v${pad(i + 1, 2)}@demo`,
  );

  // Cluster A: Apex Layering Ring (18 complaints -> 4 L1 -> 3 L2 -> 4 L3)
  const clusterAL1 = [
    'ravi.k.pay@demo',
    'sanjay.m.collect@demo',
    'kiran.fastpay@demo',
    'neha.quickupi@demo',
  ];
  const clusterAL2 = [
    'hub.alpha01@demo',
    'hub.beta02@demo',
    'layer.core03@demo',
  ];
  const clusterAL3 = [
    'exit.vault01@demo',
    'exit.vault02@demo',
    'exit.crypto03@demo',
    'exit.cashout04@demo',
  ];

  // Cluster B: Circular Velocity Syndicate (15 complaints -> 3 L1 -> 3 L2 circular -> 2 L3)
  const clusterBL1 = [
    'amit.t.upi@demo',
    'pooja.r.upi@demo',
    'vikram.s.upi@demo',
  ];
  const clusterBL2 = [
    'relay.north01@demo',
    'relay.east02@demo',
    'relay.west03@demo',
  ];
  const clusterBL3 = ['sink.gold01@demo', 'sink.trade02@demo'];

  // Cluster C: Split-Funnel Collection Web (12 complaints -> 3 L1 -> 2 L2 -> 2 L3)
  const clusterCL1 = [
    'manoj.p.upi@demo',
    'deepak.v.upi@demo',
    'sunita.d.upi@demo',
  ];
  const clusterCL2 = ['funnel.central@demo', 'funnel.reserve@demo'];
  const clusterCL3 = ['outflow.metro01@demo', 'outflow.metro02@demo'];

  // Isolated single-complaint recipients (5 accounts)
  const isolatedRecipients = [
    'local.seller01@demo',
    'freelance.dev02@demo',
    'ticket.agent03@demo',
    'rental.broker04@demo',
    'gadget.dealer05@demo',
  ];

  // 2 Deliberate False-Positive Legitimate Commercial Controls (NO complaints)
  const falsePositiveControls = [
    'freshmart.bazaar@demo', // High fan-in legitimate supermarket + vendor payouts
    'acmecorp.payroll@demo', // High fan-out legitimate payroll disbursement
  ];

  // 32 Normal Legitimate Control Accounts (total accounts = 35 + 11 + 8 + 7 + 5 + 2 + 32 = 100!)
  const normalControls: string[] = Array.from(
    { length: 32 },
    (_, i) => `resident.c${pad(i + 1, 2)}@demo`,
  );

  // Record isolated ground-truth labels (NEVER read by analytics/risk engine)
  for (const a of clusterAL1)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L1', planted_cluster: 'PLANTED_CLUSTER_A', is_false_positive_control: false });
  for (const a of clusterAL2)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L2_INTERMEDIARY', planted_cluster: 'PLANTED_CLUSTER_A', is_false_positive_control: false });
  for (const a of clusterAL3)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L3_EXIT', planted_cluster: 'PLANTED_CLUSTER_A', is_false_positive_control: false });
  for (const a of clusterBL1)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L1', planted_cluster: 'PLANTED_CLUSTER_B', is_false_positive_control: false });
  for (const a of clusterBL2)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L2_CIRCULAR', planted_cluster: 'PLANTED_CLUSTER_B', is_false_positive_control: false });
  for (const a of clusterBL3)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L3_EXIT', planted_cluster: 'PLANTED_CLUSTER_B', is_false_positive_control: false });
  for (const a of clusterCL1)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L1', planted_cluster: 'PLANTED_CLUSTER_C', is_false_positive_control: false });
  for (const a of clusterCL2)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L2_FUNNEL', planted_cluster: 'PLANTED_CLUSTER_C', is_false_positive_control: false });
  for (const a of clusterCL3)
    groundTruth.push({ upi_id: a, planted_role: 'MULE_L3_EXIT', planted_cluster: 'PLANTED_CLUSTER_C', is_false_positive_control: false });
  for (const a of falsePositiveControls)
    groundTruth.push({ upi_id: a, planted_role: 'LEGITIMATE_COMMERCIAL', planted_cluster: null, is_false_positive_control: true });
  for (const a of normalControls)
    groundTruth.push({ upi_id: a, planted_role: 'LEGITIMATE_P2P', planted_cluster: null, is_false_positive_control: false });

  // Base start date: 18 days prior to 2026-11-19
  const baseDateMs = new Date('2026-11-01T08:00:00.000Z').getTime();
  const dayOffsetIso = (dayIndex: number, hour: number, minute: number) =>
    new Date(
      baseDateMs + dayIndex * 86_400_000 + hour * 3_600_000 + minute * 60_000,
    ).toISOString();

  // ---------------------------------------------------------------------------
  // CLUSTER A: 17 Complaints -> Rapid Pass-Through + Fan-Out + Mixed Funds
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 17; i++) {
    const day = Math.floor((i / 17) * 14);
    const ts0 = dayOffsetIso(day, randInt(9, 19), randInt(0, 55));
    const victim = victimAccounts[i];
    const l1 = clusterAL1[i % clusterAL1.length];
    const amount = randInt(28, 95) * 1000; // ₹28,000 - ₹95,000

    // Inject an unrelated incoming credit into L1 slightly earlier on even indices
    // to create realistic mixed-fund conditions for conservative FIFO attribution
    if (i % 3 === 0) {
      makeTx(
        normalControls[i % normalControls.length],
        l1,
        randInt(8, 22) * 1000,
        addMinutes(ts0, -randInt(15, 45)),
        'SUCCESS',
        'UPI_P2P',
      );
    }

    // Victim -> L1
    const originTx = makeTx(victim, l1, amount, ts0, 'SUCCESS', 'UPI_INTENT');
    makeComplaint(`VIC-${pad(i + 1, 4)}`, originTx, randInt(1, 2), 'Investment App Scam');

    // Also occasionally inject a FAILED transfer attempt right after to verify filtering
    if (i % 4 === 0) {
      makeTx(l1, clusterAL2[0], Math.round(amount * 0.5), addMinutes(ts0, 3), 'FAILED', 'UPI_P2P');
    }

    // Rapid pass-through: L1 splits funds across 2 L2 intermediaries within 6-22 mins
    const l2Primary = clusterAL2[i % clusterAL2.length];
    const l2Secondary = clusterAL2[(i + 1) % clusterAL2.length];
    const split1 = Math.round(amount * 0.58);
    const split2 = Math.round(amount * 0.36);

    const ts1a = addMinutes(ts0, randInt(5, 14));
    const ts1b = addMinutes(ts0, randInt(15, 28));
    makeTx(l1, l2Primary, split1, ts1a, 'SUCCESS', 'UPI_P2P');
    makeTx(l1, l2Secondary, split2, ts1b, 'SUCCESS', 'UPI_P2P');

    // Hop 3: L2 -> L3 downstream exit accounts within 15-45 mins
    const l3a = clusterAL3[i % clusterAL3.length];
    const l3b = clusterAL3[(i + 2) % clusterAL3.length];
    makeTx(l2Primary, l3a, Math.round(split1 * 0.88), addMinutes(ts1a, randInt(12, 35)), 'SUCCESS', 'UPI_P2P');
    makeTx(l2Secondary, l3b, Math.round(split2 * 0.85), addMinutes(ts1b, randInt(18, 45)), 'SUCCESS', 'UPI_P2P');
  }

  // ---------------------------------------------------------------------------
  // CLUSTER B: 15 Complaints -> Circular Layering Loop + Rapid Pass-Through
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 15; i++) {
    const day = Math.floor((i / 15) * 14) + 1;
    const ts0 = dayOffsetIso(day, randInt(10, 20), randInt(0, 50));
    const victim = victimAccounts[18 + (i % 12)];
    const l1 = clusterBL1[i % clusterBL1.length];
    const amount = randInt(35, 120) * 1000;

    const originTx = makeTx(victim, l1, amount, ts0, 'SUCCESS', 'UPI_COLLECT');
    makeComplaint(`VIC-${pad(19 + i, 4)}`, originTx, randInt(1, 3), 'Digital Arrest Extortion');

    // L1 -> L2[0] within 8-18 minutes
    const l2Start = clusterBL2[i % clusterBL2.length];
    const l2Next = clusterBL2[(i + 1) % clusterBL2.length];
    const l2Third = clusterBL2[(i + 2) % clusterBL2.length];

    const ts1 = addMinutes(ts0, randInt(7, 16));
    const amt1 = Math.round(amount * 0.92);
    makeTx(l1, l2Start, amt1, ts1, 'SUCCESS', 'UPI_P2P');

    // On every 3rd complaint, execute an explicit circular loop across all 3 relay accounts
    if (i % 3 === 0) {
      const ts2 = addMinutes(ts1, randInt(9, 18));
      const ts3 = addMinutes(ts2, randInt(10, 20));
      const ts4 = addMinutes(ts3, randInt(10, 20));
      const loopAmt = Math.round(amt1 * 0.85);
      makeTx(l2Start, l2Next, loopAmt, ts2, 'SUCCESS', 'UPI_P2P');
      makeTx(l2Next, l2Third, Math.round(loopAmt * 0.95), ts3, 'SUCCESS', 'UPI_P2P');
      makeTx(l2Third, l2Start, Math.round(loopAmt * 0.9), ts4, 'SUCCESS', 'UPI_P2P');
      // Then cashout from l2Start -> L3
      makeTx(
        l2Start,
        clusterBL3[i % clusterBL3.length],
        Math.round(loopAmt * 0.82),
        addMinutes(ts4, randInt(15, 30)),
        'SUCCESS',
        'UPI_P2P',
      );
    } else {
      const ts2 = addMinutes(ts1, randInt(12, 25));
      makeTx(l2Start, l2Next, Math.round(amt1 * 0.55), ts2, 'SUCCESS', 'UPI_P2P');
      makeTx(
        l2Next,
        clusterBL3[i % clusterBL3.length],
        Math.round(amt1 * 0.48),
        addMinutes(ts2, randInt(18, 40)),
        'SUCCESS',
        'UPI_P2P',
      );
    }

    if (i % 5 === 0) {
      makeTx(l2Start, clusterBL3[1], 15000, addMinutes(ts1, 4), 'REVERSED', 'UPI_P2P');
    }
  }

  // ---------------------------------------------------------------------------
  // CLUSTER C: 12 Complaints -> Many-to-One Funnel Collection
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 12; i++) {
    const day = Math.floor((i / 12) * 13) + 2;
    const ts0 = dayOffsetIso(day, randInt(8, 18), randInt(0, 55));
    const victim = victimAccounts[23 + (i % 12)];
    const l1 = clusterCL1[i % clusterCL1.length];
    const amount = randInt(18, 65) * 1000;

    const originTx = makeTx(victim, l1, amount, ts0, 'SUCCESS', 'UPI_QR');
    makeComplaint(`VIC-${pad(34 + i, 4)}`, originTx, randInt(1, 2), 'Part-Time Task Fraud');

    const funnel = clusterCL2[i % clusterCL2.length];
    const ts1 = addMinutes(ts0, randInt(10, 30));
    const amt1 = Math.round(amount * 0.9);
    makeTx(l1, funnel, amt1, ts1, 'SUCCESS', 'UPI_P2P');

    // Funnel consolidates and pushes to downstream metro exit
    const exitAcct = clusterCL3[i % clusterCL3.length];
    makeTx(funnel, exitAcct, Math.round(amt1 * 0.85), addMinutes(ts1, randInt(20, 65)), 'SUCCESS', 'UPI_P2P');
  }

  // ---------------------------------------------------------------------------
  // 4 DETERMINISTIC RULE SHOWCASE SCENARIOS + 2 EDGE CASES (Total = 17+15+12+6 = 50)
  // ---------------------------------------------------------------------------
  // Showcase 1 (CMP-2026-045): Student Account ₹1 Lakh Outlier (RULE_STUDENT_TIER_OVERFLOW)
  // Rohan Sharma, Age 19, Student KYC -> receives ₹1,80,000 and immediately sweeps ₹1,65,000
  const tsStudent0 = dayOffsetIso(14, 11, 10);
  const studentOriginTx = makeTx(
    victimAccounts[30],
    'rohan.sharma19@okhdfcbank',
    180000,
    tsStudent0,
    'SUCCESS',
    'UPI_INTENT',
  );
  const studentCmp = makeComplaint(
    'VIC-0045',
    studentOriginTx,
    1,
    'Student Mule Recruitment / Investment Scam',
  );
  makeTx(
    'rohan.sharma19@okhdfcbank',
    'student.sweep01@demo',
    165000,
    addMinutes(tsStudent0, 11),
    'SUCCESS',
    'UPI_P2P',
  );

  // Showcase 2 (CMP-2026-046): 6-Month Historical Baseline Velocity Spike (RULE_6M_HISTORICAL_VOL_SPIKE)
  // vikram.traders06@okicici (6m avg ₹12,000/mo) receives ₹3,50,000 across 5 transfers in 3 hours
  const tsSpike0 = dayOffsetIso(15, 10, 0);
  const spikeAmounts = [70000, 65000, 75000, 80000, 60000]; // Sum = ₹3,50,000
  const spikeSenders = [
    normalControls[2],
    normalControls[5],
    normalControls[8],
    victimAccounts[31],
    normalControls[11],
  ];
  let vikramReportedTx: TransactionRecord | null = null;
  for (let k = 0; k < spikeAmounts.length; k++) {
    const tx = makeTx(
      spikeSenders[k],
      'vikram.traders06@okicici',
      spikeAmounts[k],
      addMinutes(tsSpike0, k * 38),
      'SUCCESS',
      'UPI_P2P',
    );
    if (k === 3) vikramReportedTx = tx;
  }
  const vikramCmp = makeComplaint(
    'VIC-0046',
    vikramReportedTx!,
    1,
    'Sudden Mule Activation / Velocity Spike Fraud',
  );
  makeTx(
    'vikram.traders06@okicici',
    'vikram.offload01@demo',
    295000,
    addMinutes(tsSpike0, 175),
    'SUCCESS',
    'UPI_P2P',
  );

  // Showcase 3 (CMP-2026-047): 3-Hop Branching Multi-Hop NCRP Trail (RULE_BRANCHING_MULTI_HOP_DAG)
  // Victim sends ₹85,000 -> ncrp.relay01@okaxis (Hop 1) -> fans out to 4 accounts within 26m (Hop 2) -> Hop 3 exits
  const tsBranch0 = dayOffsetIso(15, 14, 5);
  const branchOriginTx = makeTx(
    victimAccounts[32],
    'ncrp.relay01@okaxis',
    85000,
    tsBranch0,
    'SUCCESS',
    'UPI_COLLECT',
  );
  const branchCmp = makeComplaint(
    'VIC-0047',
    branchOriginTx,
    1,
    'Digital Arrest Multi-Hop Branching Scam',
  );
  const branchTargets = [
    { acct: 'branch.mule01@demo', amt: 22000, mins: 6, hop3Acct: 'branch.exit01@demo', hop3Amt: 20500, hop3Delay: 12 },
    { acct: 'branch.mule02@demo', amt: 21000, mins: 11, hop3Acct: 'branch.exit01@demo', hop3Amt: 19500, hop3Delay: 24 },
    { acct: 'branch.mule03@demo', amt: 20000, mins: 18, hop3Acct: 'branch.exit01@demo', hop3Amt: 18500, hop3Delay: 75 },
    { acct: 'branch.mule04@demo', amt: 19000, mins: 26, hop3Acct: 'branch.exit02@demo', hop3Amt: 17500, hop3Delay: 135 },
  ];
  for (const b of branchTargets) {
    const tsHop2 = addMinutes(tsBranch0, b.mins);
    makeTx('ncrp.relay01@okaxis', b.acct, b.amt, tsHop2, 'SUCCESS', 'UPI_P2P');
    makeTx(b.acct, b.hop3Acct, b.hop3Amt, addMinutes(tsHop2, b.hop3Delay), 'SUCCESS', 'UPI_P2P');
  }

  // Showcase 4 (CMP-2026-048): Lookalike VPA Brand Impersonation (RULE_SUSPICIOUS_LOOKALIKE_VPA)
  // patanjalii@okaxis receives payments from 6 distinct first-time payers
  const tsLookalike0 = dayOffsetIso(16, 9, 20);
  const impAmounts = [22000, 14500, 18000, 24000, 16500, 19500];
  let lookalikeReportedTx: TransactionRecord | null = null;
  for (let k = 0; k < impAmounts.length; k++) {
    const payer = k === 0 ? victimAccounts[33] : `buyer.imp0${k + 1}@demo`;
    const tx = makeTx(
      payer,
      'patanjalii@okaxis',
      impAmounts[k],
      addMinutes(tsLookalike0, k * 34),
      'SUCCESS',
      'UPI_QR',
    );
    if (k === 0) lookalikeReportedTx = tx;
  }
  const lookalikeCmp = makeComplaint(
    'VIC-0048',
    lookalikeReportedTx!,
    1,
    'Lookalike VPA / Brand Impersonation Scam',
  );
  makeTx(
    'patanjalii@okaxis',
    'imp.cashout01@demo',
    92000,
    addMinutes(tsLookalike0, 205),
    'SUCCESS',
    'UPI_P2P',
  );

  // Edge case 1 (CMP-2026-049): Reported transaction actually REVERSED in ledger (non-success!)
  const tsRev = dayOffsetIso(10, 14, 36);
  const revTx = makeTx(victimAccounts[33], isolatedRecipients[3], 24000, tsRev, 'REVERSED', 'UPI_P2P');
  makeComplaint('VIC-0049', revTx, 1, 'Fake KYC Update Link');

  // Edge case 2 (CMP-2026-050): Complaint where transaction is NOT found in ledger (missing ledger evidence)
  const tsUnmatched = dayOffsetIso(12, 14, 43);
  complaints.push({
    complaint_id: `CMP-2026-${pad(cmpSeq++, 3)}`,
    victim_reference: 'VIC-0050',
    reported_transaction_id: 'TXN-999901',
    utr: 'UTR999999999001',
    transaction_timestamp: tsUnmatched,
    amount: 31000,
    sender_upi: victimAccounts[34],
    receiver_upi: isolatedRecipients[4],
    complaint_date: new Date(new Date(tsUnmatched).getTime() + 86_400_000).toISOString().slice(0, 10),
    fraud_typology: 'Customer Care Impersonation',
  });

  // ---------------------------------------------------------------------------
  // False-Positive Legitimate Commercial Controls (No complaint links!)
  // ---------------------------------------------------------------------------
  // 1) freshmart.bazaar@demo: 26 distinct normal residents shop here daily,
  //    plus regular bulk supplier payouts (high fan-in & velocity, 0 complaints)
  const freshmart = falsePositiveControls[0];
  for (let day = 0; day < 16; day++) {
    for (let k = 0; k < 8; k++) {
      const shopper = normalControls[(day * 5 + k * 3) % normalControls.length];
      makeTx(
        shopper,
        freshmart,
        randInt(350, 3200),
        dayOffsetIso(day, randInt(9, 20), randInt(0, 59)),
        rng() < 0.04 ? 'FAILED' : 'SUCCESS',
        'UPI_QR',
      );
    }
    // Periodic supplier settlement every 2 days (not rapid 10-min mule pass-through)
    if (day % 2 === 1) {
      makeTx(
        freshmart,
        normalControls[day % 4],
        randInt(18000, 34000),
        dayOffsetIso(day, 21, 30),
        'SUCCESS',
        'UPI_P2P',
      );
    }
  }

  // 2) acmecorp.payroll@demo: Disburses salaries to 18 normal accounts on Day 1 & Day 15
  //    (high fan-out & burst velocity, 0 complaints)
  const payroll = falsePositiveControls[1];
  for (const payDay of [1, 15]) {
    makeTx(normalControls[0], payroll, 950000, dayOffsetIso(payDay, 8, 30), 'SUCCESS', 'UPI_P2P');
    for (let emp = 4; emp < 22; emp++) {
      makeTx(
        payroll,
        normalControls[emp],
        randInt(38000, 62000),
        dayOffsetIso(payDay, 10, emp),
        'SUCCESS',
        'UPI_P2P',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Normal Everyday Legitimate P2P Control Transactions (~950 transactions)
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 920; i++) {
    const day = randInt(0, 17);
    const sIdx = randInt(0, normalControls.length - 1);
    let rIdx = randInt(0, normalControls.length - 1);
    if (rIdx === sIdx) rIdx = (rIdx + 1) % normalControls.length;

    const roll = rng();
    const status: TransactionStatus =
      roll < 0.91 ? 'SUCCESS' : roll < 0.96 ? 'FAILED' : roll < 0.985 ? 'REVERSED' : 'PENDING';

    makeTx(
      normalControls[sIdx],
      normalControls[rIdx],
      randInt(150, 14500),
      dayOffsetIso(day, randInt(7, 22), randInt(0, 59)),
      status,
    );
  }

  // Sort transactions chronologically for clean ledger ordering
  transactions.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // ---------------------------------------------------------------------------
  // Pre-loaded Precision Lien & RBI 60-Day Money Mule SOP Demo States
  // ---------------------------------------------------------------------------
  const findFirstInbound = (acct: string) =>
    transactions.find((t) => t.receiver_upi === acct && t.status === 'SUCCESS');
  const findComplaintForReceiver = (acct: string) =>
    complaints.find((c) => c.receiver_upi === acct)?.complaint_id ??
    complaints[0]?.complaint_id ??
    'CMP-2026-0001';

  const vaultInbound = findFirstInbound('exit.vault01@demo');
  const raviInbound = findFirstInbound('ravi.k.pay@demo');
  const sanjayInbound = findFirstInbound('sanjay.m.collect@demo');

  const vaultNoticeAt = '2026-10-29T09:15:00.000Z';
  const raviNoticeAt = '2026-10-28T11:30:00.000Z';
  const sanjayNoticeAt = '2026-11-15T14:20:00.000Z';

  const initialAccountStates: Record<string, AccountLienState> = {
    'exit.vault01@demo': {
      totalBalance: 255000,
      precisionLienHold: 15000,
      usableCleanBalance: 240000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: complaints[0]?.complaint_id ?? 'CMP-2026-0001',
        taintedReceived: 15000,
        heldAmount: 15000,
        freeAmount: 240000,
        appliedAt: vaultNoticeAt,
        reason:
          'Deterministic multi-hop FIFO attribution earmarked ₹15,000 disputed inbound funds while preserving ₹2,40,000 legitimate commercial balance.',
        cbsReferenceId: 'CBS-LIEN-2026-9041',
      },
      rbiSopClock: {
        stage: 'Days 21-30: Nodal Review',
        dayCount: 22,
        noticeSentAt: vaultNoticeAt,
        customerResponseDeadline: addDays(vaultNoticeAt, 20),
        nodalReviewDeadline: addDays(vaultNoticeAt, 30),
        autoExpiryDeadline: addDays(vaultNoticeAt, 60),
        disputeSubmission: {
          submittedAt: '2026-11-16T10:42:00.000Z',
          invoiceNumber: 'INV-GST/26-27/4109',
          gstin: '27AABCV9281K1Z5',
          counterpartyName: 'Vardhman Precision Electronics Pvt Ltd',
          documentType: 'GST Tax Invoice',
          claimedAmount: 15000,
          referencedUtr: vaultInbound?.utr ?? 'UTR631890000105',
          aiVerificationScore: 91,
          aiRecommendation: 'RELEASE_LIEN',
          aiReasoning:
            'Valid 15-character Maharashtra GSTIN (27AABCV9281K1Z5), exact ₹15,000 parity with earmarked lien hold, and verified UTR match against settled UPI ledger record. Consistent with B2B merchant settlement; recommended for Nodal Officer lien release.',
        },
      },
    },
    'ravi.k.pay@demo': {
      totalBalance: 165000,
      precisionLienHold: 28500,
      usableCleanBalance: 136500,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: findComplaintForReceiver('ravi.k.pay@demo'),
        taintedReceived: 28500,
        heldAmount: 28500,
        freeAmount: 136500,
        appliedAt: raviNoticeAt,
        reason:
          'Deterministic FIFO attribution earmarked ₹28,500 initial fraud receipt while protecting ₹1,36,500 unrelated balance pending RBI 60-day SOP review.',
        cbsReferenceId: 'CBS-LIEN-2026-9017',
      },
      rbiSopClock: {
        stage: 'Days 21-30: Nodal Review',
        dayCount: 23,
        noticeSentAt: raviNoticeAt,
        customerResponseDeadline: addDays(raviNoticeAt, 20),
        nodalReviewDeadline: addDays(raviNoticeAt, 30),
        autoExpiryDeadline: addDays(raviNoticeAt, 60),
        disputeSubmission: {
          submittedAt: '2026-11-17T16:05:00.000Z',
          invoiceNumber: 'CASH-MEMO-009',
          gstin: '27INVALID0000Z1',
          counterpartyName: 'QuickCash Trade Desk',
          documentType: 'Delivery Challan',
          claimedAmount: 42000,
          referencedUtr: raviInbound ? 'UTR000000000999' : 'UTR000000000999',
          aiVerificationScore: 19,
          aiRecommendation: 'ESCALATE_TO_LEA',
          aiReasoning:
            'Submitted GSTIN fails statutory 15-character PAN-embedded format check, referenced UTR does not appear in settled inbound ledger, and claimed ₹42,000 diverges from held ₹28,500 amid high rapid pass-through velocity. Recommend maintaining freeze and escalating dossier to LEA.',
        },
      },
    },
    'sanjay.m.collect@demo': {
      totalBalance: 188000,
      precisionLienHold: 32000,
      usableCleanBalance: 156000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: findComplaintForReceiver('sanjay.m.collect@demo'),
        taintedReceived: 32000,
        heldAmount: 32000,
        freeAmount: 156000,
        appliedAt: sanjayNoticeAt,
        reason:
          'Deterministic FIFO precision lien applied on ₹32,000 disputed inflow (UTR ' +
          (sanjayInbound?.utr ?? 'N/A') +
          '); customer notice dispatched under RBI 24-hour mandate.',
        cbsReferenceId: 'CBS-LIEN-2026-9088',
      },
      rbiSopClock: {
        stage: 'Days 1-20: Customer Dispute Window',
        dayCount: 5,
        noticeSentAt: sanjayNoticeAt,
        customerResponseDeadline: addDays(sanjayNoticeAt, 20),
        nodalReviewDeadline: addDays(sanjayNoticeAt, 30),
        autoExpiryDeadline: addDays(sanjayNoticeAt, 60),
      },
    },
    'hub.alpha01@demo': {
      totalBalance: 345000,
      precisionLienHold: 0,
      usableCleanBalance: 345000,
      accountStatus: 'Under Investigation',
    },
    'amit.t.upi@demo': {
      totalBalance: 210000,
      precisionLienHold: 0,
      usableCleanBalance: 210000,
      accountStatus: 'Under Investigation',
    },
    'freshmart.bazaar@demo': {
      totalBalance: 485000,
      precisionLienHold: 0,
      usableCleanBalance: 485000,
      accountStatus: 'Active',
    },
    'rohan.sharma19@okhdfcbank': {
      totalBalance: 195000,
      precisionLienHold: 180000,
      usableCleanBalance: 15000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: studentCmp.complaint_id,
        taintedReceived: 180000,
        heldAmount: 180000,
        freeAmount: 15000,
        appliedAt: '2026-11-18T11:30:00.000Z',
        reason:
          'RULE_STUDENT_TIER_OVERFLOW triggered: ₹1,80,000 inflow disproportionate to declared Student KYC (Age 19). Temporary debit hold placed on suspected ₹1,80,000 while preserving ₹15,000 clean student allowance.',
        cbsReferenceId: 'CBS-HOLD-2026-77101',
      },
      rbiSopClock: {
        stage: 'Day 0: Notice Sent',
        dayCount: 0,
        noticeSentAt: '2026-11-18T11:35:00.000Z',
        customerResponseDeadline: addDays('2026-11-18T11:35:00.000Z', 20),
        nodalReviewDeadline: addDays('2026-11-18T11:35:00.000Z', 30),
        autoExpiryDeadline: addDays('2026-11-18T11:35:00.000Z', 60),
      },
      ...computeRbiSopStatutorySchedule(
        '2026-11-18T11:30:00.000Z',
        180000,
        'CBS-HOLD-2026-77101',
        false,
        0,
        2,
      ),
    },
    'vikram.traders06@okicici': {
      totalBalance: 385000,
      precisionLienHold: 80000,
      usableCleanBalance: 305000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: vikramCmp.complaint_id,
        taintedReceived: 80000,
        heldAmount: 80000,
        freeAmount: 305000,
        appliedAt: '2026-11-12T12:15:00.000Z',
        reason:
          'RULE_6M_HISTORICAL_VOL_SPIKE triggered: 24h inflow ₹3,50,000 (5 txs) represents 29.2× surge over ₹12,000/mo 6-month baseline. Precision lien earmarked ₹80,000 NCRP-linked credit.',
        cbsReferenceId: 'CBS-HOLD-2026-77204',
      },
      rbiSopClock: {
        stage: 'Days 1-20: Customer Dispute Window',
        dayCount: 7,
        noticeSentAt: '2026-11-12T12:20:00.000Z',
        customerResponseDeadline: addDays('2026-11-12T12:20:00.000Z', 20),
        nodalReviewDeadline: addDays('2026-11-12T12:20:00.000Z', 30),
        autoExpiryDeadline: addDays('2026-11-12T12:20:00.000Z', 60),
      },
      ...computeRbiSopStatutorySchedule(
        '2026-11-12T12:15:00.000Z',
        80000,
        'CBS-HOLD-2026-77204',
        false,
        7,
        3,
      ),
    },
    'ncrp.relay01@okaxis': {
      totalBalance: 142000,
      precisionLienHold: 85000,
      usableCleanBalance: 57000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: branchCmp.complaint_id,
        taintedReceived: 85000,
        heldAmount: 85000,
        freeAmount: 57000,
        appliedAt: '2026-10-26T15:00:00.000Z',
        reason:
          'RULE_BRANCHING_MULTI_HOP_DAG triggered: ₹85,000 NCRP inflow branched to 4 downstream accounts within 26 minutes and continued to Hop 3.',
        cbsReferenceId: 'CBS-HOLD-2026-77309',
      },
      rbiSopClock: {
        stage: 'Days 21-30: Nodal Review',
        dayCount: 24,
        noticeSentAt: '2026-10-26T15:10:00.000Z',
        customerResponseDeadline: addDays('2026-10-26T15:10:00.000Z', 20),
        nodalReviewDeadline: addDays('2026-10-26T15:10:00.000Z', 30),
        autoExpiryDeadline: addDays('2026-10-26T15:10:00.000Z', 60),
      },
      ...computeRbiSopStatutorySchedule(
        '2026-10-26T15:00:00.000Z',
        85000,
        'CBS-HOLD-2026-77309',
        false,
        24,
        4,
      ),
    },
    'patanjalii@okaxis': {
      totalBalance: 138000,
      precisionLienHold: 22000,
      usableCleanBalance: 116000,
      accountStatus: 'Precision Lien Active',
      lienDetails: {
        complaintId: lookalikeCmp.complaint_id,
        taintedReceived: 22000,
        heldAmount: 22000,
        freeAmount: 116000,
        appliedAt: '2026-10-12T10:00:00.000Z',
        reason:
          'RULE_SUSPICIOUS_LOOKALIKE_VPA triggered: Newly registered VPA "patanjalii" spoofs protected brand "patanjali" (edit distance 1) across 6 first-time payers. Escalated via NCRP-CFCFRMS awaiting LEA statutory order.',
        cbsReferenceId: 'CBS-HOLD-2026-77412',
      },
      rbiSopClock: {
        stage: 'Days 31-60: LEA Escalation',
        dayCount: 38,
        noticeSentAt: '2026-10-12T10:05:00.000Z',
        customerResponseDeadline: addDays('2026-10-12T10:05:00.000Z', 20),
        nodalReviewDeadline: addDays('2026-10-12T10:05:00.000Z', 30),
        autoExpiryDeadline: addDays('2026-10-12T10:05:00.000Z', 60),
      },
      ...computeRbiSopStatutorySchedule(
        '2026-10-12T10:00:00.000Z',
        22000,
        'CBS-HOLD-2026-77412',
        false,
        38,
        5,
      ),
    },
  };

  // ---------------------------------------------------------------------------
  // Account KYC & 6-Month Historical Baseline Profiles
  // ---------------------------------------------------------------------------
  const accountKycProfiles: Record<string, AccountKycProfile> = {
    'rohan.sharma19@okhdfcbank': {
      accountHolderName: 'Rohan Sharma',
      age: 19,
      occupation: 'Student',
      accountAgeMonths: 8,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 2800 },
        { month: 'Jun 2026', volume: 3500 },
        { month: 'Jul 2026', volume: 3100 },
        { month: 'Aug 2026', volume: 3600 },
        { month: 'Sep 2026', volume: 2900 },
        { month: 'Oct 2026', volume: 3300 },
      ],
    },
    'vikram.traders06@okicici': {
      accountHolderName: 'Vikram Mehta',
      age: 41,
      occupation: 'Self-Employed',
      accountAgeMonths: 28,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 11200 },
        { month: 'Jun 2026', volume: 12800 },
        { month: 'Jul 2026', volume: 11500 },
        { month: 'Aug 2026', volume: 12400 },
        { month: 'Sep 2026', volume: 11900 },
        { month: 'Oct 2026', volume: 12200 },
      ],
    },
    'ncrp.relay01@okaxis': {
      accountHolderName: 'Suresh K. (Relay Account)',
      age: 27,
      occupation: 'Self-Employed',
      accountAgeMonths: 14,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 14000 },
        { month: 'Jun 2026', volume: 16500 },
        { month: 'Jul 2026', volume: 15200 },
        { month: 'Aug 2026', volume: 18000 },
        { month: 'Sep 2026', volume: 15800 },
        { month: 'Oct 2026', volume: 17100 },
      ],
    },
    'patanjalii@okaxis': {
      accountHolderName: 'Patanjalii Wellness Direct (Unverified)',
      age: 29,
      occupation: 'Merchant',
      accountAgeMonths: 1,
      isNewlyRegisteredVpa: true,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 0 },
        { month: 'Jun 2026', volume: 0 },
        { month: 'Jul 2026', volume: 0 },
        { month: 'Aug 2026', volume: 0 },
        { month: 'Sep 2026', volume: 0 },
        { month: 'Oct 2026', volume: 1200 },
      ],
    },
    'freshmart.bazaar@demo': {
      accountHolderName: 'FreshMart Retail Bazaar LLP',
      age: 38,
      occupation: 'Merchant',
      accountAgeMonths: 36,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 220000 },
        { month: 'Jun 2026', volume: 235000 },
        { month: 'Jul 2026', volume: 215000 },
        { month: 'Aug 2026', volume: 242000 },
        { month: 'Sep 2026', volume: 228000 },
        { month: 'Oct 2026', volume: 251000 },
      ],
    },
    'acmecorp.payroll@demo': {
      accountHolderName: 'AcmeCorp India Payroll Desk',
      age: 45,
      occupation: 'Merchant',
      accountAgeMonths: 48,
      monthlyHistoricalTurnover: [
        { month: 'May 2026', volume: 1820000 },
        { month: 'Jun 2026', volume: 1850000 },
        { month: 'Jul 2026', volume: 1880000 },
        { month: 'Aug 2026', volume: 1840000 },
        { month: 'Sep 2026', volume: 1910000 },
        { month: 'Oct 2026', volume: 1890000 },
      ],
    },
  };

  return {
    complaints,
    transactions,
    groundTruth,
    initialAccountStates,
    accountKycProfiles,
  };
}

