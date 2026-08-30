# Bharatiya Bazaar (भारतीय बाज़ार) — Architectural Specification & Module Map

## 1. Architectural Philosophy & Structure
Bharatiya Bazaar backend follows a **Modular Feature-Sliced Domain Architecture** inspired by enterprise micro-kernel and NestJS modular domain principles.

The codebase is organized into two primary tiers:
1. **Core Subsystem (`src/core/`)**: Houses foundational, cross-cutting infrastructure that must never have circular dependencies on any feature domain.
2. **Feature Domain Modules (`src/modules/*`)**: Self-contained, isolated business slices housing their respective routes, controllers, services, and validation schemas.

```
src/
├── core/                                # Cross-Cutting Infrastructure
│   ├── database/
│   │   └── prisma.js                    # Singleton PrismaClient with Driver Adapter
│   ├── middleware/                      # Shared Auth & Validation Guards
│   │   ├── auth.middleware.js           # Member JWT Authentication
│   │   ├── admin-auth.middleware.js     # Admin RBAC Authentication
│   │   ├── vendor-auth.middleware.js    # Merchant/Vendor Authentication
│   │   ├── optional-auth.middleware.js  # Guest/Member Authentication
│   │   ├── validate.middleware.js       # Zod Schema Validation Guard
│   │   └── error.middleware.js          # Central Global Error Formatter
│   └── services/                        # Shared Financial & Platform Engines
│       ├── ledger.service.js            # Append-Only Double-Entry General Ledger
│       ├── wallet.service.js            # Dual-Balance (Main/Cash + Voucher) Engine
│       ├── audit.service.js             # Immutable Security Audit Logging
│       ├── system-settings.service.js   # Dynamic DB Configuration with In-Memory TTL Cache
│       ├── tds.service.js               # Statutory Tax Withholding Engine (194H/194R/194C)
│       ├── pay-once.service.js          # Lifetime Single-Benefit Deduplication Ledger
│       ├── commission.service.js        # Core Lock: AutoPool & MY SYSTEM Level Commissions
│       └── acb.service.js               # Core Lock: Active Commission Beneficiary Engine
│
├── modules/                             # Feature Domain Slices
│   ├── auth/                            # Identity, Registration & Public PIN Verification Slice
│   │   ├── auth.schemas.js              # Zod registration/login/PIN contracts
│   │   ├── auth.service.js              # Identity & Credential Domain Logic
│   │   ├── auth.controller.js           # Thin HTTP Transport Handlers
│   │   └── auth.routes.js               # Express Route Definitions with Rate Limiters
│   │
│   ├── member/                          # Member Profile, KYC & Feeds Slice
│   │   ├── member.schemas.js            # KYC & Profile Schemas
│   │   ├── member.service.js            # Member Entity Lifecycle & Notification Aggregator
│   │   ├── member.controller.js         # Profile / KYC / Feed Controller Handlers
│   │   └── member.routes.js             # Member API Routes (/api/members/*)
│   │
│   ├── my-system/                       # Personal Binary Tree & Spillover Slice
│   │   ├── my-system.schemas.js         # Tree Query Schemas
│   │   ├── my-system.service.js         # Extreme Binary Tree Traversal & Spillover Logic
│   │   ├── my-system.controller.js      # Tree & Placement Controller Handlers
│   │   └── my-system.routes.js          # Genealogy Tree Routes
│   │
│   ├── autopool/                        # Global 2x7 FIFO Tree & Rebirth Engine Slice
│   │   ├── autopool.schemas.js          # AutoPool Explorer Query Schemas
│   │   ├── autopool.service.js          # Global Breadth-First Coordinates & Sparse Tree Explorer
│   │   ├── rebirth.service.js           # Immediate Rebirth Queue & Ancestor Cascade Engine
│   │   ├── autopool.controller.js       # AutoPool Tree HTTP Handlers
│   │   └── autopool.routes.js           # AutoPool API Routes (/api/members/autopool-*)
│   │
│   ├── pin/                             # Member-Facing Prepaid Activation PIN Slice
│   │   ├── pin.schemas.js               # Purchase and Validation Schemas
│   │   ├── pin.service.js               # Member Wallet Debit, Redemption & Listing
│   │   ├── pin.controller.js            # Member PIN Handlers
│   │   └── pin.routes.js                # Authenticated PIN Routes (/api/pins/*)
│   │
│   ├── wallet/                          # Member Dual Balance & Ledger Views Slice
│   │   ├── wallet.schemas.js            # Ledger Query Schemas
│   │   ├── wallet.service.js            # Member Balance & Per-Card Bifurcation
│   │   ├── wallet.controller.js         # Balance, Summary & Ledger Handlers
│   │   └── wallet.routes.js             # Wallet Routes (/api/wallet/*, /api/wallets/*)
│   │
│   ├── withdrawal/                      # Member Withdrawals & Admin Approval Slice
│   │   ├── withdrawal.schemas.js        # Request & Action Validation Schemas
│   │   ├── withdrawal.service.js        # Step 0-3 TDS & Admin Deductions, Escrow Locking
│   │   ├── withdrawal.controller.js     # Request, Complete, Reject, History Handlers
│   │   └── withdrawal.routes.js         # Withdrawal Routes (/api/withdrawals/*)
│   │
│   └── [FUTURE SLICES: vendor, setu-kosh, admin]
│
├── jobs/                                # Scheduled CRON Tasks (e.g. 7-day holds, hourly sweep)
└── server.js                            # Express Application Bootstrap & Route Mounting
```

