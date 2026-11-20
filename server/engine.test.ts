import assert from 'node:assert/strict';
import test from 'node:test';
import type { FraudComplaint, TransactionRecord } from '../src/shared/types.ts';
import {
  DEFAULT_RISK_CONFIG,
  analyzeDataset,
  calculatePrecisionLien,
  computeRbiSopStatutorySchedule,
  evaluateDeterministicDetectionRules,
  evaluateLookalikeVpa,
  levenshteinDistance,
  matchComplaintsToLedger,
  traceComplaintFunds,
  validateUpiSyntax,
} from './analyticsEngine.ts';
import { generateSyntheticDemoDataset } from './syntheticData.ts';

test('1. Transaction matching accurately classifies MATCHED_SUCCESS, MATCHED_NON_SUCCESS, and UNMATCHED', () => {
  const txs: TransactionRecord[] = [
    {
      transaction_id: 'TX-1',
      timestamp: '2026-11-10T10:00:00.000Z',
      sender_upi: 'v1@demo',
      receiver_upi: 'm1@demo',
      amount: 50000,
      status: 'SUCCESS',
      utr: 'UTR1',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'TX-2',
      timestamp: '2026-11-10T11:00:00.000Z',
      sender_upi: 'v2@demo',
      receiver_upi: 'm2@demo',
      amount: 20000,
      status: 'REVERSED',
      utr: 'UTR2',
      channel: 'UPI_P2P',
    },
  ];

  const complaints: FraudComplaint[] = [
    {
      complaint_id: 'C-1',
      victim_reference: 'V1',
      reported_transaction_id: 'TX-1',
      utr: 'UTR1',
      transaction_timestamp: '2026-11-10T10:00:00.000Z',
      amount: 50000,
      sender_upi: 'v1@demo',
      receiver_upi: 'm1@demo',
      complaint_date: '2026-11-11',
    },
    {
      complaint_id: 'C-2',
      victim_reference: 'V2',
      reported_transaction_id: 'TX-2',
      utr: 'UTR2',
      transaction_timestamp: '2026-11-10T11:00:00.000Z',
      amount: 20000,
      sender_upi: 'v2@demo',
      receiver_upi: 'm2@demo',
      complaint_date: '2026-11-11',
    },
    {
      complaint_id: 'C-3',
      victim_reference: 'V3',
      reported_transaction_id: 'TX-MISSING',
      utr: 'UTR-MISSING',
      transaction_timestamp: '2026-11-10T12:00:00.000Z',
      amount: 15000,
      sender_upi: 'v3@demo',
      receiver_upi: 'm3@demo',
      complaint_date: '2026-11-11',
    },
  ];

  const matched = matchComplaintsToLedger(complaints, txs);
  assert.equal(matched[0].match_status, 'MATCHED_SUCCESS');
  assert.equal(matched[1].match_status, 'MATCHED_NON_SUCCESS');
  assert.equal(matched[2].match_status, 'UNMATCHED');
});

