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
- [x] Open the project folder in VS Code: ~/Desktop/bb-backend

### Task 1.2: Install AI agent extension
Choose one (recommended: Cline or Roo Code):

- [ ] Install Cline
- [ ] Install Roo Code
- [ ] Install GitHub Copilot + Copilot Chat
- [ ] Install Continue

Recommendation: Cline or Roo Code for direct execution capabilities

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
- [ ] Create a branch for AI changes (e.g., feature/ai-commission-engine)
- [ ] Disable auto-run for destructive commands
- [ ] Review file diffs before committing

---

## Phase 2: Define First Real Development Task ⏳ PENDING

### Task 2.1: Identify the first task

Most urgent task: Commission Engine Foundation

Expected outcome:
- Commission calculation for AutoPool and MY SYSTEM levels
- Pay-Once Rule enforcement
- ACB unlock logic
- All commission entries created with correct status

Files likely to change:
- src/services/commissionService.js (new)
- src/services/payOnceService.js (new)
- src/services/acbService.js (new)
- src/services/idCardService.js (hook commission trigger)

Risks:
- Pay-Once Rule must be enforced at database level (unique constraint)
- Tie-breaking order (AutoPool first, MY SYSTEM second) must be exact
- 7-day hold state machine must be implemented correctly

### Task 2.2: Create implementation plan

Implementation steps:
1. Create commissionService.js with functions:
   - checkAutoPoolLevelCompletion(nodeId) — check if levels 1-7 complete
   - checkMySystemLevelCompletion(nodeId) — check if levels 1-3 complete
   - calculateAndCreateCommissions(idCardId) — main orchestrator
   - createCommissionEntry(idCardId, stream, level, amount, status)

2. Create payOnceService.js with functions:
   - hasAlreadyPaid(idCardId, level) — query PayOnceLedger
   - recordPayment(idCardId, level, paidVia) — insert into PayOnceLedger
   - Database unique constraint on [idCardId, level] already exists

3. Create acbService.js with functions:
   - checkAcbStatus(idCardId) — query MY SYSTEM tree for LEFT + RIGHT
   - unlockAcb(idCardId) — update MemberIdCard.acbStatus = true
   - unlockLockedEarnings(idCardId) — update CommissionEntry status from LOCKED_ACB to CONFIRMED

4. Hook into idCardService.js:
   - After creating AutoPoolNode, call commissionService.checkAutoPoolLevelCompletion()
   - After creating MySystemNode, call commissionService.checkMySystemLevelCompletion()

5. Create test for Scenario A (3 IDs):
   - Register member
   - Purchase 3 IDs
   - Verify: BB10001 AutoPool L1 = Rs.300, BB10001 MY SYSTEM L1 = Pay-Once blocked, BB10001 ACB = true

Required dependencies: None (all already installed)

Required environment variables: None new (DATABASE_URL already configured)

Required API endpoints: None new (internal service functions)

Required UI changes: None (backend only)

Required database changes: None (schema already complete)

### Task 2.3: Implement first task

- [ ] Make code changes (4 new service files + 1 modified file)
- [ ] Run install command if needed (not needed)
- [ ] Run development server: node src/server.js
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

1. Read:
   - docs/chat-history.md
   - docs/project-spec.md
   - docs/tasks.md

2. Understand the requested task

3. Propose a plan before editing code:
   - Files to change
   - Functions to create
   - Edge cases to handle
   - Tests to write

4. Wait for approval unless the user says to proceed automatically

5. Make minimal focused changes
   - Do not refactor unrelated code
   - Do not delete existing functionality
   - Preserve coding style

6. Run relevant commands
   - Install dependencies if needed
   - Run development server
   - Run tests
   - Verify in Prisma Studio

7. Report:
   - Files changed
   - Commands run
   - Errors found
   - Fixes applied
   - Remaining issues

---

## Future Task List (After Commission Engine)

### Task 3: Wallet & Ledger Engine
Files to create:
- src/services/walletService.js
- src/services/ledgerService.js

Requirements:
- Create LedgerEntry for every commission
- Track: CONFIRMED, PENDING, LOCKED, WITHDRAWABLE balances separately
- When MY SYSTEM 7-day hold expires → update status → create ledger credit
- When ACB achieved → unlock all LOCKED entries → create ledger credits
- Source-based withdrawability check
- Sub ID / Rebirth ID sweep to MAIN ID wallet

Validation test:
- After Scenario A: Main wallet shows withdrawable Rs.300
- After Scenario C: Y1 withdrawable Rs.800, L1 locked Rs.800

---

### Task 4: Rebirth Engine
Files to create:
- src/services/rebirthService.js

