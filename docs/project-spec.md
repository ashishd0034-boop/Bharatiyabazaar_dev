# Bharatiya Bazaar — Project Specification

Last Updated: 2026-08-23

Status: Complete specification. Single source of truth for all business rules.

---

## Project Overview

**Project Name:** Bharatiya Bazaar (भारतीय बाज़ार)

**Project Goal:** Community-powered commerce platform where members earn through three income streams (AutoPool, MY SYSTEM, Setu Kosh), vendors accept member purchases with weekly settlements, and the platform manages complex commission trees with deterministic placement.

**Target Users:**
- Members (purchase IDs, refer others, earn commissions)
- Vendors (accept member purchases, settle weekly)
- Admins (configure platform settings)

**Tech Stack:**
- Backend: Node.js, Express.js, Prisma ORM
- Database: PostgreSQL
- Frontend: HTML/CSS/JavaScript (18 connected files)
- Testing: Jest

**Setup Commands:**
```bash
npm install
npm run dev          # Start server with nodemon
node src/server.js   # Start server directly
npx prisma studio    # Open database GUI
npx prisma migrate dev --name <migration_name>  # Apply schema changes
npm test             # Run test suite
```

```
bb-backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── jobs/
│   ├── lib/
│   └── server.js
├── public/          # Frontend assets & HTML files
├── docs/
│   ├── chat-history.md
│   ├── project-spec.md
│   └── tasks.md
├── tests/
├── .env
├── package.json
└── node_modules/
```

---

## Golden Rules (Non-Negotiable)

1. All money stored in paise (not rupees). Rs.300 = 30000 paise.
2. Every earning has a ledger entry. Never update balance without a ledger record.
3. Every commission event is idempotent (no duplicate commissions).
4. Pay-Once Rule enforced by database unique constraints.
5. Tree placement is deterministic (same input = same position numbers).
6. Rebirth placement follows fixed-position latest-first rule.
7. Withdrawal calculation order:
   - Step 0: 194R liability recovery (if pending)
   - Step 1: TDS (194H or 194C)
   - Step 2: Admin charge on post-TDS amount
8. Every admin setting change is audit-logged.
9. Financial reports must reconcile: Opening + Credits − Debits = Closing.

---

## ID Types & Identity

| Type | Description | Can earn MY SYSTEM? | Can achieve ACB? |
| :--- | :--- | :--- | :--- |
| **MAIN** | First purchased ID per member | Yes | Yes |
| **SUB** | Additional purchased IDs | Yes | Yes |
| **REBIRTH** | Free IDs generated from AutoPool L4–L7 | No | No |

### Numbering & Identity
- **Single Global Counter:** All ID cards allocate sequential positions from a single global counter (`AUTOPOOL_GLOBAL`).
- **Prefix Convention:**
  - `BB` = MAIN ID (e.g. `BB10001`)
  - `SB` = SUB ID (e.g. `SB10002`)
  - `RB` = REBIRTH ID (e.g. `RB10032`)
- **Card Number Formula:** `cardNumber = prefix + (10000 + globalPosition)`
- **Member Code Parity:** `member.memberCode === MAIN cardNumber`. Assigned a `TEMP_` placeholder upon registration and finalized immediately when the MAIN card is generated. The legacy `MEMBER_CODE` counter is retired.

---

## Three Income Streams

### 1. AutoPool (Anant Samriddhi Chakra)
- One global binary tree for all IDs.
- **Placement:** Breadth-first, deterministic by entry order.
- Each ID gets a `globalPosition` (integer starting from 1).
- 8 levels total: L0 (root) through L7 (255 nodes total: 1 root + 254 downline).
- **Cash Levels (L1–L3):**
  - Level 1 (2 IDs): Rs.300
  - Level 2 (4 IDs): Rs.300
  - Level 3 (8 IDs): Rs.200
  - Total cash per cycle: Rs.800
