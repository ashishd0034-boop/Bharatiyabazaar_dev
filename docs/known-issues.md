# Known Issues & Historical Incident Log

## Incident 2026-08-28: Dev Database Balance Mutation Divergence (BB10001)

### Summary
On 2026-08-28, member `BB10001` in the development database was found to have generated 3 activation PINs (total ₹1,800) against lifetime earnings of ₹800.

### Root Cause Analysis
During active developer feature prototyping on the development database, an out-of-band test script directly modified `wallet.balancePaise` from ₹200 to ₹1,200 (+₹1,000 / 100,000 paise) without generating a corresponding `CREDIT` ledger entry in `ledger_entries`. The application's PIN purchasing transaction subsequently decremented the wallet balance against this un-audited state.

### Resolution & Permanent Prevention
1. **Clean Rebuild:** The development database was wiped cleanly via `prisma db push --force-reset` on 2026-08-29.
2. **PostgreSQL Triggers:** Implemented `wallet_ledger_guard` constraint trigger requiring matching ledger entries at commit time, making direct table mutations fail with `LEDGER_INTEGRITY_VIOLATION`.
3. **Ledger Immutability:** Implemented `ledger_immutability_guard` prohibiting any `UPDATE` or `DELETE` on `ledger_entries`.
4. **Reconciliation Monitoring:** Deployed `GET /api/admin/reports/reconciliation` and `scripts/reconcile.js` hourly cron.
