# Bharatiya Bazaar — Chat History & Decision Log

Last Updated: 2026-08-23

Status: Complete original chat history + post-2026-08-14 decision log captured.

---

## Phase 0: Project Context Capture ✅ COMPLETED

### Task 0.1: Full Chat History ✅
- [x] Complete original conversation captured below
- [x] No secrets included
- [x] All business rules documented

### Task 0.2: Project Requirements ✅
- **Project Goal:** Community-powered commerce platform with three income streams
- **Target Users:** Members (earn commissions), Vendors (accept purchases), Admins
- **Main Features:** AutoPool, MY SYSTEM, Setu Kosh, Withdrawals, TDS, Vendor settlements
- **Tech Stack:** Node.js, Express, Prisma, PostgreSQL
- **Existing Code:** 18 corrected HTML files, Express server with member/ID card endpoints
- **Constraints:** All money in paise, deterministic tree placement, Pay-Once Rule, rebirth priority rules

### Task 0.3: Project Specification ✅
- [x] Updated in `docs/project-spec.md`
- [x] All business rules documented
- [x] All scenarios validated

---

## Original Chat History Summary

### Phase 1: Frontend HTML Corrections (18 Files)

All 18 HTML files were corrected file-by-file to align with validated business rules:

1. `bb-calculator.html` — Withdrawal breakdown with TDS + admin
2. `bb-wallet.html` — Source-based withdrawable balance
3. `bb-dashboard.html` — Earnings split by source ID and stream
4. `bb-commissions.html` — MY SYSTEM L1 corrected to PAY-ONCE BLOCKED
5. `bb-setu-kosh.html` — Commission formula: vendor margin × 0.071428
6. `bb-settlement.html` — 194C for vendors, 194H for referral bonus
7. `bb-register.html` — Sponsor-decided placement (read-only)
8. `bb-tree.html` — MY SYSTEM tree + AutoPool position link
9. `bb-autopool.html` — Global tree with 255 positions (254 downline + 1 root)
10. `bb-rebirth.html` — Rebirth generation overview (not Pool 1/2/3)
11. `bb-vendor-register.html` — Inactivity 181 days, TDS sections
12. `bb-vendor-dashboard.html` — Volume discount on admin charge
13. `bb-admin-settings.html` — Category margins, TDS thresholds, ID cap
14. `bb-admin.html` — Rebirth generation overview, platform-inherited positions
15. `bb-hindi.html` — Hindi dashboard with corrected statuses
16. `bb-notifications.html` — Source-based withdrawal language
17. `bb-components.html` — Canonical UI component library
18. `bharatiya-bazaar-v2.html` — Main landing page

---

### Phase 2: Backend Planning & Scenario Validation

#### Scenario A: Member joins with 3 IDs
BB10001 = MAIN ID, BB10002 = SUB ID 1, BB10003 = SUB ID 2
Expected:
- BB10001 AutoPool L1 = Rs.300 (paid)
- BB10001 MY SYSTEM L1 = Rs.0 (Pay-Once blocked)
- BB10001 ACB = achieved
- BB10002 = no earning
- BB10003 = no earning
- Withdrawable = Rs.300

#### Scenario B: Member (2 IDs) brings person (5 IDs) on RIGHT
A1 = MAIN, A2 = SUB (member); B1-B5 = right person's IDs
Expected:
- Member: earned Rs.900, withdrawable Rs.600, locked Rs.300
- Person B: earned Rs.600, withdrawable Rs.300, pending Rs.300
- Member ACB: A1 only
- Person B ACB: B1, B2

#### Scenario C: Y1 (1 ID) + L1 (1 ID) + R1 (31 IDs)
Y1 = top of global AutoPool
Expected:
- Y1 earned Rs.800, withdrawable Rs.800
- Y1 generated 1 rebirth ID at global position #32
- L1 earned Rs.800, locked Rs.800 (not ACB)
- Right member earned Rs.7,200, withdrawable Rs.5,900, pending Rs.1,300
- Right member ACB IDs: R1-R15 (15 IDs)