test('2. Successful vs Failed/Reversed/Pending transactions are strictly separated during tracing', () => {
  const txs: TransactionRecord[] = [
    {
      transaction_id: 'T1',
      timestamp: '2026-11-10T10:00:00.000Z',
      sender_upi: 'victim@demo',
      receiver_upi: 'mule1@demo',
      amount: 40000,
      status: 'SUCCESS',
      utr: 'U1',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T2',
      timestamp: '2026-11-10T10:05:00.000Z',
      sender_upi: 'mule1@demo',
      receiver_upi: 'failedtarget@demo',
      amount: 40000,
      status: 'FAILED',
      utr: 'U2',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T3',
      timestamp: '2026-11-10T10:08:00.000Z',
      sender_upi: 'failedtarget@demo',
      receiver_upi: 'neverreached@demo',
      amount: 39000,
      status: 'SUCCESS',
      utr: 'U3',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T4',
      timestamp: '2026-11-10T10:12:00.000Z',
      sender_upi: 'mule1@demo',
      receiver_upi: 'realnext@demo',
      amount: 35000,
      status: 'SUCCESS',
      utr: 'U4',
      channel: 'UPI_P2P',
    },
  ];

  const [cmp] = matchComplaintsToLedger(
    [
      {
        complaint_id: 'C1',
        victim_reference: 'V1',
        reported_transaction_id: 'T1',
        utr: 'U1',
        transaction_timestamp: '2026-11-10T10:00:00.000Z',
        amount: 40000,
        sender_upi: 'victim@demo',
        receiver_upi: 'mule1@demo',
        complaint_date: '2026-11-10',
      },
    ],
    txs,
  );

  const trace = traceComplaintFunds('test', cmp, txs, {
    complaintId: 'C1',
    maxHops: 4,
    windowHours: 24,
    minAmount: 0,
    statuses: ['SUCCESS', 'FAILED'],
  });

  const failedEdge = trace.edges.find((e) => e.transaction_id === 'T2');
  assert.ok(failedEdge);
  assert.equal(failedEdge.potentially_attributed_amount, 0);
  assert.equal(failedEdge.attribution_status, 'NON_SETTLED_EXCLUDED');
  assert.equal(trace.edges.some((e) => e.transaction_id === 'T3'), false);
  assert.equal(trace.edges.some((e) => e.transaction_id === 'T4'), true);
  assert.equal(trace.total_potentially_attributed, 35000);
});

test('3. Multi-hop tracing follows forward timestamps only and respects hop limits', () => {
  const txs: TransactionRecord[] = [
    {
      transaction_id: 'T-BEFORE',
      timestamp: '2026-11-10T09:30:00.000Z',
      sender_upi: 'a@demo',
      receiver_upi: 'earlier@demo',
      amount: 10000,
      status: 'SUCCESS',
      utr: 'U0',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T1',
      timestamp: '2026-11-10T10:00:00.000Z',
      sender_upi: 'v@demo',
      receiver_upi: 'a@demo',
      amount: 50000,
      status: 'SUCCESS',
      utr: 'U1',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T2',
      timestamp: '2026-11-10T10:15:00.000Z',
      sender_upi: 'a@demo',
      receiver_upi: 'b@demo',
      amount: 48000,
      status: 'SUCCESS',
      utr: 'U2',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T3',
      timestamp: '2026-11-10T10:30:00.000Z',
      sender_upi: 'b@demo',
      receiver_upi: 'c@demo',
      amount: 45000,
      status: 'SUCCESS',
      utr: 'U3',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'T4',
      timestamp: '2026-11-10T10:45:00.000Z',
      sender_upi: 'c@demo',
      receiver_upi: 'd@demo',
      amount: 40000,
      status: 'SUCCESS',
      utr: 'U4',
      channel: 'UPI_P2P',
    },
  ];

  const [cmp] = matchComplaintsToLedger(
    [
      {
        complaint_id: 'C1',
        victim_reference: 'V1',
        reported_transaction_id: 'T1',
        utr: 'U1',
        transaction_timestamp: '2026-11-10T10:00:00.000Z',
        amount: 50000,
        sender_upi: 'v@demo',
        receiver_upi: 'a@demo',
        complaint_date: '2026-11-10',
      },
    ],
    txs,
  );

  const trace2 = traceComplaintFunds('test', cmp, txs, {
    complaintId: 'C1',
    maxHops: 2,
    windowHours: 24,
    minAmount: 0,
    statuses: ['SUCCESS'],
  });
  assert.equal(trace2.edges.some((e) => e.transaction_id === 'T-BEFORE'), false);
  assert.equal(trace2.edges.length, 2); // Hop 1 (T1) and Hop 2 (T2)

  const trace4 = traceComplaintFunds('test', cmp, txs, {
    complaintId: 'C1',
    maxHops: 4,
    windowHours: 24,
    minAmount: 0,
    statuses: ['SUCCESS'],
  });
  assert.equal(trace4.edges.length, 4);
  assert.ok(trace4.patterns.some((p) => p.code === 'MULTI_HOP'));
});

