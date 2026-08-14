# Bharatiya Bazaar — Chat History & Decision Log

Last Updated: 2026-08-14

Status: Complete original chat history captured. Ready for AI coder handoff.

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
BB10001 = MAIN ID BB10002 = SUB ID 1 BB10003 = SUB ID 2
Expected:
BB10001 AutoPool L1 = Rs.300 (paid)
BB10001 MY SYSTEM L1 = Rs.0 (Pay-Once blocked)
BB10001 ACB = achieved
BB10002 = no earning
BB10003 = no earning
Withdrawable = Rs.300

#### Scenario B: Member (2 IDs) brings person (5 IDs) on RIGHT
A1 = MAIN, A2 = SUB (member) B1-B5 = right person's IDs
Expected:
Member: earned Rs.900, withdrawable Rs.600, locked Rs.300
Person B: earned Rs.600, withdrawable Rs.300, pending Rs.300
Member ACB: A1 only
Person B ACB: B1, B2

#### Scenario C: Y1 (1 ID) + L1 (1 ID) + R1 (31 IDs)
Y1 = top of global AutoPool
Expected:
Y1 earned Rs.800, withdrawable Rs.800
Y1 generated 1 rebirth ID at global position #32
L1 earned Rs.800, locked Rs.800 (not ACB)
Right member earned Rs.7,200, withdrawable Rs.5,900, pending Rs.1,300
Right member ACB IDs: R1-R15 (15 IDs)

#### Scenario D: Scene 2 continuation
Y1 places LL (31 IDs) under L1 LEFT L1 places LR (31 IDs) under L1 RIGHT
Expected:
L1 becomes ACB, previous Rs.800 unlocked
Y1 gets Rs.300 cash (Y1-R1 AutoPool L1) + Rs.200 voucher (Y1 Level 5)
Y1-R2 rebirth ID generated
L1 gets Rs.300 (L1-R1 AutoPool L1) + Rs.200 voucher
Rebirth IDs generated: L1-R1, R1-R1, Y1-R2, R2-R1, R3-R1, L1-R2

---

### Phase 3: Critical Rule Corrections

#### Rebirth Placement Rule (FINAL, LOCKED)

After extensive discussion, the rebirth placement rule was finalized as:
Rebirth ID placement is IMMEDIATE and POSITION-FIXED.
As soon as Level 4/5/6/7 completes, rebirth ID is generated at the NEXT global position.
Remaining purchased IDs are placed AFTER that rebirth ID.
If multiple rebirth triggers happen simultaneously, PRIORITY = LATEST/DEEPEST ID FIRST, then move upward.

Formula for Level 4 rebirth of ID at position P:
Level 4 positions = P×16 to ((P+1)×16)−1 Level 4 rebirth position = (P+1)×16

Example: Y1 at position #1
Level 4 fills #16-#31 Y1-R1 generated immediately at #32

#### Priority Rule When Multiple Rebirths Trigger
When a new position completes multiple rebirth-generating levels:
Start from the LATEST / DEEPEST / NEAREST ID to the newly filled position
Move UPWARD through ancestors
Each gets its rebirth in sequence at next available position

Example: Position #63 completes R1 L4 + Y1 L5
#64 = R1 rebirth (latest/deeper, priority) #65 = Y1 rebirth

---

### Phase 4: Backend Implementation Progress

#### Environment Setup ✅
- Node.js installed
- PostgreSQL installed
- Database: `bb_dev`
- Project folder: `~/Desktop/bb-backend`

#### Completed Backend Work ✅
1. Project initialized with `npm init -y`
2. Installed: express, cors, dotenv, @prisma/client, prisma, nodemon
3. Prisma initialized with `npx prisma init`
4. PostgreSQL connection configured in `.env`
5. Full schema created with 19 models
6. Migration applied
7. Express server running on port 4000
8. Prisma client connected to server

#### Working Endpoints ✅
- `GET /health` — health check with DB connection test
- `POST /api/members/register` — member creation with duplicate protection (P2002 handling + @unique constraint)
- `GET /api/members` — list all members
- `GET /api/members/:id` — get member by ID
- `POST /api/id-cards/purchase` — purchase IDs with AutoPool + MY SYSTEM placement
- `GET /api/id-cards/tree/:memberId` — get member's ID cards with tree info

#### Known Issues
- `nodemon` sometimes shows "clean exit" — running `node src/server.js` directly works fine
- There may be a "vestauth" ad in terminal output from a dependency — ignore it