---

## 2. Domain Dependency Rules & Boundaries

1. **One-Way Core Dependency**:
   - `src/modules/*` may import from `src/core/*`.
   - `src/core/*` **NEVER** imports from `src/modules/*`.
2. **Strict Module Isolation (Import Rule)**:
   - Domain modules must **NOT** import directly from sibling domain modules.
   - Cross-domain interactions are mediated via shared core services (e.g., `wallet.service.js`, `ledger.service.js`, `tds.service.js`, `acb.service.js`).
3. **Core Placement Lock**:
   - `commission.service.js` and `acb.service.js` are locked to `src/core/services/` to prevent circular cross-module dependencies.

---

## 3. Mathematical & Business Domain Invariants

### 3.1 Withdrawal Step 0-3 Execution Model & Escrow
- **Locking & Eligibility**:
  - Initiations locked strictly to MAIN ID card with `acbStatus = true`.
  - Row locking: `SELECT * FROM wallets WHERE "memberId" = ... FOR UPDATE`.
- **Step 0**: 194R Voucher Tax Liability recovery deduction.
- **Step 1**: 194H TDS calculation (Section 194H threshold & PAN-based rate).
- **Step 2**: Admin Fee deduction on post-TDS amount (10% Bank/UPI, 5% Wallet).
- **Step 3**: Net Payable credit.
- **Accounting Assertion**:
  $$\text{Gross Amount} = \text{Recovered 194R} + \text{TDS 194H} + \text{Admin Fee} + \text{Net Payout}$$

---

## 4. Phase Migration Audit & Refactor Summary

| Refactoring Phase | Target Domain | Key Milestones Accomplished | Contract Parity Diff | Test Results |
|---|---|---|---|---|
| **Phase 1** | `auth`, `member`, `core` | - Extracted `src/core/database/prisma.js`<br>- Extracted `src/core/middleware/*` (6 guards)<br>- Extracted `src/core/services/*` (8 core engines)<br>- Migrated `src/modules/auth/` (register, login, verify-pin)<br>- Migrated `src/modules/member/` (profile, kyc, notifications) | **0 differences** (15/15 routes matching) | 28 / 28 Suites Passed<br>140 / 140 Tests Passed |
| **Phase 2** | `my-system`, `idCardService` | - Created `src/modules/my-system/`<br>- Isolated `findSpillSlot`, `nextSlot`, `placeInMySystem`<br>- Extracted `getGenealogyTree`, `getMyPlacement`, `getDirectReferralCounts`<br>- Delegated `idCardService.purchaseIds` placement hooks to `mySystemService`<br>- Preserved `idCardService` export surface | **0 differences** (87/87 routes matching) | 28 / 28 Suites Passed<br>140 / 140 Tests Passed<br>Live Smoke: 100% Green |
| **Phase 3** | `autopool`, `rebirth` | - Created `src/modules/autopool/`<br>- Isolated `getAutoPoolTreeAndStats` & `getSparseTreeExplorer`<br>- Extracted `rebirth.service.js` with nearest-ancestor priority queue<br>- Preserved `src/services/rebirthService.js` export surface | **0 differences** (87/87 routes matching) | 28 / 28 Suites Passed<br>140 / 140 Tests Passed<br>Live Smoke: 100% Green |
| **Phase 4** | `pin`, `wallet` | - Created `src/modules/pin/` (member purchase, validate, my-pins)<br>- Created `src/modules/wallet/` (balance, ledger, commissions)<br>- Preserved auth boundaries (POST /api/pins/validate stays member JWT-authenticated)<br>- Preserved `src/services/pinService.js` and `src/controllers/walletController.js` export surfaces | **0 differences** (87/87 routes matching) | 28 / 28 Suites Passed<br>140 / 140 Tests Passed<br>Live Smoke: 100% Green |
| **Phase 5** | `withdrawal` | - Created `src/modules/withdrawal/` (request, complete, reject, history, preview)<br>- Step 0-3 calculation, escrow management, and ACB MAIN lock isolated<br>- Preserved `src/services/withdrawalService.js` and `src/controllers/withdrawalController.js` export surfaces | **0 differences** (87/87 routes matching) | 28 / 28 Suites Passed<br>140 / 140 Tests Passed<br>Live Smoke: 100% Green |

---

## 5. Temporary Backwards-Compatibility Shims
To allow zero-downtime execution and 100% test compatibility, legacy pathways in `src/routes/`, `src/controllers/`, `src/services/`, and `src/middleware/` remain as thin re-export barrel shims. All shims are cataloged and slated for cleanup in the final module cleanup phase.