test('4. Mixed-fund FIFO attribution accurately consumes earlier unrelated funds first and flags estimation', () => {
  const txs: TransactionRecord[] = [
    // Unrelated credit arrives BEFORE victim funds
    {
      transaction_id: 'T-UNREL',
      timestamp: '2026-11-10T09:50:00.000Z',
      sender_upi: 'friend@demo',
      receiver_upi: 'hub@demo',
      amount: 30000,
      status: 'SUCCESS',
      utr: 'UU',
      channel: 'UPI_P2P',
    },
    // Victim transfers ₹50,000 at 10:00
    {
      transaction_id: 'T-VICTIM',
      timestamp: '2026-11-10T10:00:00.000Z',
      sender_upi: 'victim@demo',
      receiver_upi: 'hub@demo',
      amount: 50000,
      status: 'SUCCESS',
      utr: 'UV',
      channel: 'UPI_P2P',
    },
    // Hub sends ₹40,000 onward at 10:10 -> Under FIFO, ₹30,000 is from unrelated lot and ₹10,000 potentially attributed!
    {
      transaction_id: 'T-OUT',
      timestamp: '2026-11-10T10:10:00.000Z',
      sender_upi: 'hub@demo',
      receiver_upi: 'exit@demo',
      amount: 40000,
      status: 'SUCCESS',
      utr: 'UO',
      channel: 'UPI_P2P',
    },
  ];

  const [cmp] = matchComplaintsToLedger(
    [
      {
        complaint_id: 'C-MIX',
        victim_reference: 'V1',
        reported_transaction_id: 'T-VICTIM',
        utr: 'UV',
        transaction_timestamp: '2026-11-10T10:00:00.000Z',
        amount: 50000,
        sender_upi: 'victim@demo',
        receiver_upi: 'hub@demo',
        complaint_date: '2026-11-10',
      },
    ],
    txs,
  );

  const trace = traceComplaintFunds('test', cmp, txs, {
    complaintId: 'C-MIX',
    maxHops: 3,
    windowHours: 24,
    minAmount: 0,
    statuses: ['SUCCESS'],
  });

  const outEdge = trace.edges.find((e) => e.transaction_id === 'T-OUT');
  assert.ok(outEdge);
  assert.equal(outEdge.potentially_attributed_amount, 10000);
  assert.equal(outEdge.attribution_status, 'ESTIMATED_MIXED_FUNDS');
  assert.equal(trace.mixed_funds_detected, true);
  assert.equal(trace.untraced_amount, 40000);
});

test('5. Cross-complaint correlation connects complaints sharing recipients and downstream accounts', () => {
  const txs: TransactionRecord[] = [
    { transaction_id: 'T1', timestamp: '2026-11-10T10:00:00.000Z', sender_upi: 'va@demo', receiver_upi: 'upib@demo', amount: 30000, status: 'SUCCESS', utr: 'U1', channel: 'UPI_P2P' },
    { transaction_id: 'T2', timestamp: '2026-11-10T10:10:00.000Z', sender_upi: 'upib@demo', receiver_upi: 'upid@demo', amount: 28000, status: 'SUCCESS', utr: 'U2', channel: 'UPI_P2P' },
    { transaction_id: 'T3', timestamp: '2026-11-10T11:00:00.000Z', sender_upi: 'vb@demo', receiver_upi: 'upib@demo', amount: 32000, status: 'SUCCESS', utr: 'U3', channel: 'UPI_P2P' },
    { transaction_id: 'T4', timestamp: '2026-11-10T11:10:00.000Z', sender_upi: 'upib@demo', receiver_upi: 'upie@demo', amount: 30000, status: 'SUCCESS', utr: 'U4', channel: 'UPI_P2P' },
    { transaction_id: 'T5', timestamp: '2026-11-10T12:00:00.000Z', sender_upi: 'vc@demo', receiver_upi: 'upic@demo', amount: 25000, status: 'SUCCESS', utr: 'U5', channel: 'UPI_P2P' },
    { transaction_id: 'T6', timestamp: '2026-11-10T12:10:00.000Z', sender_upi: 'upic@demo', receiver_upi: 'upid@demo', amount: 24000, status: 'SUCCESS', utr: 'U6', channel: 'UPI_P2P' },
  ];

  const complaints: FraudComplaint[] = [
    { complaint_id: 'CA', victim_reference: 'VA', reported_transaction_id: 'T1', utr: 'U1', transaction_timestamp: txs[0].timestamp, amount: 30000, sender_upi: 'va@demo', receiver_upi: 'upib@demo', complaint_date: '2026-11-10' },
    { complaint_id: 'CB', victim_reference: 'VB', reported_transaction_id: 'T3', utr: 'U3', transaction_timestamp: txs[2].timestamp, amount: 32000, sender_upi: 'vb@demo', receiver_upi: 'upib@demo', complaint_date: '2026-11-10' },
    { complaint_id: 'CC', victim_reference: 'VC', reported_transaction_id: 'T5', utr: 'U5', transaction_timestamp: txs[4].timestamp, amount: 25000, sender_upi: 'vc@demo', receiver_upi: 'upic@demo', complaint_date: '2026-11-10' },
  ];

  const analysis = analyzeDataset('test-corr', complaints, txs, DEFAULT_RISK_CONFIG);
  assert.equal(analysis.clusters.length, 1);
  const cluster = analysis.clusters[0];
  assert.deepEqual(cluster.complaint_ids, ['CA', 'CB', 'CC']);
  assert.ok(cluster.shared_recipient_accounts.includes('upib@demo'));
  assert.ok(cluster.shared_recipient_accounts.includes('upid@demo'));
});

