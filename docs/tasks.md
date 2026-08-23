# Bharatiya Bazaar — Tasks & Roadmap

Last Updated: 2026-08-23

Status: Phase 1 & Tasks 2,3,4, Wave 1 completed. Active development on backend & integration.

---

## Phase 0: Capture Project Context ✅ COMPLETED
- [x] Full original chat history captured in `docs/chat-history.md`
- [x] Project requirements extracted
- [x] Project specification updated in `docs/project-spec.md`

---

## Phase 1: Set Up AI Coding Environment ✅ COMPLETED
- [x] Environment configured with Antigravity agent
- [x] Git repository & working branch initialized (`feature/ai-commission-engine`)
- [x] Safety & execution constraints established

---

## Backend Engine Tasks

### Task 2: Commission Engine Foundation ✅ COMPLETED & VERIFIED
- [x] `src/services/commissionService.js` (AutoPool L1–L3 & MY SYSTEM L1–L3 logic)
- [x] `src/services/payOnceService.js` (Pay-Once unique constraint & ledger check)
- [x] `src/services/acbService.js` (1 LEFT + 1 RIGHT direct referral check & unlock)
- [x] Idempotency & level completion hooks in `idCardService.js`

### Task 3: Wallet & Ledger Engine ✅ COMPLETED & VERIFIED
- [x] `src/services/walletService.js` (Credit, debit, balance queries)
- [x] Per-card bifurcation (`cardEarnings` slice: total/withdrawable/onHold)
- [x] Invariant verified: `Card Total = Withdrawable + OnHold`

### Task 4: Rebirth Engine ✅ COMPLETED & VERIFIED
- [x] `src/services/rebirthService.js`
- [x] Immediate position-fixed placement for AutoPool L4–L7 completions
- [x] Latest-first / deepest-first priority resolution
- [x] Rebirth voucher creation for L5–L7

### Task 5: Withdrawal & TDS Engine ✅ COMPLETED & VERIFIED (Wave 2 — 45c01a2)
- [x] Minimum withdrawal limit validation (Rs.100)
- [x] MAIN ID login restriction for withdrawal requests
- [x] Source-card ACB verification guard
- [x] Full calculation order (Steps 0–3) with 194R recovery and post-TDS admin fees
- [x] Sections 194H, 194R (full aggregate 10%), and 194C implemented in `tdsService.js`
- [x] Atomic row locking (`FOR UPDATE`), escrow ledger splits, and hold/reverse lifecycle

### Task 6: Setu Kosh Engine ✅ COMPLETED & VERIFIED (Wave 3 — e64e015)
- [x] Unified shopping counter (`SetuKoshCounter`) with overflow carry-forward
- [x] Deterministic 10-level binary tree (`SETUKOSH_GLOBAL`) with integer splits ($\lfloor M/14 \rfloor, \lfloor M/28 \rfloor$)
- [x] PIN-code activation gate with retroactive unlocking
- [x] 0.25% referral bonus with REBIRTH $\to$ owner MAIN sponsor fallback

### Task 7: Vendor Settlement Engine ✅ COMPLETED & VERIFIED (Wave 4 — aaea48f)
- [x] Weekly Monday settlement cron (`0 0 * * MON`) and early on-demand payout (Rs.250 fee)
- [x] Section 194C TDS with marginal aggregate excess calculation
- [x] Volume discount tiers applied to admin charge ONLY
- [x] Daily inactivity lifecycle (31d/91d/181d) & stream redirection to `COMPANY_WALLET`
- [x] Admin fraud penalties (10x FRAUD, 5x TAMPERING, Rs.1,000 QR_REFUSAL) with deposit recovery

### Task 8: Admin Settings & Audit ✅ COMPLETED & VERIFIED (Wave 5 — da4c084)
- [x] Role-based access control (SUPER_ADMIN vs ADMIN permission matrix)
- [x] In-memory caching ($\le 60\text{s}$ TTL) with immediate cache eviction
- [x] Live setting wiring into 6 backend engines (toggles, TDS, margin, voucher, inactivity)
- [x] Category margin update with `applyToExisting` propagation toggle
- [x] Idempotent bootstrap seed & immutable audit logging

---

## Testing & Quality Assurance

### Task 9: Automated Test Suite ⏳ CURRENT ACTIVE TASK
- [x] `tests/scenarios/scenario-a.test.js` (3 IDs flow)
- [x] `tests/scenarios/scenario-b.test.js` (Sponsor placement flow)
- [x] `tests/scenarios/scenario-c.test.js` (Rebirth generation)
- [x] `tests/scenarios/scenario-d.test.js` (Multi-level cascading rebirths)
- [x] `tests/scenarios/attack.test.js` (IDOR attack validation)
- [x] `tests/scenarios/registration.test.js` (3-ID registration regression)
- [x] `tests/scenarios/withdrawal-tds.test.js` (Wave 2 full withdrawal & TDS validation)
- [x] `tests/scenarios/setu-kosh.test.js` (Wave 3 Setu Kosh tree, PIN gate, and counter validation)
- [x] `tests/scenarios/vendor-settlement.test.js` (Wave 4 vendor settlement, 194C, and lifecycle validation)
- [x] `tests/scenarios/admin-settings.test.js` (Wave 5 admin settings, RBAC, toggles, audit logs)
- [ ] Standalone unit test suite (`payonce.test.js`, `tds.test.js`, `withdrawal.test.js`)

---

## Frontend Integration

### Task 10: Frontend Integration 🟡 PARTIAL
- [x] Member registration & login flows connected to live backend
- [x] Member dashboard, wallet bifurcation & tree views operational
- [ ] Vendor, Admin, Hindi localization, and Notification pages connected

---

## Completed Waves Summary
- **Wave 1 (`7061c17`):** IDOR fix, fail-fast JWT check, Helmet CSP, body parser limit, rate limits, hourly scheduler.
- **CSP Hotfix (`45db1a4`):** `script-src-attr: ["'unsafe-inline'"]` to enable inline button onclick handlers.
- **Wave 2 (`45c01a2`):** Withdrawal & TDS engine (194H/194R/194C, admin charges, hold/reverse, admin auth).
- **Wave 3 (`e64e015`):** Setu Kosh engine (shopping counter, 10-level tree, integer commissions, PIN gate, vendor auth).
- **Wave 4 (`aaea48f`):** Vendor settlement engine (Monday cron, 194C marginal, volume discounts, deposits, fraud, inactivity).
- **Wave 5 (`da4c084`):** Admin settings & audit (RBAC matrix, live-wired PlatformSetting, apply-to-existing, seed defaults).
