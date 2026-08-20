# Bharatiya Bazaar — Project Specification

Last Updated: 2026-08-14

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
- Frontend: HTML/CSS/JavaScript (18 corrected files)
- Testing: Jest (planned)

**Setup Commands:**
```bash
npm install
npm run dev          # Start server with nodemon
node src/server.js   # Start server directly (fallback)
npx prisma studio    # Open database GUI
npx prisma migrate dev --name <migration_name>  # Apply schema changes
npm test             # Run test suite (planned)
bb-backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── lib/
│   │   └── prisma.js
│   ├── routes/
│   │   ├── memberRoutes.js
│   │   └── idCardRoutes.js
│   ├── services/
│   │   ├── memberService.js
│   │   └── idCardService.js
│   ├── utils/
│   └── server.js
├── docs/
│   ├── chat-history.md
│   ├── project-spec.md
│   └── tasks.md
├── .env
├── package.json
└── node_modules/
Golden Rules (Non-Negotiable)

All money stored in paise (not rupees). Rs.300 = 30000 paise.
Every earning has a ledger entry. Never update balance without a ledger record.
Every commission event is idempotent (no duplicate commissions).
Pay-Once Rule enforced by database unique constraints.
Tree placement is deterministic (same input = same position numbers).
Rebirth placement follows fixed-position latest-first rule.
Withdrawal calculation order:
Step 0: 194R liability recovery (if pending)
Step 1: TDS (194H or 194C)
Step 2: Admin charge on post-TDS amount
Every admin setting change is audit-logged.
Financial reports must reconcile: Opening + Credits − Debits = Closing.
ID Types


Type - Main
Description - First purchased ID per member
Can earn MY SYSTEM? - Yes
Can achieve ACB? - Yes
Type - Sub
Description - Additional purchased IDs
Can earn MY SYSTEM? - Yes
Can achieve ACB? - Yes
Type - Rebirth
Description - Free IDs from AutoPool L4-L7
Can earn MY SYSTEM? - No
Can achieve ACB? - No

Three Income Streams

1. AutoPool (Anant Samriddhi Chakra)

One global binary tree for all IDs
Placement: breadth-first, deterministic by entry order
Each ID gets a globalPosition (integer starting from 1)
8 levels total: L0 (root) through L7
Cash Levels (L1-L3):
Level 1 (2 IDs): Rs.300
Level 2 (4 IDs): Rs.300
Level 3 (8 IDs): Rs.200
Total cash per cycle: Rs.800
Rebirth Levels (L4-L7):
Level 4 (16 IDs): 1 rebirth ID
Level 5 (32 IDs): 1 rebirth ID + Rs.200 voucher
Level 6 (64 IDs): 1 rebirth ID + Rs.200 voucher
Level 7 (128 IDs): 1 rebirth ID + Rs.200 voucher
Total vouchers per cycle: Rs.600
Total rebirth IDs per cycle: 4
Total positions per pool subtree: 255 (1 root + 254 downline)
Pool completion behaviour:
When all 255 positions fill, ID stops earning AutoPool income
ID remains in global tree as filled node
Rebirth IDs continue independently
2. MY SYSTEM

Personal binary tree per purchased ID
Applies to ALL purchased IDs (MAIN + SUB)
Does NOT apply to REBIRTH IDs
Levels 1-3 only (Levels 4+ inactive for MY SYSTEM)
Cash Levels:
Level 1 (2 IDs): Rs.300
Level 2 (4 IDs): Rs.300
Level 3 (8 IDs): Rs.200
Total cash possible: Rs.800
Placement rules:
MAIN ID = root of member's MY SYSTEM tree
SUB IDs = auto-placed under MAIN using breadth-first
New member with sponsor = placed in sponsor's chosen LEFT or RIGHT
Sponsor placement is read-only (member cannot change it)
Later additions can be manually placed, else breadth-first
ACB (Anant Chakra Builder):
Achieved when ID has 1 LEFT + 1 RIGHT direct referral (where sponsorIdCardId == this card's id). Spillover placement children do NOT count toward ACB.
ACB unlocks withdrawal for that ID's earnings
ACB is earned in MY SYSTEM, NOT in AutoPool
Each purchased ID can independently achieve ACB
REBIRTH IDs cannot achieve ACB

SUB Card Login & Wallet Bifurcation:
- Members can authenticate using their registered mobile, Member Code (BBxxxxx), or any owned SUB card number (SBxxxxx / RBxxxxx) with their account password.
- When logged in as a SUB card, the user accesses the owner member's unified account in SUB context.
- Withdrawals can only be initiated when authenticated as the MAIN card. SUB card withdrawal attempts return HTTP 403 Forbidden.
- Wallet & Commissions views provide per-card bifurcation breakdown (how much each individual MAIN/SUB ID earned, holds, and contributed).

7-day validity hold:
ALL MY SYSTEM L1, L2, L3 commissions are PENDING for 7 days after completion
After 7 days with no reversal/dispute/fraud → becomes CONFIRMED
During hold period, can be reversed if issue detected
3. Setu Kosh

Separate 10-level global binary tree (separate from AutoPool and MY SYSTEM)
Shopping-based (not referral-based)
Every Rs.1,000 of shopping at partner vendors creates 1 Setu Kosh ID
Counter is per member / MAIN ID (not per ID)
Purchases through MAIN, SUB, or REBIRTH all count to same member counter
Overflow carries forward automatically
PIN code activation: requires N members (admin-configurable) in PIN code
Commission Formula:
Base rate = weighted vendor margin × 0.071428
(Weighted margin calculated strictly in integers over the accumulated Rs. 1,000 purchases to prevent manipulation)

Level structure:
L1 = full rate
L2 = full rate
L3 = full rate
L4 = HALF rate
L5 = full rate
L6 = full rate
L7 = HALF rate
L8 = full rate
L9 = full rate
L10 = full rate

Total potential = 9/14 of vendor margin (64.29%)

Referral bonus = 0.25% of purchase amount (to MY SYSTEM sponsor, marked PENDING_SETTLEMENT)
Total payout capped by vendor margin from that purchase
Status rules:
Commissions PENDING until Monday vendor settlement
After settlement → CONFIRMED and withdrawable
Does NOT require ACB (unlike AutoPool/MY SYSTEM)
Pay-Once Rule
One ID can receive Level 1-3 cash ONLY ONCE
across AutoPool and MY SYSTEM combined.
Tie-breaker for simultaneous completion:
AutoPool is processed FIRST.
MY SYSTEM is processed SECOND.
If AutoPool Level N already paid, MY SYSTEM Level N = PAY-ONCE BLOCKED.
But MY SYSTEM level still counts for ACB unlock.
Rebirth ID Rules

Generation

Generated when AutoPool Level 4, 5, 6, or 7 completes
One rebirth ID per level completion
Rebirth IDs are FREE (no purchase cost)
Rebirth IDs do NOT count toward purchased ID cap
Placement (CRITICAL)
1. Immediate and position-fixed
2. As soon as Level completes, rebirth generated at NEXT global position
3. Remaining purchased IDs placed AFTER that rebirth ID
Priority when multiple rebirths trigger simultaneously:
Latest / Deepest / Nearest ID gets priority first
Then move upward through ancestor chain
Characteristics

Do NOT get MY SYSTEM tree
Do NOT get MY SYSTEM earnings
Do NOT get ACB status
Do participate in AutoPool (can generate further rebirths)

Withdrawal Rule:
Rebirth ID earnings become withdrawable ONLY when
owner's MAIN ID achieves ACB status.

Withdrawal Rules

Source-Based Withdrawability:
Withdrawal happens ONLY from MAIN ID.
But eligibility is checked per source ID and stream.

Withdrawable if:
- Source ID is ACB (for AutoPool/MY SYSTEM earnings)
- Or stream is Setu Kosh (no ACB required, after settlement)

Locked if:
- Source ID not ACB (AutoPool/MY SYSTEM earnings)

Pending if:
- MY SYSTEM commission within 7-day hold
- Setu Kosh awaiting Monday settlement
Sub ID and Rebirth ID Sweep
When SUB ID or REBIRTH ID earning becomes withdrawable,
it is auto-swept to MAIN ID's wallet.
Withdrawal Methods
Method - Bank Transfer
Admin Charge - 10% on post-TDS
Speed - 1-2 working days
Method - Member Wallet Transfer
Admin Charge - 5% on post-TDS
Speed - Instant
Method - Voucher Wallet Conversion
Admin Charge - 5% on post-TDS
Speed - Instant
Withdrawal Calculation Order
Step 0: Recover 194R liability (if pending from vouchers)
Step 1: TDS (194H for member cash, or 194C for vendor)
Step 2: Admin charge on POST-TDS amount
Step 3: Net payable
Sunday waiver does NOT exist. Admin charge applies every day.
TDS Rules

Section 194H — Member Cash Commissions

Threshold: Rs.20,000 aggregate per FY
Rate: 3% with PAN (KYC Tier 2) / 20% without PAN
Marginal method: TDS only on excess when crossing threshold
Once above threshold, all subsequent withdrawals fully taxable
Held at request, deposited only on COMPLETED withdrawal
Reversed if withdrawal is REJECTED
Section 194R — Product Vouchers

Threshold: Rs.20,000 aggregate voucher face value per FY
Full aggregate method: Once crossed, liability = 10% of FULL aggregate value (not just excess)
Recovered from member's next withdrawal automatically
NOT reversed if voucher expires unusedSection 194C — Vendor Settlements

Single payment threshold: Rs.30,000
Aggregate FY threshold: Rs.1,00,000
Rates: 1% (individual + PAN) / 2% (company/firm + PAN) / 20% (no PAN)
Marginal method on crossing aggregate threshold
Form 16A issued quarterly
Section 194H — Vendor Referral Bonus

Separate from settlement TDS (194C)
Threshold: Rs.20,000 per FY
Rate: 3% with PAN / 20% without PAN
Vendor Rules

Category Margins

Fixed per category (7% to 25%)
Configurable by admin
Non-negotiable with vendors
When updated, admin chooses: apply to existing vendors or new vendors only
Settlement Cycle

Weekly on Mondays (for previous Mon-Sun)
Early settlement: flat Rs.250 fee
Settlement Calculation
Gross sales
− Platform margin (category rate)
= Post-margin amount
− Admin charge (10% bank / 5% wallet)
+ Volume discount on admin charge (tiered)
= Payout before TDS
− 194C TDS (if applicable)
= Net payable
Volume Discount Tiers (on admin charge, NOT on vendor margin)
Tier - 1
Monthly Sales - Rs.0+
Discount - 0%
Tier - 2
Monthly Sales - Rs.50,000+
Discount - 10%
Tier - 3
Monthly Sales - Rs.1,00,000+
Discount - 20%
Tier - 4
Monthly Sales - Rs.2,00,000+
Discount - 30%
Tier - 1
Monthly Sales - Rs.5,00,000+
Discount - 50%
Vendor Referral Bonus

0.25% of ALL sales at referred vendors — lifetime
Only ONE referrer per vendor (first recorded wins permanently)
Taxed under Section 194H
Security Deposit

Rs.5,000 refundable deposit
Frozen when wallet balance falls below Rs.500
Used to cover pending member commissions in fraud case first, then penalties
Inactivity (Graduated)

31 days: INACTIVE
91 days: FROZEN
181 days: CLOSED (platform inherits position, commissions go to company wallet)
Fraud & Penalties

Fraud: 10x transaction value + permanent deactivation
Data tampering: 5x transaction value
QR refusal: Rs.1,000 per incident
Member commissions covered from deposit before penalty forfeiture
Admin Configurable Settings

Maximum purchased IDs per member (rebirth IDs exempt)
MY SYSTEM 7-day hold (toggle)
AutoPool earnings locked before ACB (toggle)
Rebirth ID withdrawal requires MAIN ID ACB (toggle)
Member inactivity days (31/91/181)
TDS thresholds and rates (194H, 194R, 194C)
Admin charge rates (bank, member wallet, voucher conversion, vendor settlement)
Vendor early settlement fee
Volume discount tiers
Vendor category margins (with "apply to existing" toggle)
Setu Kosh counter threshold (Rs.1,000 default)
Setu Kosh PIN activation member count
Setu Kosh referral bonus rate
Voucher face value and validity (365 days default)
Database Schema

See prisma/schema.prisma for current schema with 19 models:
Member, MemberIdCard, AutoPoolNode, MySystemNode, SetuKoshNode
SetuKoshCounter, Wallet, LedgerEntry, CommissionEntry, PayOnceLedger
Voucher, Withdrawal, TdsLedger, Vendor, VendorSale, VendorSettlement
VendorReferralBonus, PlatformSetting, AuditLog
Key constraints:
Member.mobile is unique
MemberIdCard.cardNumber is unique
AutoPoolNode.globalPosition is unique
SetuKoshNode.globalPosition is unique
PayOnceLedger has unique constraint on [idCardId, level]

---

# Updated File 3: `docs/tasks.md`

```markdown
# Bharatiya Bazaar — Tasks & Roadmap

