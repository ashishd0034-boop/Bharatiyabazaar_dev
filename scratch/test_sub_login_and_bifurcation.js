const jwt = require("jsonwebtoken");

const API_BASE = "http://localhost:4000/api";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev";

async function runTests() {
  console.log("================================================================================");
  console.log("🧪 VERIFYING SUB CARD LOGIN, WALLET BIFURCATION & WITHDRAWAL GUARDS");
  console.log("================================================================================\n");

  let allPassed = true;

  // 1. Test Login with SUB Card SB10016
  console.log("TEST 1: Login with SUB Card SB10016");
  const resSub = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "SB10016", password: "password123" })
  });
  const dataSub = await resSub.json();
  
  const test1Pass = (
    resSub.status === 200 &&
    dataSub.success &&
    dataSub.data?.loginContext?.cardNumber === "SB10016" &&
    dataSub.data?.loginContext?.cardType === "SUB" &&
    dataSub.data?.loginContext?.isSubCard === true &&
    dataSub.data?.loginContext?.ownerMemberCode === "BB10015"
  );
  console.log(`  - Status: ${resSub.status} | isSubCard: ${dataSub.data?.loginContext?.isSubCard} | Card: ${dataSub.data?.loginContext?.cardNumber} | Owner: ${dataSub.data?.loginContext?.ownerMemberCode}`);
  console.log(`  - Result: ${test1Pass ? "✅ PASS" : "❌ FAIL"}\n`);
  if (!test1Pass) allPassed = false;

  const subToken = dataSub.data?.token;

  // 2. Test Login with MAIN Card BB10015
  console.log("TEST 2: Login with MAIN Card BB10015");
  const resMain = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10015", password: "password123" })
  });
  const dataMain = await resMain.json();

  const test2Pass = (
    resMain.status === 200 &&
    dataMain.success &&
    dataMain.data?.loginContext?.cardNumber === "BB10015" &&
    dataMain.data?.loginContext?.cardType === "MAIN" &&
    dataMain.data?.loginContext?.isSubCard === false
  );
  console.log(`  - Status: ${resMain.status} | isSubCard: ${dataMain.data?.loginContext?.isSubCard} | Card: ${dataMain.data?.loginContext?.cardNumber}`);
  console.log(`  - Result: ${test2Pass ? "✅ PASS" : "❌ FAIL"}\n`);
  if (!test2Pass) allPassed = false;

  const mainToken = dataMain.data?.token;

  // 3. Test Login with Mobile (1010101010)
  console.log("TEST 3: Login with Registered Mobile (1010101010)");
  const resMob = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "1010101010", password: "password123" })
  });
  const dataMob = await resMob.json();

  const test3Pass = (
    resMob.status === 200 &&
    dataMob.success &&
    dataMob.data?.member?.memberCode === "BB10015"
  );
  console.log(`  - Status: ${resMob.status} | Member: ${dataMob.data?.member?.memberCode} (${dataMob.data?.member?.name})`);
  console.log(`  - Result: ${test3Pass ? "✅ PASS" : "❌ FAIL"}\n`);
  if (!test3Pass) allPassed = false;

  // 4. Test Wallet Balance & Bifurcation via SUB Token
  console.log("TEST 4: Wallet Balance & Bifurcation via SUB Token");
  const resBal = await fetch(`${API_BASE}/wallet/balance`, {
    headers: { "Authorization": `Bearer ${subToken}` }
  });
  const dataBal = await resBal.json();

  const breakdown = dataBal.data?.breakdown || [];
  const sb10016Row = breakdown.find(b => b.cardNumber === "SB10016");
  const bb10015Row = breakdown.find(b => b.cardNumber === "BB10015");

  const test4Pass = (
    resBal.status === 200 &&
    breakdown.length === 3 &&
    sb10016Row?.isCurrentLogin === true &&
    bb10015Row?.isCurrentLogin === false
  );
  console.log(`  - Breakdown Cards Count: ${breakdown.length}`);
  breakdown.forEach(b => {
    console.log(`    • ${b.cardNumber} (${b.cardType}) | Withdrawable: Rs.${b.withdrawablePaise/100} | On-Hold: Rs.${b.onHoldPaise/100} | Total: Rs.${b.totalPaise/100} | Current: ${b.isCurrentLogin}`);
  });
  console.log(`  - Result: ${test4Pass ? "✅ PASS" : "❌ FAIL"}\n`);
  if (!test4Pass) allPassed = false;

  // 5. Test Withdrawal Guard via SUB Token (Expected 403)
  console.log("TEST 5: Withdrawal Attempt via SUB Token (Security Guard)");
  const resWithdrawSub = await fetch(`${API_BASE}/wallet/withdraw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${subToken}`
    },
    body: JSON.stringify({ amountPaise: 10000, method: "BANK" })
  });
  const dataWithdrawSub = await resWithdrawSub.json();

  const test5Pass = (
    resWithdrawSub.status === 403 &&
    dataWithdrawSub.error?.code === "FORBIDDEN_SUB_CARD"
  );
  console.log(`  - HTTP Status: ${resWithdrawSub.status} (Expected 403)`);
  console.log(`  - Error Code: ${dataWithdrawSub.error?.code}`);
  console.log(`  - Message: "${dataWithdrawSub.error?.message}"`);
  console.log(`  - Result: ${test5Pass ? "✅ PASS (Correctly Blocked)" : "❌ FAIL"}\n`);
  if (!test5Pass) allPassed = false;

  // 6. Test Legacy JWT Fallback
  console.log("TEST 6: Legacy JWT Backward Compatibility");
  const legacyToken = jwt.sign({ id: dataMain.data.member.id, type: "MEMBER" }, JWT_SECRET, { expiresIn: "1d" });
  const resLegacy = await fetch(`${API_BASE}/wallet/balance`, {
    headers: { "Authorization": `Bearer ${legacyToken}` }
  });
  const dataLegacy = await resLegacy.json();

  const test6Pass = (
    resLegacy.status === 200 &&
    dataLegacy.data?.loginContext?.isSubCard === false &&
    dataLegacy.data?.loginContext?.cardType === "MAIN"
  );
  console.log(`  - Legacy Token Fallback: isSubCard=${dataLegacy.data?.loginContext?.isSubCard}, cardType=${dataLegacy.data?.loginContext?.cardType}`);
  console.log(`  - Result: ${test6Pass ? "✅ PASS" : "❌ FAIL"}\n`);
  if (!test6Pass) allPassed = false;

  console.log("================================================================================");
  console.log(`OVERALL VERIFICATION RESULT: ${allPassed ? "🎉 100% ALL 6 TEST SCENARIOS PASSED" : "❌ SOME TESTS FAILED"}`);
  console.log("================================================================================\n");
}

runTests().catch(console.error);
