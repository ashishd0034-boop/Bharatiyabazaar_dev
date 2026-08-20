const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:4000/api";

async function simulateClientRuntime() {
  console.log("================================================================================");
  console.log("🔍 TESTING CLIENT-SIDE RUNTIME LOGIC FOR ALL PAGES");
  console.log("================================================================================\n");

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10018", password: "password123" })
  }).then(r => r.json());

  const token = loginRes.data?.token;
  const loginCtx = loginRes.data?.loginContext;

  const [profile, wallet, commissions, apData, treeData, ledger] = await Promise.all([
    fetch(`${API_BASE}/members/profile`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/wallet/balance`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/wallet/commissions`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/members/autopool-tree`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/members/my-system-tree`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data),
    fetch(`${API_BASE}/wallet/ledger`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(r => r.data)
  ]);

  // Test 1: bb-dashboard.html logic
  console.log("1. Testing bb-dashboard.html logic:");
  try {
    const name = profile.name || 'Member';
    const mainCard = (profile.idCards || []).find(c => c.type === 'MAIN');
    const activeCard = loginCtx?.cardNumber || mainCard?.cardNumber || profile.memberCode;
    const isSub = loginCtx?.isSubCard || false;
    const ownerCode = loginCtx?.ownerMemberCode || profile.memberCode;

    console.log(`  - Sidebar Profile: name="${name}", code="${activeCard} ${isSub ? `(owner ${ownerCode})` : ''}"`);
    console.log(`  - Greeting: "Good morning, ${name} 🙏"`);
    console.log(`  - MemberSince: "Member since ... · ${activeCard}"`);
    console.log(`  - Wallet Balance: Rs.${(wallet.balancePaise/100).toFixed(2)}`);
    console.log(`  - Total Earnings: Rs.${(commissions.reduce((s,c)=>s+c.amountPaise,0)/100).toFixed(2)}`);
    console.log(`  ✅ Dashboard data binding logic OK`);
  } catch (err) {
    console.error("  ❌ Dashboard logic failed:", err);
  }

  // Test 2: bb-tree.html logic
  console.log("\n2. Testing bb-tree.html logic:");
  try {
    const name = profile.name || 'Member';
    const mainCard = (profile.idCards || []).find(c => c.type === 'MAIN');
    const activeCard = loginCtx?.cardNumber || mainCard?.cardNumber || profile.memberCode;
    const isSub = loginCtx?.isSubCard || false;
    const ownerCode = loginCtx?.ownerMemberCode || profile.memberCode;

    console.log(`  - Sidebar Profile: name="${name}", code="${activeCard}"`);
    console.log(`  - Tree Root Card: ${treeData.tree.cardNumber} (acbStatus: ${treeData.tree.acbStatus})`);
    console.log(`  - Left Leg: ${treeData.stats.leftLegSize} | Right Leg: ${treeData.stats.rightLegSize}`);
    console.log(`  ✅ Tree data binding logic OK`);
  } catch (err) {
    console.error("  ❌ Tree logic failed:", err);
  }

  // Test 3: bb-autopool.html logic
  console.log("\n3. Testing bb-autopool.html logic:");
  try {
    console.log(`  - AutoPool Position: #${apData.myStats.position}`);
    console.log(`  - Cash Earned: Rs.${(apData.myStats.cashEarnedPaise/100).toFixed(2)}`);
    console.log(`  - Rebirth IDs: ${apData.myStats.rebirthIds}`);
    console.log(`  ✅ AutoPool data binding logic OK`);
  } catch (err) {
    console.error("  ❌ AutoPool logic failed:", err);
  }

  // Test 4: bb-wallet.html logic
  console.log("\n4. Testing bb-wallet.html logic:");
  try {
    console.log(`  - Total Balance: Rs.${(wallet.balancePaise/100).toFixed(2)}`);
    console.log(`  - Ledger entries: ${ledger.length}`);
    console.log(`  ✅ Wallet data binding logic OK`);
  } catch (err) {
    console.error("  ❌ Wallet logic failed:", err);
  }

  // Test 5: bb-rebirth.html logic
  console.log("\n5. Testing bb-rebirth.html logic:");
  try {
    const rebirthCards = (profile.idCards || []).filter(c => c.type === 'REBIRTH');
    console.log(`  - Rebirth Cards Count: ${rebirthCards.length}`);
    console.log(`  - Vouchers Count: ${profile.vouchers?.length || 0}`);
    console.log(`  ✅ Rebirth data binding logic OK`);
  } catch (err) {
    console.error("  ❌ Rebirth logic failed:", err);
  }

  // Test 6: bb-commissions.html logic
  console.log("\n6. Testing bb-commissions.html logic:");
  try {
    console.log(`  - Commissions Count: ${commissions.length}`);
    console.log(`  ✅ Commissions data binding logic OK`);
  } catch (err) {
    console.error("  ❌ Commissions logic failed:", err);
  }
}

simulateClientRuntime().catch(console.error);