Last Updated: 2026-08-14

Status: Phase 0 complete. Phase 1 in progress. Ready for AI coder.

---

## Phase 0: Capture Project Context ✅ COMPLETED

### Task 0.1: Add full chat history ✅
- [x] Paste the complete original project chat history into `docs/chat-history.md`
- [x] Remove or replace the placeholder summary if needed
- [x] Make sure no secrets are included

### Task 0.2: Extract project requirements ✅
- [x] Identify the project goal: Community-powered commerce platform
- [x] Identify the target users: Members, Vendors, Admins
- [x] Identify the main features: AutoPool, MY SYSTEM, Setu Kosh, Withdrawals, TDS
- [x] Identify the tech stack: Node.js, Express, Prisma, PostgreSQL
- [x] Identify existing code/files: 18 HTML files, Express server with member/ID endpoints
- [x] Identify constraints: Paise only, deterministic placement, Pay-Once Rule, rebirth priority

### Task 0.3: Update project specification ✅
- [x] Update `docs/project-spec.md`
- [x] Fill in project name: Bharatiya Bazaar
- [x] Fill in tech stack: Node.js, Express, Prisma, PostgreSQL
- [x] Fill in setup commands: npm install, npm run dev, npx prisma studio
- [x] Fill in build/test commands: npm test (planned)
- [x] Fill in folder structure: prisma/, src/, docs/

