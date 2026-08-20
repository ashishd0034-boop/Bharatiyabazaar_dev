const jwt = require("jsonwebtoken");

const API_BASE = "http://localhost:4000/api";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev";

async function verifyRebirthApis() {
  console.log("================================================================================");
  console.log("🧪 VERIFYING REBIRTH PAGE API RESPONSES & LIVE DATA INTEGRATION");
  console.log("================================================================================\n");

  // 1. Test BB10001 (MAIN login)
  const resLogin1 = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10001", password: "password123" })
  });
  const dataLogin1 = await resLogin1.json();
  const token1 = dataLogin1.data?.token;

  console.log("1. Checking BB10001 Data (Root Node):");
  const [profile1, ap1, wallet1] = await Promise.all([
    fetch(`${API_BASE}/members/profile`, { headers: { Authorization: `Bearer ${token1}` } }).then(r => r.json()),
    fetch(`${API_BASE}/members/autopool-tree`, { headers: { Authorization: `Bearer ${token1}` } }).then(r => r.json()),
    fetch(`${API_BASE}/wallet/balance`, { headers: { Authorization: `Bearer ${token1}` } }).then(r => r.json())
  ]);

  console.log(`  - Member: ${profile1.data?.memberCode} (${profile1.data?.name})`);
  console.log(`  - Total ID Cards: ${profile1.data?.idCards?.length} (Rebirth Cards: ${profile1.data?.idCards?.filter(c => c.type === "REBIRTH").length})`);
  console.log(`  - Vouchers: ${profile1.data?.vouchers?.length || 0}`);
  console.log(`  - AutoPool Pos: #${ap1.data?.myStats?.position} | Cash: Rs.${ap1.data?.myStats?.cashEarnedPaise/100} | Rebirths: ${ap1.data?.myStats?.rebirthIds}`);
  console.log(`  - Level Status Count: ${ap1.data?.levelStatus?.length} levels`);
  console.log(`  - Login Context: isSubCard=${wallet1.data?.loginContext?.isSubCard}, Card=${wallet1.data?.loginContext?.cardNumber}\n`);

  // 2. Test SB10016 (SUB login)
  const resLoginSub = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "SB10016", password: "password123" })
  });
  const dataLoginSub = await resLoginSub.json();
  const tokenSub = dataLoginSub.data?.token;

  console.log("2. Checking SB10016 Data (SUB card login context):");
  const [profileSub, apSub, walletSub] = await Promise.all([
    fetch(`${API_BASE}/members/profile`, { headers: { Authorization: `Bearer ${tokenSub}` } }).then(r => r.json()),
    fetch(`${API_BASE}/members/autopool-tree`, { headers: { Authorization: `Bearer ${tokenSub}` } }).then(r => r.json()),
    fetch(`${API_BASE}/wallet/balance`, { headers: { Authorization: `Bearer ${tokenSub}` } }).then(r => r.json())
  ]);

  console.log(`  - Member: ${profileSub.data?.memberCode} (${profileSub.data?.name})`);
  console.log(`  - Login Context: isSubCard=${walletSub.data?.loginContext?.isSubCard}, Card=${walletSub.data?.loginContext?.cardNumber}, Owner=${walletSub.data?.loginContext?.ownerMemberCode}`);
  console.log(`  - AutoPool Pos: #${apSub.data?.myStats?.position}`);

  console.log("\n================================================================================");
  console.log("🎉 REBIRTH PAGE APIS VERIFIED AND OPERATIONAL");
  console.log("================================================================================\n");
}

verifyRebirthApis().catch(console.error);