- **Rebirth Levels (L4–L7):**
  - Level 4 (16 IDs): 1 rebirth ID
  - Level 5 (32 IDs): 1 rebirth ID + Rs.200 voucher
  - Level 6 (64 IDs): 1 rebirth ID + Rs.200 voucher
  - Level 7 (128 IDs): 1 rebirth ID + Rs.200 voucher
  - Total vouchers per cycle: Rs.600
  - Total rebirth IDs per cycle: 4
- **Pool completion:** When all 255 positions fill, the ID stops earning AutoPool income. Rebirth IDs continue independently.

### 2. MY SYSTEM
- Personal binary tree per purchased ID (MAIN and SUB IDs). REBIRTH IDs do NOT get a MY SYSTEM tree.
- Levels 1–3 only (Levels 4+ inactive for MY SYSTEM).
- **Cash Levels:**
  - Level 1 (2 IDs): Rs.300
  - Level 2 (4 IDs): Rs.300
  - Level 3 (8 IDs): Rs.200
  - Total cash possible: Rs.800
- **Placement Rules:**
  - MAIN ID = root of member's MY SYSTEM tree.
  - SUB IDs = auto-placed under MAIN using breadth-first.
  - New member with sponsor = placed in sponsor's designated leg (LEFT or RIGHT). Read-only for new member.
- **ACB (Anant Chakra Builder):**
  - Achieved when an ID has **1 LEFT + 1 RIGHT direct referral** (where `sponsorIdCardId == this card's id`). Spillover placement children do NOT count toward ACB.
  - SUB cards achieve ACB via their own direct referrals; evaluated at child placement (tree-sponsor check) and by periodic background sweep.
  - ACB unlocks withdrawal for that ID's earnings.
  - REBIRTH IDs cannot achieve ACB.
- **7-day Validity Hold:**
  - All MY SYSTEM commissions start with status `PENDING_7_DAY`.
  - After 7 days, if no disputes/fraud are flagged, the background job moves them to `WITHDRAWABLE` (if ACB achieved) or `LOCKED_ACB`.

### 3. Setu Kosh
- Separate 10-level global binary tree.
- Shopping-based: Every Rs.1,000 of shopping at partner vendors creates 1 Setu Kosh ID.
- Counter is per member / MAIN ID (`SetuKoshCounter`). Purchases through MAIN, SUB, or REBIRTH all accumulate into the owner's single counter.
- **Unified Margin Accumulation:**
  - Every purchase adds `amountPaise` to `counterPaise` and `floor(amount * marginPct / 100)` to `accumulatedMarginPaise`.
  - Tree node placement and commission distribution occur **ONLY** when $\ge 1$ new ID is created ($k = \lfloor \text{newCounter} / 100000 \rfloor \ge 1$).
  - Each of the $k$ nodes distributes $M_{\text{node}} = \lfloor \text{accumulatedMargin} / k \rfloor$ up its L1–L10 upline. Leftover spend and margin carry forward automatically.
- **Strict Integer Commission Formula:**
  - L1–L3, L5–L6, L8–L10 (Full rate): $\lfloor M / 14 \rfloor$
  - L4, L7 (Half rate): $\lfloor M / 28 \rfloor$
  - Referral Bonus: 0.25% of purchase amount ($\lfloor A \times 25 / 10000 \rfloor$) to purchasing card's MY SYSTEM sponsor (fallback to owner's MAIN card sponsor if card has no MY SYSTEM node, e.g. REBIRTH).
  - Cap Invariant: $\sum \text{Commission} + \text{ReferralBonus} \le M$ (clamped if formula exceeds margin).
- **PIN-Code Activation Gate:**
  - Commissions stored as `PIN_GATE_INACTIVE` when buyer's PIN code has $< N$ active members (`PlatformSetting` default: 10).
  - When PIN code reaches $\ge N$ active members, subsequent purchases create `PENDING_SETTLEMENT` and automatically activate all existing `PIN_GATE_INACTIVE` entries for that PIN.
- **Placement:** Deterministic breadth-first binary tree using atomic `SETUKOSH_GLOBAL` counter ($P > 1 \implies \text{parent} = \lfloor P/2 \rfloor$, side = `P % 2 === 0 ? 'LEFT' : 'RIGHT'`).
- Settles weekly on Mondays. No ACB required for Setu Kosh withdrawals.