---

## Phase 1: Set Up AI Coding Environment 🟡 IN PROGRESS

### Task 1.1: Confirm VS Code usage ✅
- [x] Confirm that the user wants VS Code, not Visual Studio
- [x] Open the project folder in VS Code: `~/Desktop/bb-backend`

### Task 1.2: Install AI agent extension
Choose one (recommended: Cline or Roo Code):

- [ ] Install Cline
- [ ] Install Roo Code
- [ ] Install GitHub Copilot + Copilot Chat
- [ ] Install Continue

**Recommendation:** Cline or Roo Code for direct execution capabilities

### Task 1.3: Configure AI model
Choose one provider:

- [ ] DashScope / Alibaba Cloud Qwen
- [ ] OpenRouter
- [ ] Local Ollama
- [ ] OpenAI-compatible API

Configuration needed:
- [ ] API key or local endpoint
- [ ] Model name
- [ ] Base URL if required
- [ ] Permission settings for file editing and terminal execution

### Task 1.4: Configure safety settings
- [ ] Initialize Git repository if not already initialized
- [ ] Commit current working state
- [ ] Create a branch for AI changes (e.g., `feature/ai-commission-engine`)
- [ ] Disable auto-run for destructive commands
- [ ] Review file diffs before committing

---

## Phase 2: Define First Real Development Task ⏳ PENDING