Requirements:
- Trigger rebirth generation when AutoPool Level 4/5/6/7 completes
- Place rebirth at NEXT global position (immediate, position-fixed)
- Create MemberIdCard with type=REBIRTH
- Create AutoPoolNode with calculated parent/side
- Implement latest-first priority when multiple rebirths trigger simultaneously
- Generate vouchers for L5/L6/L7 completions

Validation test:
- Scenario C: Y1-R1 must be at global position #32
- Scenario D: Position #63 completes R1 L4 + Y1 L5 → #64 = R1-R1, #65 = Y1-R2

---

### Task 5: Withdrawal & TDS Engine
Files to create:
- src/services/withdrawalService.js
- src/services/tdsService.js

Requirements:
- Calculate withdrawal in exact order: 194R recovery → TDS → Admin charge → Net
- 194H for member cash (Rs.20,000 threshold, marginal crossing)
- 194R for vouchers (Rs.20,000 threshold, full aggregate method)
- 194C for vendor settlements (Rs.30,000 single / Rs.1,00,000 aggregate, marginal)
- Admin charges: 10% bank, 5% member wallet, 5% voucher conversion (all on post-TDS)
- Hold TDS until withdrawal COMPLETED, reverse if REJECTED
- Recover 194R liability from next withdrawal

Validation test:
- Rs.600 withdrawal below threshold: TDS=0, admin=60, net=540
- Withdrawal crossing Rs.20,000 threshold: marginal TDS on excess only

---

### Task 6: Setu Kosh Engine
Files to create:
- src/services/setuKoshService.js
- src/services/vendorService.js

Requirements:
- Track per-member shopping counter (in paise)
- Create Setu Kosh ID every Rs.1,000 of shopping
- Place Setu Kosh IDs in separate global 10-level tree
- Calculate commissions using formula: vendor margin × 0.071428 with L4/L7 half rate
- Add referral bonus 0.25%
- Cap total payout by vendor margin
- Mark commissions PENDING until Monday settlement
- Setu Kosh earnings withdrawable without ACB after settlement

Validation test:
- Rs.1,000 purchase at 7% margin vendor → commissions to L1-L10 upline with L4/L7 half rate

---

### Task 7: Vendor Settlement Engine
Files to create:
- src/services/vendorSettlementService.js

Requirements:
- Weekly settlement on Monday (previous Mon-Sun)
- Early settlement with Rs.250 fee
- Settlement calculation per project-spec.md section 9
- Volume discount tiers on admin charge (not vendor margin)
- Vendor referral bonus calculation (0.25% lifetime)
- 194C TDS application
- Security deposit logic (freeze when wallet < Rs.500)
- Fraud penalty logic (10x, cover member commissions first)

Validation test:
- Rs.13,750 gross sales, 7% margin, 9% admin, 1% TDS → net Rs.11,614.12

---

### Task 8: Admin Settings & Audit
Files to create:
- src/services/adminService.js
- src/services/auditService.js

Requirements:
- CRUD for PlatformSetting
- Category margin updates with "apply to existing" toggle
- TDS threshold/rate updates
- ID cap settings
- Inactivity day settings
- All changes logged to AuditLog
- Role-based access control (SuperAdmin vs Admin)

---

### Task 9: Automated Test Suite
Files to create:
- tests/scenarios/scenario-a.test.js (3 IDs)
- tests/scenarios/scenario-b.test.js (2+5 IDs)
- tests/scenarios/scenario-c.test.js (Y1+L1+R31)
- tests/scenarios/scenario-d.test.js (Scene 2 continuation)
- tests/unit/payonce.test.js
- tests/unit/tds.test.js
- tests/unit/withdrawal.test.js
- tests/unit/rebirth-priority.test.js

Validation:
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

Phase 1: Set Up AI Coding Environment

Next action:
- Install AI agent extension (Cline or Roo Code recommended)
- Configure AI model (DashScope/OpenRouter/Ollama/OpenAI-compatible)
- Initialize Git repository
- Commit current working state

After Phase 1 is complete, proceed to Phase 2, Task 2.1: Commission Engine Foundation.

---

## Notes for AI Coder

- Do NOT refactor working code unless it is blocking the next task.
- Always preserve the fixed-position latest-first rebirth rule (see project-spec.md section 6).
- Always use paise (integers) for money, never floats.
- Always create ledger entries before updating balances.
- Always check Pay-Once before paying any Level 1-3 commission.
- Run tests after each task before moving to the next.
- Do NOT run npx prisma migrate reset without explicit user confirmation.
- When in doubt, ask the user before making architectural decisions.
- Follow the 8 rules in the system prompt exactly.