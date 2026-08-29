# Ledger Integrity & Double-Entry Invariant Guarantees

## 1. Core Architectural Invariant
In the Bharatiya Bazaar platform, every wallet balance is an exact, mathematically derived projection of its ledger entries:

$$\text{wallet.balancePaise} = \sum \text{Credits} - \sum \text{Debits}$$

Divergence between `wallet.balancePaise` and the cumulative sum of `LedgerEntry` records is rendered impossible via 4 defense-in-depth layers.

---

## 2. The 4 Layers of Defense

### Layer 1: PostgreSQL Trigger Constraint (Database Core)
1. **`wallet_ledger_guard`** (`CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE ON "wallets" DEFERRABLE INITIALLY DEFERRED`):
   - Evaluated at transaction `COMMIT` time.
   - If `NEW."balancePaise"` is modified (or inserted with non-zero balance), verifies that at least one `ledger_entries` record exists for `walletId = NEW.id` created within the exact same database transaction (`xmin::text = (pg_current_xact_id())::text`).
   - If no matching ledger record exists, PostgreSQL aborts and rolls back the transaction with:
     ```sql
     RAISE EXCEPTION 'LEDGER_INTEGRITY_VIOLATION: wallet % changed without ledger entry', NEW.id;
     ```
2. **`ledger_immutability_guard`** (`TRIGGER ... BEFORE UPDATE OR DELETE ON "ledger_entries"`):
   - Completely prohibits any `UPDATE` or `DELETE` statement against `ledger_entries`.
   - Any modification or deletion attempt immediately throws:
     ```sql
     RAISE EXCEPTION 'LEDGER_IMMUTABLE: entries can never be altered or deleted';
     ```

### Layer 2: Application Chokepoints
- All balance modifications in backend code flow strictly through `src/services/walletService.js`:
  - `walletService.credit(tx, memberId, amount, source, referenceId, description)`
  - `walletService.debit(tx, memberId, amount, source, referenceId, description)`
  - `walletService.adjustBalance(tx, memberId, delta, reason, referenceId)`
- Any direct mutation of `balancePaise` outside of `walletService` is rejected at the database level.

### Layer 3: Continuous Automated Reconciliation
- **API Endpoint:** `GET /api/admin/reports/reconciliation` (restricted strictly to `SUPER_ADMIN`).
- **Cron Script:** `scripts/reconcile.js` executes periodically and emits an `AuditLog` alert if any wallet exhibits $\Delta \ne 0$.

### Layer 4: Operational Hardening & Emergency Procedures
- **Production Least Privilege:** The application database user must not be granted PostgreSQL superuser status (`NOSUPERUSER`), preventing accidental trigger overrides.
- **Emergency Maintenance Procedure:**
  In the event of an authorized database migration or emergency repair, triggers can only be disabled by a privileged DBA:
  ```sql
  -- Emergency trigger disablement (must be logged in change-management)
  ALTER TABLE "wallets" DISABLE TRIGGER wallet_ledger_guard;
  ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_immutability_guard;

  -- Perform maintenance operations...

  -- Re-enable triggers immediately
  ALTER TABLE "wallets" ENABLE TRIGGER wallet_ledger_guard;
  ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_immutability_guard;
  ```