### Task 2.1: Identify the first task

**Most urgent task:** Commission Engine Foundation

**Expected outcome:**
- Commission calculation for AutoPool and MY SYSTEM levels
- Pay-Once Rule enforcement
- ACB unlock logic
- All commission entries created with correct status

**Files likely to change:**
- `src/services/commissionService.js` (new)
- `src/services/payOnceService.js` (new)
- `src/services/acbService.js` (new)
- `src/services/idCardService.js` (hook commission trigger)

**Risks:**
- Pay-Once Rule must be enforced at database level (unique constraint)
- Tie-breaking order (AutoPool first, MY SYSTEM second) must be exact
- 7-day hold state machine must be implemented correctly

### Task 2.2: Create implementation plan

**Implementation steps:**
1. Create `commissionService.js` with functions:
   - `checkAutoPoolLevelCompletion(nodeId)` — check if levels 1-7 complete
   - `checkMySystemLevelCompletion(nodeId)` — check if levels 1-3 complete
   - `calculateAndCreateCommissions(idCardId)` — main orchestrator
   - `createCommissionEntry(idCardId, stream, level, amount, status)`

2. Create `payOnceService.js` with functions:
   - `hasAlreadyPaid(idCardId, level)` — query PayOnceLedger
   - `recordPayment(idCardId, level, paidVia)` — insert into PayOnceLedger
   - Database unique constraint on `[idCardId, level]` already exists

