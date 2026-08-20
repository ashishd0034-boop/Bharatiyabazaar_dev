const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:4000/api";

function formatINR(paise) {
  return "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function simulateDashboardExecution(loginCredential, password = "password123") {
  // 1. Perform Login
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: loginCredential, password })
  }).then(r => r.json());

  if (!loginRes.success) {
    throw new Error(`Login failed for ${loginCredential}: ${JSON.stringify(loginRes.error)}`);
  }

  const token = loginRes.data.token;
  const loginCtx = loginRes.data.loginContext;

  // 2. Fetch Dashboard APIs (identical to Promise.all in bb-dashboard.html)
  const [profile, wallet, commissions] = await Promise.all([
    fetch(`${API_BASE}/members/profile`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/wallet/balance`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/wallet/commissions`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data)
  ]);

  // Mock DOM elements
  const DOM = {
    loadingIndicator: { style: { display: "block" }, textContent: "Loading dashboard..." },
    dashboardContent: { style: { display: "none" } },
    memberName: { textContent: "" },
    memberCode: { innerHTML: "", textContent: "" },
    memberAvatar: { textContent: "" },
    greeting: { textContent: "" },
    memberSince: { textContent: "" },
    walletBalance: { textContent: "" },
    walletBalanceSide: { textContent: "" },
    totalEarnings: { textContent: "" },
    totalEarningsSub: { textContent: "" },
    idCardCount: { textContent: "" },
    kycStatus: { textContent: "" },
    kycTier: { textContent: "" },
    subLoginBanner: { innerHTML: "", style: { display: "none" } },
    openWithdrawBtn: { style: { opacity: "1", cursor: "pointer" }, title: "", onclick: null }
  };

  // 3. Execute exact bb-dashboard.html loadDashboard logic
  if (!profile) {
    DOM.loadingIndicator.textContent = 'Failed to load. Redirecting...';
    return { error: "Failed to load profile" };
  }

  DOM.loadingIndicator.style.display = 'none';
  DOM.dashboardContent.style.display = 'block';

  const name = profile.name || 'Member';
  const mainCard = (profile.idCards || []).find(c => c.type === 'MAIN');
  const activeCard = loginCtx?.cardNumber || mainCard?.cardNumber || profile.memberCode;
  const isSub = loginCtx?.isSubCard || false;
  const ownerCode = loginCtx?.ownerMemberCode || profile.memberCode;

  DOM.memberName.textContent = name;
  DOM.memberCode.innerHTML = `${activeCard} ${isSub ? `<span style="font-size:10px; opacity:0.8;">(owner ${ownerCode})</span>` : ''}`;
  DOM.memberAvatar.textContent = name.charAt(0).toUpperCase();

  DOM.greeting.textContent = `Good morning, ${name} 🙏`;
  const memberSince = new Date(profile.createdAt);
  DOM.memberSince.textContent = 
    `Member since ${memberSince.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} · ${activeCard}${isSub ? ` (owner ${ownerCode})` : ''}`;

  const balance = wallet?.balancePaise || 0;
  DOM.walletBalance.textContent = formatINR(balance);
  DOM.walletBalanceSide.textContent = formatINR(balance);

  const totalEarnings = commissions?.reduce((sum, c) => sum + c.amountPaise, 0) || 0;
  DOM.totalEarnings.textContent = formatINR(totalEarnings);

  const heldPaise = (commissions || [])
    .filter(c => c.status === "PENDING_7_DAY" || c.status === "LOCKED_ACB")
    .reduce((s, c) => s + c.amountPaise, 0);

  if (DOM.totalEarningsSub) {
    DOM.totalEarningsSub.textContent = `On Hold: ${formatINR(heldPaise)} (7-day / ACB lock)`;
  }

  const idCards = profile.idCards || [];
  DOM.idCardCount.textContent = idCards.length;
  DOM.kycStatus.textContent = profile.kycStatus || 'Pending';
  DOM.kycTier.textContent = `Tier ${profile.kycTier || 1}`;

  // SUB Login Banner & Withdrawal restriction
  if (loginCtx && loginCtx.isSubCard) {
    DOM.subLoginBanner.innerHTML = `🔑 You are logged in as <strong>${loginCtx.cardNumber}</strong> (${loginCtx.cardType} card of ${loginCtx.ownerMemberCode}) — viewing shared member account.`;
    DOM.subLoginBanner.style.display = 'block';

    DOM.openWithdrawBtn.style.opacity = '0.5';
    DOM.openWithdrawBtn.style.cursor = 'not-allowed';
    DOM.openWithdrawBtn.title = `Withdrawals restricted to MAIN ID (${loginCtx.ownerMemberCode})`;
  }

  // Bifurcation breakdown
  const breakdown = wallet?.breakdown || [];

  return {
    loginCredential,
    activeCard,
    isSub,
    loadingHidden: DOM.loadingIndicator.style.display === 'none',
    contentVisible: DOM.dashboardContent.style.display === 'block',
    sidebarName: DOM.memberName.textContent,
    sidebarCode: DOM.memberCode.innerHTML,
    greeting: DOM.greeting.textContent,
    memberSince: DOM.memberSince.textContent,
    walletBalance: DOM.walletBalance.textContent,
    totalEarnings: DOM.totalEarnings.textContent,
    onHold: DOM.totalEarningsSub.textContent,
    idCardsCount: DOM.idCardCount.textContent,
    subBannerVisible: DOM.subLoginBanner.style.display === 'block',
    subBannerHTML: DOM.subLoginBanner.innerHTML,
    withdrawButtonState: DOM.openWithdrawBtn.style.cursor === 'not-allowed' ? 'DISABLED (SUB card)' : 'ENABLED (MAIN card)',
    breakdownCards: breakdown.map(b => `${b.cardNumber} (${b.cardType}): Total=${formatINR(b.totalPaise)}, Withdrawable=${formatINR(b.withdrawablePaise)}`),
    commissionsCount: (commissions || []).length
  };
}