test('6. Circular transaction pattern, fan-in/fan-out, false positives, and risk scoring on 50-complaint demo dataset', () => {
  const demo = generateSyntheticDemoDataset();
  assert.equal(demo.complaints.length, 50);
  assert.ok(demo.transactions.length >= 1000 && demo.transactions.length <= 2000);

  const analysis = analyzeDataset('demo', demo.complaints, demo.transactions, DEFAULT_RISK_CONFIG);

  // Should discover all 3 planted interconnected clusters without using groundTruth
  assert.ok(analysis.clusters.length >= 3);

  // At least one cluster must exhibit a detected circular transaction loop
  assert.ok(analysis.clusters.some((c) => c.has_circular_pattern));

  // Shared mule accounts with cross-complaint recurrence + rapid pass-through should score HIGH
  const hubAlpha = analysis.accounts.get('hub.alpha01@demo');
  assert.ok(hubAlpha);
  assert.equal(hubAlpha.risk_category, 'HIGH');
  assert.ok(hubAlpha.connected_complaints.length >= 5);
  assert.ok(hubAlpha.unique_senders >= 2);
  assert.ok(hubAlpha.unique_recipients >= 2);

  // False-positive legitimate commercial controls have 0 complaints and should NOT be scored HIGH
  const freshmart = analysis.accounts.get('freshmart.bazaar@demo');
  const payroll = analysis.accounts.get('acmecorp.payroll@demo');
  assert.ok(freshmart && payroll);
  assert.equal(freshmart.connected_complaints.length, 0);
  assert.equal(payroll.connected_complaints.length, 0);
  assert.notEqual(freshmart.risk_category, 'HIGH');
  assert.notEqual(payroll.risk_category, 'HIGH');

  // UPI syntax validator works independently of fraud risk
  assert.equal(validateUpiSyntax('ravi.k.pay@demo'), true);
  assert.equal(validateUpiSyntax('invalid-upi-without-at'), false);
});