#### Scenario D: Scene 2 continuation
Y1 places LL (31 IDs) under L1 LEFT; L1 places LR (31 IDs) under L1 RIGHT
Expected:
- L1 becomes ACB, previous Rs.800 unlocked
- Y1 gets Rs.300 cash (Y1-R1 AutoPool L1) + Rs.200 voucher (Y1 Level 5)
- Y1-R2 rebirth ID generated
- L1 gets Rs.300 (L1-R1 AutoPool L1) + Rs.200 voucher
- Rebirth IDs generated: L1-R1, R1-R1, Y1-R2, R2-R1, R3-R1, L1-R2

---

### Phase 3: Critical Rule Corrections

#### Rebirth Placement Rule (FINAL, LOCKED)
- Rebirth ID placement is IMMEDIATE and POSITION-FIXED.
- As soon as Level 4/5/6/7 completes, rebirth ID is generated at the NEXT global position.
- Remaining purchased IDs are placed AFTER that rebirth ID.
- Priority when multiple rebirths trigger simultaneously: LATEST / DEEPEST / NEAREST ID FIRST, then move upward through ancestors.

---

## Decision Log Addendum (post 2026-08-14)

1. **Numbering & Prefix Convention:**
   - Single unified numbering sequence using atomic counter `AUTOPOOL_GLOBAL`.
   - Explicit prefixes: `BB` for MAIN, `SB` for SUB, `RB` for REBIRTH.
   - Formula: `cardNumber = prefix + (10000 + globalPosition)`.
2. **Member Code Parity:**
   - `member.memberCode` is kept in strict 1:1 parity with the member's MAIN `cardNumber`.
   - Handled via temporary placeholder `TEMP_` on registration and finalized when the MAIN ID card is created.
   - Legacy data migrated (`BB10016` → `BB10018`).
3. **Strict Referral ACB Check:**
   - ACB eligibility requires 1 LEFT + 1 RIGHT directly sponsored card (`sponsorIdCardId === this.id`).
   - Spillover placement children do not grant ACB.
   - Retroactive fix applied for `BB10003`.
4. **SUB Cards Earn ACB:**
   - Any SUB card can achieve ACB on its own if it directly sponsors downlines.
   - Evaluated at placement and via periodic background sweep.
5. **SUB Login, Scoping & Wallet Bifurcation:**
   - Members can authenticate using their registered mobile, Member Code (`BBxxxxx`), or any SUB card number (`SBxxxxx` / `RBxxxxx`) with account password.
   - Subtree, commissions, AutoPool position, and referrals are scoped to current login card.
   - Withdrawals restricted strictly to MAIN ID logins.
   - Unified wallet with per-card bifurcated breakdown: `Card Total = Withdrawable + OnHold`.
6. **AutoPool Explorer:**
   - Sparse tree navigation with breadcrumbs and rebirth badges up to depth 7 via `GET /api/members/autopool-explorer`.
7. **Database Indexing:**
   - Added compound and foreign key indexes on `CommissionEntry` (`idCardId`, `status`) and `MySystemNode` (`parentNodeId`, `sponsorIdCardId`).
8. **Git Baseline:**
   - Stable baseline tagged at commit `2c46513`.
9. **Wave 1 Security & Schedulers:**
   - Fixed IDOR vulnerability on `POST /api/id-cards/purchase` by ignoring request body `memberId` and enforcing `req.member.id`.
   - Removed development fallback secrets and added fail-fast validation for `JWT_SECRET` at server startup.
   - Configured `helmet` (allowing unsafe-inline for scripts/styles), CORS origin whitelist from env, `100kb` body parser limit, and global rate limiter (300 req/15min).
   - Created `src/jobs/scheduler.js` with hourly cron jobs for 7-day hold expiry (respecting ACB status) and ACB sweeps.
10. **Wave 2 Withdrawal & TDS Engine (`45c01a2`):**
    - Implemented exact calculation order: Step 0 (194R recovery) $\to$ Step 1 (194H TDS) $\to$ Step 2 (Admin charge on post-TDS) $\to$ Step 3 (Net payable).
    - Implemented Section 194H (20k FY threshold, marginal 3%/20%), Section 194R (20k FY threshold, 10% full aggregate tax), and Section 194C (30k single / 1L aggregate).
    - Implemented atomic wallet balance locking (`SELECT ... FOR UPDATE`), escrow ledger entries (`WITHDRAWAL_ESCROW`, `ESCROW_RELEASED`, `WITHDRAWAL_PAYOUT`, `TDS_DEDUCTED`, `ADMIN_FEE`, `TDS_194R_RECOVERY`), and `Member.kycTier` (`NONE`, `TIER1`, `TIER2`).
    - Added public `POST /api/admin/login` and admin authentication middleware.