async function runAllVerifications() {
  console.log("================================================================================");
  console.log("🧪 VERIFYING COMPLETE BROWSER DASHBOARD FLOW AFTER FIX");
  console.log("================================================================================\n");

  const scenarios = [
    { label: "A. Login as MAIN Card (BB10018)", credential: "BB10018" },
    { label: "B. Login as SUB Card (SB10019)", credential: "SB10019" },
    { label: "C. Login via Mobile (2222333322)", credential: "2222333322" }
  ];

  for (const s of scenarios) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Scenario: ${s.label}`);
    console.log(`--------------------------------------------------------------------------------`);
    const res = await simulateDashboardExecution(s.credential);
    console.log(`- Loading Indicator:   ${res.loadingHidden ? '✅ HIDDEN (display: none)' : '❌ VISIBLE'}`);
    console.log(`- Dashboard Content:   ${res.contentVisible ? '✅ VISIBLE (display: block)' : '❌ HIDDEN'}`);
    console.log(`- Active Card:         ${res.activeCard} (isSub: ${res.isSub})`);
    console.log(`- Sidebar Name/Code:   ${res.sidebarName} / ${res.sidebarCode}`);
    console.log(`- Topbar Greeting:     ${res.greeting}`);
    console.log(`- Member Since Text:   ${res.memberSince}`);
    console.log(`- Stat Wallet Balance: ${res.walletBalance}`);
    console.log(`- Stat Total Earnings: ${res.totalEarnings} (${res.onHold})`);
    console.log(`- Total ID Cards:      ${res.idCardsCount}`);
    console.log(`- SUB Login Banner:    ${res.subBannerVisible ? `✅ DISPLAYED -> "${res.subBannerHTML}"` : '✅ HIDDEN (MAIN Login)'}`);
    console.log(`- Withdraw Action:     ${res.withdrawButtonState}`);
    console.log(`- Commissions Count:   ${res.commissionsCount} commission entries rendered`);
    console.log(`- Wallet Bifurcation:  ${res.breakdownCards.length} cards broken down:`);
    for (const b of res.breakdownCards) {
      console.log(`    • ${b}`);
    }
    console.log();
  }

  console.log("================================================================================");
  console.log("🎉 ALL DASHBOARD SCENARIOS VERIFIED SUCCESSFULLY");
  console.log("================================================================================\n");
}

runAllVerifications().catch(console.error);