test('7. Deterministic Precision Lien engine computes exact min(tainted, balance, deficit) and protects clean balance', () => {
  const txs: TransactionRecord[] = [
    {
      transaction_id: 'PL-1',
      timestamp: '2026-11-10T10:00:00.000Z',
      sender_upi: 'victim@demo',
      receiver_upi: 'mule1@demo',
      amount: 50000,
      status: 'SUCCESS',
      utr: 'UTR-PL-1',
      channel: 'UPI_P2P',
    },
    {
      transaction_id: 'PL-2',
      timestamp: '2026-11-10T10:15:00.000Z',
      sender_upi: 'mule1@demo',
      receiver_upi: 'merchant@demo',
      amount: 18000,
      status: 'SUCCESS',
      utr: 'UTR-PL-2',
      channel: 'UPI_P2P',
    },
  ];
  const complaints: FraudComplaint[] = [
    {
      complaint_id: 'CMP-PL-1',
      victim_reference: 'V-PL-1',
      reported_transaction_id: 'PL-1',
      utr: 'UTR-PL-1',
      transaction_timestamp: txs[0].timestamp,
      amount: 50000,
      sender_upi: 'victim@demo',
      receiver_upi: 'mule1@demo',
      complaint_date: '2026-11-10',
    },
  ];

  // Case A: Merchant has ₹1,50,000 balance and received ₹18,000 tainted at Hop 2 -> ₹18,000 held, ₹1,32,000 clean usable!
  const calcA = calculatePrecisionLien('merchant@demo', 'CMP-PL-1', complaints, txs, 150000);
  assert.equal(calcA.taintedReceived, 18000);
  assert.equal(calcA.heldAmount, 18000);
  assert.equal(calcA.usableCleanBalance, 132000);
  assert.equal(calcA.hopDepth, 2);
  assert.ok(calcA.reasonCodes.includes('CLEAN_OPERATING_BALANCE_PROTECTED'));

  // Case B: Low balance cap (account only has ₹10,000 left) -> holds ₹10,000, usable ₹0
  const calcB = calculatePrecisionLien('merchant@demo', 'CMP-PL-1', complaints, txs, 10000);
  assert.equal(calcB.heldAmount, 10000);
  assert.equal(calcB.usableCleanBalance, 0);
  assert.ok(calcB.reasonCodes.includes('HOLD_CAPPED_AT_AVAILABLE_BALANCE'));

  // Case C: Victim deficit cap (₹40,000 already recovered elsewhere, remaining deficit ₹10,000) -> holds ₹10,000
  const calcC = calculatePrecisionLien('merchant@demo', 'CMP-PL-1', complaints, txs, 150000, 10000);
  assert.equal(calcC.heldAmount, 10000);
  assert.equal(calcC.usableCleanBalance, 140000);
  assert.ok(calcC.reasonCodes.includes('HOLD_CAPPED_AT_VICTIM_DEFICIT'));
});

test('8. Demo synthetic dataset initializes mixed-balance Precision Lien Active accounts with verified & unverified GST disputes', () => {
  const demo = generateSyntheticDemoDataset();
  const analysis = analyzeDataset(
    'demo',
    demo.complaints,
    demo.transactions,
    DEFAULT_RISK_CONFIG,
    demo.initialAccountStates,
  );

  const vault = analysis.accounts.get('exit.vault01@demo');
  assert.ok(vault);
  assert.equal(vault.accountStatus, 'Precision Lien Active');
  assert.equal(vault.totalBalance, 255000);
  assert.ok(vault.precisionLienHold > 0 && vault.precisionLienHold < vault.totalBalance);
  assert.equal(vault.usableCleanBalance, vault.totalBalance - vault.precisionLienHold);
  assert.equal(vault.rbiSopClock?.disputeSubmission?.aiRecommendation, 'RELEASE_LIEN');

  const ravi = analysis.accounts.get('ravi.k.pay@demo');
  assert.ok(ravi);
  assert.equal(ravi.accountStatus, 'Precision Lien Active');
  assert.equal(ravi.rbiSopClock?.disputeSubmission?.aiRecommendation, 'ESCALATE_TO_LEA');
});

