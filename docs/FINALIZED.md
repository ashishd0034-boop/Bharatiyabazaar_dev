# Bharatiya Bazaar — Finalized Behaviors & Invariants Register

> [!IMPORTANT]
> **PROTOCOL RULE**: Any future change touching a frozen behavior requires explicit owner **APPROVED** before implementation. Antigravity must check this file at Stage 1 of every future task.

---

## 1. Single Source of Truth for Sidebar & Identity (`MemberShell`)
- **Authority**: The server-resolved JWT token (`req.loginContext`) decoded on `/api/members/profile` and `/api/wallet/balance` is the absolute authority for active identity.
- **Client Rendering**: All 10 member pages (`bb-dashboard`, `bb-tree`, `bb-wallet`, `bb-commissions`, `bb-autopool`, `bb-setu-kosh`, `bb-rebirth`, `bb-notifications`, `bb-calculator`, `bb-hindi`) delegate identity rendering exclusively to `public/js/member-shell.js` (`initMemberIdentity`). No page may render sidebar/header identity independently.
- **Badge Consistency**:
  - **MAIN ID**: Displays clean member code / active card number (e.g. `BB10011`).
  - **SUB ID**: Displays active card with sub-owner annotation: `SB10002 (owner BB10001)`.
  - **REBIRTH ID**: Displays active card with ACB exemption badge: `RB10001 ACB not required`.
- **Card Switching**: Switching between MAIN / SUB / REBIRTH cards in the dashboard uses `MemberShell.setLoginContext(newContext)`, persisting across all 10 member pages.

---

## 2. Strict Session & Storage Hygiene
- **Login Flow**: Atomically clears all previous session data (`clearAllSessionData()`), writes `jwt_token`, `member`, and sets `loginContext` matching the active authenticated card.
- **Registration Flow**: Atomically clears previous session data, writes `jwt_token`, `member`, and initializes `loginContext` to the fresh `MAIN` ID.
- **Logout Flow**: Calling `logout()` or `clearAllSessionData()` completely purges ALL identity and token keys:
  - `jwt_token`
  - `bb_token`
  - `member`
  - `loginContext`
  - `admin_token`
  - `bb_admin_token`
  - `bb_vendor_token`
  (both in `localStorage` and `sessionStorage`).

---

## 3. Referral Links & Sponsor Blocking Rules
- **Dynamic Active Card Sponsoring**: Referral links generated in the dashboard dynamically use the currently active `MAIN` or `SUB` card ID (`?ref=SB10002&side=LEFT`).
- **REBIRTH Sponsor Blocking**: `REBIRTH` cards (`RB...`) are placed automatically via global AutoPool and are **strictly blocked** from generating referral links or sponsoring new members (both client-side validation and backend `/api/auth/validate-referral` rejection).

---

## 4. ACB v3 Rules (Active Commission Beneficiary)
- **Per-Card ACB Criterion**: ACB qualification is evaluated per individual card. Qualifying card $A$ requires 1 direct left + 1 direct right sponsored specifically by card $A$.
- **No Inheritance**: SUB IDs do **not** inherit ACB unlocked status from the parent MAIN ID.
- **REBIRTH Exemption**: `REBIRTH` IDs are structurally exempt from ACB requirements and receive AutoPool payouts without sponsoring criteria.
- **UI Status**: Badges dynamically render `ACB` (green), `Pending` (amber), or `ACB not required` (neutral/muted for REBIRTH).

---

## 5. Commission Grouping & Maturity Sweep
- **Commission Table Grouping**: Commission tables group entries logically: `MAIN` first, `SUB` cards sorted ascending by card number, `REBIRTH` cards sorted ascending by card number.
- **7-Day Maturity Sweep**: Daily cron sweeps pending commissions older than 7 days, releasing them to withdrawable balance if ACB status is met or holding them if ACB is pending.

---

## 6. Financial & Ledger Invariants
- **Double-Entry Ledger**: Every financial transaction must have a corresponding balancing entry. System total debits must always equal total credits.
- **Company Reserve Wallet**: System commissions, ID sales, and administrative fee deductions must credit the designated company reserve wallet.
- **Withdrawal Constraints**: Withdrawals can only be initiated when authenticated as the `MAIN` card. SUB card login contexts are blocked from initiating payouts.

---

## 7. Route & Authorization Table
- **JWT Identity Scoping**: All member endpoints scope data strictly by `req.member.id` and `req.loginContext`. No endpoint may accept a foreign `memberId` or `cardNumber` without server-side ownership verification (yielding `403 FORBIDDEN`).