3. Create `acbService.js` with functions:
   - `checkAcbStatus(idCardId)` — query MY SYSTEM tree for LEFT + RIGHT
   - `unlockAcb(idCardId)` — update MemberIdCard.acbStatus = true
   - `unlockLockedEarnings(idCardId)` — update CommissionEntry status from LOCKED_ACB to CONFIRMED

4. Hook into `idCardService.js`:
   - After creating AutoPoolNode, call `commissionService.checkAutoPoolLevelCompletion()`
   - After creating MySystemNode, call `commissionService.checkMySystemLevelCompletion()`

5. Create test for Scenario A (3 IDs):
   - Register member
   - Purchase 3 IDs
   - Verify: BB10001 AutoPool L1 = Rs.300, BB10001 MY SYSTEM L1 = Pay-Once blocked, BB10001 ACB = true

**Required dependencies:** None (all already installed)

**Required environment variables:** None new (DATABASE_URL already configured)

**Required API endpoints:** None new (internal service functions)

**Required UI changes:** None (backend only)

**Required database changes:** None (schema already complete)

### Task 2.3: Implement first task

- [ ] Make code changes (4 new service files + 1 modified file)
- [ ] Run install command if needed (not needed)
- [ ] Run development server: `node src/server.js`
- [ ] Run tests: Create and run Scenario A test
- [ ] Fix errors
- [ ] Summarize changes:
  - Files changed: list
  - Commands run: list
  - Errors encountered: list
  - Fixes applied: list
  - Remaining issues: list

---

## Phase 3: Ongoing AI Workflow

For every future task, use this process:

1. **Read:**
   - `docs/chat-history.md`
   - `docs/project-spec.md`
   - `docs/tasks.md`

2. **Understand** the requested task

3. **Propose a plan** before editing code:
   - Files to change
   - Functions to create
   - Edge cases to handle
   - Tests to write

4. **Wait for approval** unless the user says to proceed automatically

5. **Make minimal focused changes**
   - Do not refactor unrelated code
   - Do not delete existing functionality
   - Preserve coding style

6. **Run relevant commands**
   - Install dependencies if needed
   - Run development server
   - Run tests
   - Verify in Prisma Studio

7. **Report:**
   - Files changed
   - Commands run
   - Errors found
   - Fixes applied
   - Remaining issues

---

## Future Task List (After Commission Engine)

### Task 3: Wallet & Ledger Engine
**Files to create:**
- `src/services/walletService.js`
- `src/services/ledgerService.js`

**Requirements:**
- Create LedgerEntry for every commission
- Track: CONFIRMED, PENDING, LOCKED, WITHDRAWABLE balances separately
- When MY SYSTEM 7-day hold expires → update status → create ledger credit
- When ACB achieved → unlock all LOCKED entries → create ledger credits
- Source-based withdrawability check
- Sub ID / Rebirth ID sweep to MAIN ID wallet

**Validation test:**
- After Scenario A: Main wallet shows withdrawable Rs.300
- After Scenario C: Y1 withdrawable Rs.800, L1 locked Rs.800

---

### Task 4: Rebirth Engine
**Files to create:**
- `src/services/rebirthService.js`

**Requirements:**
- Trigger rebirth generation when AutoPool Level 4/5/6/7 completes
- Place rebirth at NEXT global position (immediate, position-fixed)
- Create MemberIdCard with type=REBIRTH
- Create AutoPoolNode with calculated parent/side
- Implement **latest-first priority** when multiple rebirths trigger simultaneously
- Generate vouchers for L5/L6/L7 completions

**Validation test:**
- Scenario C: Y1-R1 must be at global position #32
- Scenario D: Position #63 completes R1 L4 + Y1 L5 → #64 = R1-R1, #65 = Y1-R2

---

### Task 5: Withdrawal & TDS Engine
**Files to create:**
- `src/services/withdrawalService.js`
- `src/services/tdsService.js`