test('9. Rule 1 (RULE_STUDENT_TIER_OVERFLOW): flags student accounts >= ₹1,00,000 and ignores below threshold', () => {
  const demo = generateSyntheticDemoDataset();
  const analysis = analyzeDataset(
    'demo',
    demo.complaints,
    demo.transactions,
    DEFAULT_RISK_CONFIG,
    demo.initialAccountStates,
    demo.accountKycProfiles,
  );

  const rohan = analysis.accounts.get('rohan.sharma19@okhdfcbank');
  assert.ok(rohan);
  assert.equal(rohan.occupation, 'Student');
  assert.equal(rohan.age, 19);
  const rule1 = rohan.triggeredRules.find((r) => r.code === 'RULE_STUDENT_TIER_OVERFLOW');
  assert.ok(rule1, 'Expected RULE_STUDENT_TIER_OVERFLOW on rohan.sharma19@okhdfcbank');
  assert.equal(rule1.severity, 'HIGH');
  assert.equal(rule1.points, 40);
  assert.equal(rohan.rbiSopStep, 2);

  // Negative check: Student account under ₹1,00,000 must NOT trigger
  const belowThreshold = evaluateDeterministicDetectionRules({
    upiId: 'student.clean@okhdfcbank',
    isVictim: false,
    kyc: { occupation: 'Student', age: 20, accountAgeMonths: 8 },
    maxSingleCredit: 45_000,
    peak24hCreditVolume: 85_000,
    peak24hCreditCount: 2,
    sixMonthAvgMonthlyVolume: 12_000,
    hasExplicitHistoricalBaseline: false,
    maxFanOut30m: 0,
    uniqueSenders: 2,
  });
  assert.equal(
    belowThreshold.some((r) => r.code === 'RULE_STUDENT_TIER_OVERFLOW'),
    false,
  );
});

test('10. Rule 2 (RULE_6M_HISTORICAL_VOL_SPIKE): flags active 3.5x velocity spikes and dormant > ₹50,000 spikes', () => {
  const demo = generateSyntheticDemoDataset();
  const analysis = analyzeDataset(
    'demo',
    demo.complaints,
    demo.transactions,
    DEFAULT_RISK_CONFIG,
    demo.initialAccountStates,
    demo.accountKycProfiles,
  );

  const vikram = analysis.accounts.get('vikram.traders06@okicici');
  assert.ok(vikram);
  const rule2 = vikram.triggeredRules.find((r) => r.code === 'RULE_6M_HISTORICAL_VOL_SPIKE');
  assert.ok(rule2, 'Expected RULE_6M_HISTORICAL_VOL_SPIKE on vikram.traders06@okicici');
  assert.equal(rule2.severity, 'CRITICAL');
  assert.equal(rule2.points, 45);
  assert.equal(vikram.rbiSopStep, 3);
  assert.ok((vikram.sixMonthAvgMonthlyVolume ?? 0) <= 15_000);
  assert.ok((vikram.current24hCreditVolume ?? 0) >= 300_000);

  // Dormant account (< ₹5,000/mo avg over 6m) spiking > ₹50,000 in 24h
  const dormantRules = evaluateDeterministicDetectionRules({
    upiId: 'dormant.acct@okaxis',
    isVictim: false,
    kyc: { occupation: 'Salaried', accountAgeMonths: 18 },
    maxSingleCredit: 55_000,
    peak24hCreditVolume: 65_000,
    peak24hCreditCount: 2,
    sixMonthAvgMonthlyVolume: 2_500,
    hasExplicitHistoricalBaseline: true,
    maxFanOut30m: 0,
    uniqueSenders: 2,
  });
  const dormantHit = dormantRules.find((r) => r.code === 'RULE_6M_HISTORICAL_VOL_SPIKE');
  assert.ok(dormantHit);
  assert.equal(dormantHit.severity, 'CRITICAL');
  assert.equal(dormantHit.points, 45);
});

