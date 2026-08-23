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

### Task 5: Withdrawal & TDS Engine 🟡 GUARD-ONLY
- [x] Minimum withdrawal limit validation (Rs.100)
- [x] MAIN ID login restriction for withdrawal requests
- [x] Source-card ACB verification guard
- [ ] Full TDS (194H/194R/194C) calculation pipeline integration

### Task 6: Setu Kosh Engine ⏳ PENDING
- [ ] Per-member Rs.1,000 shopping counter
- [ ] 10-level tree placement & weighted margin commission calculation
- [ ] Weekly Monday settlement release

### Task 7: Vendor Settlement Engine ⏳ PENDING
- [ ] Weekly settlement cron & volume discount tiers
- [ ] Security deposit freeze rules & vendor referral bonuses

### Task 8: Admin Settings & Audit ⏳ PENDING
- [ ] Dynamic `PlatformSetting` controls with audit logging
- [ ] Role-based access control (SUPER_ADMIN, ADMIN, SUPPORT)

---

## Testing & Quality Assurance

### Task 9: Automated Test Suite 🟡 PARTIAL
- [x] `tests/scenarios/scenario-a.test.js` (3 IDs flow)
- [x] `tests/scenarios/scenario-b.test.js` (Sponsor placement flow)
- [x] `tests/scenarios/scenario-c.test.js` (Rebirth generation)
- [x] `tests/scenarios/scenario-d.test.js` (Multi-level cascading rebirths)
- [x] `tests/scenarios/attack.test.js` (IDOR attack validation)
- [x] `tests/scenarios/registration.test.js` (3-ID registration regression)
- [ ] Standalone unit test suite (`payonce.test.js`, `tds.test.js`, `withdrawal.test.js`)

---

## Frontend Integration

### Task 10: Frontend Integration 🟡 PARTIAL
- [x] Member registration & login flows connected to live backend
- [x] Member dashboard, wallet bifurcation & tree views operational
- [ ] Vendor, Admin, Hindi localization, and Notification pages connected

---

## Security Hardening (Wave 1) ✅ COMPLETED & COMMITTED
- [x] IDOR fix on `POST /api/id-cards/purchase` (enforces `req.member.id`)
- [x] Regression testing on registration flow
- [x] Fail-fast JWT startup check & dev fallback secret removal
- [x] Helmet security headers (CSP configured for inline scripts/styles)
- [x] CORS origin whitelist & body parser size limit (100kb)
- [x] Global rate limiter (300 req/15min) + auth rate limiter (10 req/15min)
- [x] Hourly background cron scheduler for 7-day hold expiry and ACB sweeps
