-- ============================================================================
-- PERMANENT LEDGER INTEGRITY ENFORCEMENT & IMMUTABILITY TRIGGERS
-- ============================================================================

-- 1. Wallet Guard: Constraint Trigger checked at COMMIT (DEFERRED)
CREATE OR REPLACE FUNCTION enforce_wallet_ledger_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_ledger_count INT;
BEGIN
  -- On UPDATE: only enforce if balancePaise actually changed
  IF TG_OP = 'UPDATE' THEN
    IF NEW."balancePaise" IS NOT DISTINCT FROM OLD."balancePaise" THEN
      RETURN NEW;
    END IF;
  END IF;

  -- On INSERT: only enforce if initial balance is non-zero
  IF TG_OP = 'INSERT' THEN
    IF NEW."balancePaise" = 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Verify at least 1 ledger entry exists for this wallet created in the current transaction
  SELECT COUNT(*)
  INTO v_ledger_count
  FROM "ledger_entries"
  WHERE "walletId" = NEW.id
    AND xmin::text = (pg_current_xact_id())::text;

  IF v_ledger_count = 0 THEN
    RAISE EXCEPTION 'LEDGER_INTEGRITY_VIOLATION: wallet % changed without ledger entry', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_ledger_guard ON "wallets";
CREATE CONSTRAINT TRIGGER wallet_ledger_guard
AFTER INSERT OR UPDATE ON "wallets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_wallet_ledger_consistency();

-- 2. Ledger Immutability: Append-only forever (blocks UPDATE and DELETE)
CREATE OR REPLACE FUNCTION enforce_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: entries can never be altered or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_immutability_guard ON "ledger_entries";
CREATE TRIGGER ledger_immutability_guard
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_immutability();
