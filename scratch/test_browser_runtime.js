const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:4000/api";

async function testPagesInBrowser() {
  console.log("=== SIMULATING BROWSER RUNTIME FOR ALL PAGES ===");

  // 1. Get auth token for BB10018 (sufh)
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10018", password: "password123" })
  }).then(r => r.json());

  const token = loginRes.data?.token;
  const loginContext = loginRes.data?.loginContext;

  const files = [
    "bb-dashboard.html",
    "bb-tree.html",
    "bb-autopool.html",
    "bb-wallet.html",
    "bb-rebirth.html",
    "bb-commissions.html"
  ];

  for (const file of files) {
    const filePath = path.join(__dirname, "../public", file);
    const html = fs.readFileSync(filePath, "utf-8");

    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      resources: "usable",
      url: `http://localhost:4000/${file}`
    });

    const window = dom.window;
    window.localStorage.setItem("jwt_token", token);
    window.localStorage.setItem("member", JSON.stringify(loginRes.data?.member));
    if (loginContext) {
      window.localStorage.setItem("loginContext", JSON.stringify(loginContext));
    }

    const errors = [];
    window.addEventListener("error", (event) => {
      errors.push({ message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, error: event.error });
    });

    // Wait 1.5s for page promises to settle
    await new Promise(r => setTimeout(r, 1500));

    console.log(`\nPage: ${file}`);
    if (errors.length === 0) {
      console.log(`  ✅ 0 JavaScript runtime errors!`);
    } else {
      console.error(`  ❌ ${errors.length} JavaScript error(s):`);
      for (const e of errors) {
        console.error(`     - ${e.message} at line ${e.lineno}:${e.colno}`);
        if (e.error?.stack) console.error(`       Stack: ${e.error.stack.split("\n")[0]}`);
      }
    }
  }
}

testPagesInBrowser().catch(console.error);