11. **Helmet CSP Inline Handler Hotfix (`45db1a4`):**
    - Added `"script-src-attr": ["'unsafe-inline'"]` to Helmet CSP configuration in `server.js` to prevent modern browsers from blocking inline `onclick` handlers on buttons (login, logout, explorer).
12. **Wave 3 Setu Kosh Engine (`e64e015`):**
    - Implemented single unified `SetuKoshCounter` per member aggregating spend across MAIN, SUB, and REBIRTH contexts.
    - Unified margin accumulation: node generation and upline commission distribution occur only when $\ge 1$ new ID is generated ($k = \lfloor \text{newCounter} / 100000 \rfloor \ge 1$), distributing $\lfloor acc / k \rfloor$ per node with leftover carry-forward.
    - Strict integer formulas: $\lfloor M / 14 \rfloor$ (L1–L3, L5–L6, L8–L10), $\lfloor M / 28 \rfloor$ (L4, L7), 0.25% referral bonus ($\lfloor A \times 25 / 10000 \rfloor$) with cap enforcement $\le M$.
    - PIN-code gate: marks commissions `PIN_GATE_INACTIVE` when active members in buyer's PIN $< N$; automatically unlocks existing entries to `PENDING_SETTLEMENT` when $\ge N$.
    - Rebirth referral fallback: purchases under REBIRTH cards correctly credit the owner's MAIN card MY SYSTEM sponsor.
13. **Wave 4 Vendor Settlement Engine (`aaea48f`):**
    - Implemented weekly Monday settlement cron (`0 0 * * MON`) and on-demand early settlement with flat Rs. 250 fee (`runType: "EARLY"`).
    - Calculation order: Gross $\to$ Platform Margin $\to$ Post-Margin $\to$ Admin Charge (with monthly volume discount on admin charge only) $\to$ Early Fee $\to$ 194C TDS $\to$ Net Payable.
    - Section 194C semantics: aggregate tracked on payout-before-TDS ($B$); single $> \text{Rs.30k}$ or aggregate $> \text{Rs.1L}$ with marginal calculation on excess.
    - Reconciled specification formula example: Gross Rs. 13,750 @ 7% margin, 9% admin, 1% TDS $\implies$ Net = **Rs. 11,520.27 (1,152,027 paise)**.
    - Daily inactivity lifecycle cron (`0 2 * * *`): 31d $\to$ `INACTIVE`, 91d $\to$ `FROZEN`, 181d $\to$ `CLOSED` (streams redirect to `COMPANY_WALLET`).
    - Admin fraud penalties: `FRAUD` (10x + permanent deactivation), `TAMPERING` (5x), `QR_REFUSAL` (Rs. 1,000) covering member commissions from security deposit first.
14. **Wave 5 Admin Settings & Audit Engine (`da4c084`):**
    - Implemented live-wired `PlatformSetting` engine with in-memory caching (TTL $\le$ 60s) and instant cache eviction on update.
    - Defined strict RBAC permission matrix: `ADMIN` manages operational margins, vendor charges, and caps; `SUPER_ADMIN` exclusively manages financial TDS rates/thresholds, system lifecycle toggles (`MY_SYSTEM_7DAY_HOLD`, `AUTOPOOL_LOCKED_BEFORE_ACB`, `REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB`), inactivity days, and admin users. Unauthorized attempts return HTTP 403 `FORBIDDEN`.
    - Wired live settings into 6 core backend engines (`idCardService`, `commissionService`, `rebirthService`, `tdsService`, `setuKoshService`, `settlementService`).
    - Implemented `applyToExisting` category margin toggle allowing margin revisions on future vendor sales while preserving immutable historical sale snapshots.
    - Wired configurable voucher settings (`VOUCHER_FACE_VALUE_PAISE`, `VOUCHER_VALIDITY_DAYS`) and 5-tier volume discount rules.
    - Added automated startup seed (`src/lib/seedSettings.js`) bootstrapping defaults and provisioning the initial `SUPER_ADMIN` user and `COMPANY_WALLET` member.
    - Implemented immutable `AuditLog` recording before and after values for all setting mutations.


