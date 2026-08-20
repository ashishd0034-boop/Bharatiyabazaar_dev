const API_BASE = "http://localhost:4000/api";

async function debugEndpoints() {
  const loginMain = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10018", password: "password123" })
  }).then(r => r.json());

  const tokenMain = loginMain.data.token;
  const eps = [
    "/members/profile",
    "/members/my-system-tree",
    "/members/autopool-tree",
    "/members/my-placement",
    "/members/my-referral-count",
    "/wallet/balance",
    "/wallet/commissions"
  ];

  for (const ep of eps) {
    const res = await fetch(`${API_BASE}${ep}`, {
      headers: { Authorization: `Bearer ${tokenMain}` }
    });
    console.log(`Endpoint: ${ep} -> Status: ${res.status}`);
    const text = await res.text();
    console.log(`  Response: ${text.slice(0, 120)}`);
  }
}

debugEndpoints().catch(console.error);