**Requirements:**
- Calculate withdrawal in exact order: 194R recovery → TDS → Admin charge → Net
- 194H for member cash (Rs.20,000 threshold, marginal crossing)
- 194R for vouchers (Rs.20,000 threshold, full aggregate method)
- 194C for vendor settlements (Rs.30,000 single / Rs.1,00,000 aggregate, marginal)
- Admin charges: 10% bank, 5% member wallet, 5% voucher conversion (all on post-TDS)
- Hold TDS until withdrawal COMPLETED, reverse if REJECTED
- Recover 194R liability from next withdrawal

**Validation test:**
- Rs.600 withdrawal below threshold: TDS=0, admin=60, net=540
- Withdrawal crossing Rs.20,000 threshold: marginal TDS on excess only

---

### Task 6: Setu Kosh Engine
**Files to create:**
- `src/services/setuKoshService.js`
- `src/services/vendorService.js`

**Requirements:**
- Track per-member shopping counter (in paise)
- Create Setu Kosh ID every Rs.1,000 of shopping
- Place Setu Kosh IDs in separate global 10-level tree
- Calculate commissions using formula: `vendor margin × 0.071428` with L4/L7 half rate
- Add referral bonus 0.25%
- Cap total payout by vendor margin
- Mark commissions PENDING until Monday settlement
- Setu Kosh earnings withdrawable without ACB after settlement

**Validation test:**
- Rs.1,000 purchase at 7% margin vendor → commissions to L1-L10 upline with L4/L7 half rate

---

### Task 7: Vendor Settlement Engine
**Files to create:**
- `src/services/vendorSettlementService.js`

**Requirements:**
- Weekly settlement on Monday (previous Mon-Sun)
- Early settlement with Rs.250 fee
- Settlement calculation per project-spec.md section 9
- Volume discount tiers on admin charge (not vendor margin)
- Vendor referral bonus calculation (0.25% lifetime)
- 194C TDS application
- Security deposit logic (freeze when wallet < Rs.500)
- Fraud penalty logic (10x, cover member commissions first)

**Validation test:**
- Rs.13,750 gross sales, 7% margin, 9% admin, 1% TDS → net Rs.11,614.12

---

### Task 8: Admin Settings & Audit
**Files to create:**
- `src/services/adminService.js`
- `src/services/auditService.js`

**Requirements:**
- CRUD for PlatformSetting
- Category margin updates with "apply to existing" toggle
- TDS threshold/rate updates
- ID cap settings
- Inactivity day settings
- All changes logged to AuditLog
- Role-based access control (SuperAdmin vs Admin)

---

### Task 9: Automated Test Suite
**Files to create:**
- `tests/scenarios/scenario-a.test.js` (3 IDs)
- `tests/scenarios/scenario-b.test.js` (2+5 IDs)
- `tests/scenarios/scenario-c.test.js` (Y1+L1+R31)
- `tests/scenarios/scenario-d.test.js` (Scene 2 continuation)
- `tests/unit/payonce.test.js`
- `tests/unit/tds.test.js`
- `tests/unit/withdrawal.test.js`
- `tests/unit/rebirth-priority.test.js`

**Validation:**
- All scenarios from project-spec.md section 2 (scenarios A-D)
- All edge cases from chat-history.md

---

### Task 10: Frontend Integration
- Connect all 18 corrected HTML files to backend APIs
- Replace hardcoded demo data with live API calls
- Add authentication (JWT)
- Add session management

---

## Current Task

**Phase 1: Set Up AI Coding Environment**

Next action:
- Install AI agent extension (Cline or Roo Code recommended)
- Configure AI model (DashScope/OpenRouter/Ollama/OpenAI-compatible)
- Initialize Git repository
- Commit current working state

After Phase 1 is complete, proceed to Phase 2, Task 2.1: Commission Engine Foundation.

---

## Notes for AI Coder

- **Do NOT refactor working code** unless it's blocking the next task.
- **Always preserve** the fixed-position latest-first rebirth rule (see project-spec.md section 6).
- **Always use paise** (integers) for money, never floats.
- **Always create ledger entries** before updating balances.
- **Always check Pay-Once** before paying any Level 1-3 commission.
- **Run tests** after each task before moving to the next.
- **Do NOT run `npx prisma migrate reset`** without explicit user confirmation.
- When in doubt, ask the user before making architectural decisions.
- Follow the 8 rules in the system prompt exactly.