---

## Withdrawal & TDS Engine

### Exact Calculation Order (Steps 0–3)
For any member cash withdrawal of Gross Amount $G$ (in paise):
1. **Step 0 (194R Liability Recovery):**
   $$R_{194R} = \min(G, \text{Pending 194R Liability}), \quad G' = G - R_{194R}$$
2. **Step 1 (Section 194H TDS on $G'$):**
   ₹20,000 FY threshold, marginal excess calculation:
   - 3% for KYC Tier 2 / Verified PAN (`Member.kycTier == "TIER2"` or `panVerified` / `kycStatus == "VERIFIED"`)
   - 20% for Unverified / No PAN (`Member.kycTier == "NONE"`)
   $$\text{Post-TDS} = G' - TDS_{194H}$$
3. **Step 2 (Admin Charge on Post-TDS Amount):**
   $$\text{Admin Charge} = \lfloor \text{Post-TDS} \times \text{AdminRate} \rfloor \quad (\text{Bank: } 10\%, \text{ Wallet: } 5\%, \text{ Voucher: } 5\%)$$
4. **Step 3 (Net Payable):**
   $$\text{Net Payable} = \text{Post-TDS} - \text{Admin Charge}$$
5. **Financial Invariant:** $G = R_{194R} + TDS_{194H} + \text{Admin Charge} + \text{Net Payable}$.

### Multiple TDS Sections
- **Section 194H (Member Cash & Vendor Referral Bonuses):** ₹20k FY threshold, marginal method, 3% with PAN / 20% without.
- **Section 194R (Voucher Redemptions):** ₹20k FY threshold, full aggregate method (10% of total aggregate once crossed, e.g. ₹15k + ₹10k = ₹25k $\implies$ ₹2,500 liability). Recovered at Step 0 of next cash withdrawal.
- **Section 194C (Vendor Payouts):** ₹30k single / ₹1L aggregate per FY, marginal on aggregate excess, 1% ind+PAN / 2% comp+PAN / 20% no PAN.

### Escrow & Hold/Reverse Lifecycle
- **On Request:** Wallet balance locked via `SELECT ... FOR UPDATE`, gross amount debited as `WITHDRAWAL_ESCROW`, TDS recorded as `PENDING`.
- **On Complete:** Escrow reversed (`ESCROW_RELEASED`), split ledger debits posted (`WITHDRAWAL_PAYOUT`, `TDS_DEDUCTED`, `ADMIN_FEE`, `TDS_194R_RECOVERY`), TDS marked `DEPOSITED`.
- **On Reject:** Escrow fully refunded (`WITHDRAWAL_REFUND`), TDS flipped to `REVERSED`.
- **KYC Tiers:** `Member.kycTier` (`NONE`, `TIER1`, `TIER2`).

---

## Vendor Settlement Engine

### Calculation Order & Invariants (Strict Integer Paise)
1. **Gross Sales ($G$):** Sum of sales in settlement period.
2. **Platform Margin ($M$):** Category rate snapshotted at sale time.
3. **Post-Margin Amount ($P = G - M$).**
4. **Base Admin Charge ($A_{\text{base}} = \lfloor P \times \text{AdminRate} / 100 \rfloor$):** Default 10% Bank / 5% Wallet.
5. **Volume Discount ($V_{\text{disc}} = \lfloor A_{\text{base}} \times D_{\text{vol}} / 100 \rfloor$):** Applied to admin charge ONLY based on monthly sales in the calendar month of period end (0+ = 0%, 50k+ = 10%, 1L+ = 20%, 2L+ = 30%, 5L+ = 50%).
6. **Net Admin Charge ($A_{\text{net}} = A_{\text{base}} - V_{\text{disc}}$).**
7. **Early Fee ($F_{\text{early}} = 25000 \text{ paise / Rs.250}$ if on-demand early payout, else 0).**
8. **Payout Before TDS ($B = P - A_{\text{net}} - F_{\text{early}}$).**
9. **Section 194C TDS ($T_{194C}$):** Computed on $B$. Single $> \text{Rs.30k}$ or FY aggregate $> \text{Rs.1L}$ (marginal on excess). Rates: 1% individual+PAN / 2% company+PAN / 20% no PAN.
10. **Net Payable ($N_{\text{pay}} = B - T_{194C}$).**

### Reconciled Formula Example
- **Gross Sales:** Rs. 13,750.00 (1,375,000 paise) @ 7% category margin
- **Platform Margin (7%):** Rs. 962.50 (96,250 paise)
- **Post-Margin:** Rs. 12,787.50 (1,278,750 paise)
- **Admin Charge (9% on Post-Margin):** Rs. 1,150.87 (115,087 paise)
- **Payout Before TDS:** Rs. 11,636.63 (1,163,663 paise)
- **194C TDS (1% on Payout Before TDS, FY aggregate $> \text{Rs.1L}$):** Rs. 116.36 (11,636 paise)
- **Net Payable Payout:** **Rs. 11,520.27 (1,152,027 paise)**

---

## Admin Settings & Audit Engine

### Role-Based Access Control (RBAC) Permission Matrix
| Category / Actions | Keys & Operations | ADMIN | SUPER_ADMIN | Unauthorized Response |
| :--- | :--- | :---: | :---: | :--- |
| **Operational & Margin Controls** | `CATEGORY_MARGIN_*`, `VENDOR_ADMIN_CHARGE_*`, `ADMIN_CHARGE_*`, `EARLY_SETTLEMENT_FEE_PAISE`, `SETU_KOSH_PIN_GATE_COUNT`, `MAX_PURCHASED_IDS`, `VOLUME_DISCOUNT_*`, `VOUCHER_*` | ✅ | ✅ | 403 `FORBIDDEN` |
| **Financial TDS Rules** | `TDS_194H_*`, `TDS_194R_*`, `TDS_194C_*` | ❌ | ✅ | 403 `FORBIDDEN` |
| **System Lifecycle Toggles** | `MY_SYSTEM_7DAY_HOLD`, `AUTOPOOL_LOCKED_BEFORE_ACB`, `REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB`, `VENDOR_INACTIVITY_*`, `COMPANY_WALLET_MEMBER_ID` | ❌ | ✅ | 403 `FORBIDDEN` |
| **Admin User Management** | User registration and role assignments | ❌ | ✅ | 403 `FORBIDDEN` |

### Live Engine Wiring & Caching Architecture
- **In-Memory Cache:** In-memory setting cache with low-latency TTL $\le$ 60 seconds (`CACHE_TTL_MS = 60000`).
- **Immediate Invalidation:** Setting updates immediately evict the updated key from the cache.
- **Engines Wired:**
  - `idCardService`: `MAX_PURCHASED_IDS` (default 255; rebirth exempt).
  - `commissionService`: `MY_SYSTEM_7DAY_HOLD`, `AUTOPOOL_LOCKED_BEFORE_ACB`, `REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB`.
  - `rebirthService`: `VOUCHER_FACE_VALUE_PAISE` (20,000 paise / Rs. 200), `VOUCHER_VALIDITY_DAYS` (365 days).
  - `tdsService`: 194H/194R/194C thresholds and rates, admin charge rates.
  - `setuKoshService`: `SETU_KOSH_COUNTER_THRESHOLD_PAISE`, `SETU_KOSH_PIN_GATE_COUNT`, `SETU_KOSH_REFERRAL_BONUS_BPS`.
  - `settlementService`: 5-tier volume discounts (0/50k/1L/2L/5L), early fee (Rs. 250), vendor admin charges (10% Bank / 5% Wallet), inactivity days (31d/91d/181d).

### Category Margin Propagation (`applyToExisting` Toggle)
- **`applyToExisting: true`:** Updates `PlatformSetting` and updates all existing vendors in that category for future sales. Historical `VendorSale.marginPaise` snapshots remain completely untouched.
- **`applyToExisting: false`:** Updates `PlatformSetting` only; existing vendors keep their current margin rate, while newly registered vendors inherit the updated rate.

### Immutable Audit Logging
Every setting change and administrative override writes an immutable `AuditLog` entry with `actorId`, `actorType: "ADMIN"`, `action: "SETTINGS_UPDATED"` (or `"CATEGORY_MARGIN_UPDATED"`), `metadata: { key, oldValue, newValue, reason }`.

### Idempotent Bootstrapping & Startup Seed
- `src/lib/seedSettings.js` executes automatically on server startup.
- Bootstraps all default platform settings and provisions the initial `SUPER_ADMIN` account (configured via `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` env variables) and `COMPANY_WALLET` system member.

---

## Pay-Once Rule

- One ID can receive Level 1–3 cash **ONLY ONCE** across AutoPool and MY SYSTEM combined.
- **Tie-breaker for simultaneous completion:**
  1. AutoPool is processed FIRST.
  2. MY SYSTEM is processed SECOND.
- If AutoPool Level N is already paid, MY SYSTEM Level N is created with status `PAY_ONCE_BLOCKED` (Rs.0 amount).

---

## Rebirth Engine Rules

1. **Immediate and Position-Fixed:** Generated immediately at the next available `globalPosition` upon completion of AutoPool Level 4, 5, 6, or 7.
2. **Priority Order:** When a placement completes multiple rebirth-generating levels across ancestors, priority goes to the **latest / deepest / nearest ID first**, then moves upward through the ancestor chain.
3. **Rebirth Characteristics:**
   - Free (no purchase cost).
   - Participate in AutoPool (can generate further rebirths).
   - Rebirth earnings become withdrawable only when the owner's MAIN ID achieves ACB.

---

## Unified Wallet, Bifurcation & View Scoping

### Unified Member Wallet & Per-Card Bifurcation
- All earnings across all cards belong to the member's unified `Wallet`.
- Financial breakdown is sliced per card (`cardEarnings` slice: `totalPaise`, `withdrawablePaise`, `onHoldPaise`).
- **Financial Invariant:** `Card Total = Withdrawable + OnHold`.

### View Scoping
- **SUB Login:** Scoped strictly to the specific SUB card's downline subtree, commissions, AutoPool position, and direct referrals.
- **REBIRTH Login:** AutoPool-only view. MY SYSTEM tree returns `{ data: null, isRebirth: true }`.
- **MAIN ID Only Withdrawals:** Withdrawals can only be initiated when authenticated as the MAIN ID; SUB/REBIRTH contexts are restricted (HTTP 403 `FORBIDDEN_SUB_CARD`).

---

## AutoPool Explorer

- **Endpoint:** `GET /api/members/autopool-explorer?root=<idCardId>&depth=<1-7>`
- Returns a sparse-tree structure containing filled nodes and terminal empty positions for unexplored slots, breadcrumbs for hierarchy navigation, and rebirth badges.

---

## Background Jobs & Schedulers

- **Scheduler (`src/jobs/scheduler.js`) & Startup:**
  - **Startup Seed (`src/lib/seedSettings.js`):** Idempotently provisions setting defaults, superadmin account, and company reserve wallet.
  - **Hourly 7-Day Hold Expiry Sweep (`0 * * * *`):** Selects `PENDING_7_DAY` commissions older than 7 days $\to$ `WITHDRAWABLE` (if ACB) or `LOCKED_ACB`.
  - **Hourly ACB Sweep (`0 * * * *`):** Evaluates direct referrals $\to$ unlocks ACB and releases `LOCKED_ACB` earnings.
  - **Weekly Monday Settlement Run (`0 0 * * MON`):** Processes vendor settlements for previous Mon–Sun and releases `PENDING_SETTLEMENT` commissions (`settlePending`).
  - **Daily Inactivity Sweep (`0 2 * * *`):** Evaluates vendor last-sale dates (31d $\to$ `INACTIVE`, 91d $\to$ `FROZEN`, 181d $\to$ `CLOSED` with stream redirection to `COMPANY_WALLET`).
- Logs summary lines per execution.

---

## Security Baseline

- **Password Hashing:** `bcrypt` cost factor 10.
- **Input Validation:** Strict schema validation with `zod` middleware.
- **Rate Limiting:** Auth endpoint limiter (10 req/15min) + Global rate limiter (300 req/15min).
- **HTTP Security:** `helmet` enabled (CSP configured with `script-src-attr` & `unsafe-inline` for scripts/styles), CORS origin whitelist from env (defaults to `http://localhost:4000`), body parser limit `100kb`.
- **JWT Hardening:** JWT secret loaded exclusively from environment variables with fail-fast startup check.
- **IDOR Protection:** All mutation endpoints (`POST /api/id-cards/purchase`, withdrawals, vendor operations) derive identity directly from validated JWT `req.member.id`.

---

## Database Schema (22 Models)

See `prisma/schema.prisma` for full model definitions:
1. `Member` (`kycTier`, `memberCode`, `mobile`, `pinCode`)
2. `MemberIdCard` (`cardNumber`, `type`, `acbStatus`)
3. `AutoPoolNode` (`globalPosition`, `depthLevel`)
4. `MySystemNode` (`sponsorIdCardId`, `parentNodeId`)
5. `SetuKoshNode` (`globalPosition`, `depthLevel`)
6. `SetuKoshCounter` (`counterPaise`, `accumulatedMarginPaise`, `idsCreated`)
7. `Wallet` (`balancePaise`)
8. `LedgerEntry` (`balanceBeforePaise`, `balanceAfterPaise`, `source`)
9. `CommissionEntry` (`stream`, `level`, `amountPaise`, `status`, `sourceIdCardId`)
10. `PayOnceLedger` (`idCardId`, `level`)
11. `Voucher` (`faceValuePaise`, `status`)
12. `Withdrawal` (`grossPaise`, `tdsPaise`, `adminFeePaise`, `netPayablePaise`, `recovered194RPaise`, `idempotencyKey`)
13. `TdsLedger` (`section`, `taxableAmountPaise`, `tdsAmountPaise`, `status`)
14. `Vendor` (`marginRatePct`, `securityDepositPaise`, `walletBalancePaise`, `isDepositFrozen`, `lastSaleAt`, `payoutMethod`)
15. `VendorSale` (`amountPaise`, `marginPaise`, `idempotencyKey`)
16. `VendorSettlement` (`grossSalesPaise`, `postMarginPaise`, `volumeDiscountPaise`, `earlyFeePaise`, `payoutBeforeTdsPaise`, `tdsPaise`, `netPayablePaise`)
17. `VendorReferralBonus` (`bonusPaise`, `status`)
18. `PlatformSetting` (`key`, `value`)
19. `AuditLog` (`actorId`, `actorType`, `action`, `entityType`, `entityId`, `metadata: { key, oldValue, newValue, reason }`, `ipAddress`)
20. `AdminUser` (`email`, `role: SUPER_ADMIN | ADMIN | SUPPORT`, `name`, `passwordHash`)
21. `SystemCounter` (`id`, `currentValue`)
22. `SettlementRun` (`runType`, `periodStart`, `periodEnd`, `vendorCount`, `grossPaise`, `netPaise`, `status`)

### Key Constraints & Indexes
- `Member.mobile` (unique), `Member.memberCode` (unique)
- `MemberIdCard.cardNumber` (unique), `[memberId]` index
- `AutoPoolNode.globalPosition` (unique), `[idCardId]` (unique)
- `MySystemNode.idCardId` (unique), `[parentNodeId]` index, `[sponsorIdCardId]` index
- `SetuKoshNode.globalPosition` (unique)
- `CommissionEntry`: index on `[idCardId]`, compound index on `[idCardId, status]`
- `PayOnceLedger`: unique constraint on `[idCardId, level]`
- `VendorSale.idempotencyKey` (unique)
- `Withdrawal.idempotencyKey` (unique)