test('11. Rule 3 (RULE_BRANCHING_MULTI_HOP_DAG): detects 30-min fan-out layering and 2nd/3rd-hop NCRP rapid relay', () => {
  const demo = generateSyntheticDemoDataset();
  const analysis = analyzeDataset(
    'demo',
    demo.complaints,
    demo.transactions,
    DEFAULT_RISK_CONFIG,
    demo.initialAccountStates,
    demo.accountKycProfiles,
  );

  const relay = analysis.accounts.get('ncrp.relay01@okaxis');
  assert.ok(relay);
  const relayRule = relay.triggeredRules.find((r) => r.code === 'RULE_BRANCHING_MULTI_HOP_DAG');
  assert.ok(relayRule, 'Expected RULE_BRANCHING_MULTI_HOP_DAG on ncrp.relay01@okaxis');
  assert.equal(relayRule.severity, 'CRITICAL');
  assert.equal(relayRule.points, 50);
  assert.equal(relay.rbiSopStep, 4);

  const hop2Mule = analysis.accounts.get('branch.mule01@demo');
  assert.ok(hop2Mule);
  assert.ok(
    hop2Mule.triggeredRules.some((r) => r.code === 'RULE_BRANCHING_MULTI_HOP_DAG'),
    'Expected Hop-2 branch mule to trigger RULE_BRANCHING_MULTI_HOP_DAG',
  );

  const hop3Exit = analysis.accounts.get('branch.exit01@demo');
  assert.ok(hop3Exit);
  assert.ok(
    hop3Exit.triggeredRules.some((r) => r.code === 'RULE_BRANCHING_MULTI_HOP_DAG'),
    'Expected Hop-3 exit node to trigger RULE_BRANCHING_MULTI_HOP_DAG',
  );
});

test('12. Rule 4 (RULE_SUSPICIOUS_LOOKALIKE_VPA) & RBI Money Mule SOP statutory 6-step deadlines', () => {
  assert.equal(levenshteinDistance('patanjalii', 'patanjali'), 1);
  assert.equal(levenshteinDistance('sbii.upi', 'sbi.upi'), 1);

  const spoofDouble = evaluateLookalikeVpa('patanjalii@okaxis', 6, true);
  assert.ok(spoofDouble);
  assert.equal(spoofDouble.code, 'RULE_SUSPICIOUS_LOOKALIKE_VPA');
  assert.equal(spoofDouble.severity, 'HIGH');
  assert.equal(spoofDouble.points, 40);

  const spoofHomoglyph = evaluateLookalikeVpa('patanjal1@okaxis', 3, true);
  assert.ok(spoofHomoglyph);
  assert.equal(spoofHomoglyph.code, 'RULE_SUSPICIOUS_LOOKALIKE_VPA');

  const spoofSbi = evaluateLookalikeVpa('sbii.upi@oksbi', 4, true);
  assert.ok(spoofSbi);

  // Exact legitimate brand handle must NOT trigger lookalike rule
  const legitimate = evaluateLookalikeVpa('patanjali@okaxis', 50, false);
  assert.equal(legitimate, null);

  // Verify demo account patanjalii@okaxis triggers Rule 4 and sits at RBI SOP Step 5
  const demo = generateSyntheticDemoDataset();
  const analysis = analyzeDataset(
    'demo',
    demo.complaints,
    demo.transactions,
    DEFAULT_RISK_CONFIG,
    demo.initialAccountStates,
    demo.accountKycProfiles,
  );
  const patanjalii = analysis.accounts.get('patanjalii@okaxis');
  assert.ok(patanjalii);
  assert.ok(patanjalii.triggeredRules.some((r) => r.code === 'RULE_SUSPICIOUS_LOOKALIKE_VPA'));
  assert.equal(patanjalii.rbiSopStep, 5);
  assert.ok(patanjalii.statutoryDeadlines);

  // Verify exact RBI SOP statutory deadlines (D+20, D+30, D+60, D+61)
  const schedule = computeRbiSopStatutorySchedule(
    '2027-04-01T00:00:00.000Z',
    45_000,
    'CBS-HOLD-2027-001',
    false,
    25,
  );
  assert.equal(schedule.rbiSopStep, 4);
  assert.equal(schedule.temporaryDebitHold.amount, 45_000);
  assert.equal(schedule.temporaryDebitHold.isAccountLevel, false);
  assert.equal(schedule.statutoryDeadlines.customerExplanationDue, '2027-04-21T00:00:00.000Z');
  assert.equal(schedule.statutoryDeadlines.bankReviewDue, '2027-05-01T00:00:00.000Z');
  assert.equal(schedule.statutoryDeadlines.leaResponseDue, '2027-05-31T00:00:00.000Z');
  assert.equal(schedule.statutoryDeadlines.maxHoldExpiry, '2027-06-01T00:00:00.000Z');
});

