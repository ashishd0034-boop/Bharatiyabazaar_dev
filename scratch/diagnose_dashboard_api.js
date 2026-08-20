const API_BASE = "http://localhost:4000/api";

async function diagnoseApis() {
  console.log("=== TESTING LOGIN & ENDPOINTS FOR BB10001 ===");
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10001", password: "password123" })
  });
  console.log(`Login status: ${loginRes.status}`);
  const loginData = await loginRes.json();
  console.log("Login data:", JSON.stringify(loginData, null, 2));

  const token = loginData.data?.token;
  if (!token) {
    console.error("❌ No token returned from login!");
    return;
  }

  const endpoints = [
    "/members/profile",
    "/wallet/balance",
    "/wallet/commissions",
    "/members/autopool-tree",
    "/members/my-system-tree",
    "/wallet/ledger"
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${API_BASE}${ep}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`\nEndpoint: ${ep} -> Status: ${res.status}`);
      const body = await res.text();
      console.log(`Response (first 300 chars): ${body.slice(0, 300)}`);
    } catch (err) {
      console.error(`❌ Error calling ${ep}:`, err);
    }
  }
}

diagnoseApis().catch(console.error);
