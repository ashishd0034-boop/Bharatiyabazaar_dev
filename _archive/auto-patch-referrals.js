const fs = require("fs");

// ---------- 1. Controller: add getMyReferralCount ----------
const CTRL = "src/controllers/memberController.js";
let ctrl = fs.readFileSync(CTRL, "utf8");
if (ctrl.includes("getMyReferralCount")) {
  console.log("⏭️  Controller already patched — skipping.");
} else {
  fs.writeFileSync(CTRL + ".bak2", ctrl);
  ctrl += `
// 🆕 Total IDs this member has sponsored (true direct referrals)
async function getMyReferralCount(req, res, next) {
  try {
    const mainCard = await prisma.memberIdCard.findFirst({
      where: { memberId: req.member.id, type: "MAIN" }
    });
    if (!mainCard) return res.json({ success: true, data: { directReferrals: 0 } });

    const count = await prisma.mySystemNode.count({
      where: { sponsorIdCardId: mainCard.id }
    });

    res.json({ success: true, data: { directReferrals: count } });
  } catch (err) {
    next(err);
  }
}

module.exports.getMyReferralCount = getMyReferralCount;
`;
  fs.writeFileSync(CTRL, ctrl);
  console.log("✅ Controller patched with getMyReferralCount.");
}

// ---------- 2. Routes: add /my-referrals ----------
const ROUTES = "src/routes/memberRoutes.js";
let routes = fs.readFileSync(ROUTES, "utf8");
if (routes.includes("my-referrals")) {
  console.log("⏭️  Route already exists — skipping.");
} else {
  const routerMatch = routes.match(/module\.exports\s*=\s*([A-Za-z0-9_]+)\s*;/);
  const ctrlMatch  = routes.match(/const\s+([A-Za-z0-9_]+)\s*=\s*require\([^)]*memberController[^)]*\)/);
  const authMatch  = routes.match(/const\s+([A-Za-z0-9_]+)\s*=\s*require\([^)]*(auth|Auth)[^)]*\)/);
  if (!routerMatch || !ctrlMatch || !authMatch) {
    console.log("❌ Safety stop on routes file — nothing changed there.");
    process.exit(1);
  }
  fs.writeFileSync(ROUTES + ".bak2", routes);
  routes += "\n" + routerMatch[1] + ".get(\"/my-referrals\", " + authMatch[1] + ", " + ctrlMatch[1] + ".getMyReferralCount);\n";
  fs.writeFileSync(ROUTES, routes);
  console.log("✅ Route /my-referrals added.");
}

// ---------- 3. Dashboard: Direct Referrals = sponsored count ----------
const candidates = ["public/bb-dashboard.html", "bb-dashboard.html", "src/public/bb-dashboard.html", "frontend/bb-dashboard.html"];
const dashPath = candidates.find(p => fs.existsSync(p));
if (!dashPath) {
  console.log("❌ Could not locate bb-dashboard.html. Tried: " + candidates.join(", "));
  process.exit(1);
}
let dash = fs.readFileSync(dashPath, "utf8");
if (dash.includes("apiCall('/members/my-referrals')")) {
  console.log("⏭️  Dashboard already updated — skipping.");
} else {
  const a = "const [ap, ms, commissions] = await Promise.all([";
  const b = "apiCall('/members/my-system-tree'),\n        apiCall('/wallet/commissions')\n      ]);";
  const c = "const direct = (ms.stats.hasDirectLeft ? 1 : 0) + (ms.stats.hasDirectRight ? 1 : 0);";

  if (!dash.includes(a) || !dash.includes(b) || !dash.includes(c)) {
    console.log("❌ Dashboard snippet didn't match exactly — file left UNCHANGED.");
    console.log("   Paste your bb-dashboard.html to me and I'll return the full updated file.");
    process.exit(1);
  }

  fs.writeFileSync(dashPath + ".bak2", dash);
  dash = dash.replace(a, "const [ap, ms, commissions, refs] = await Promise.all([");
  dash = dash.replace(b, "apiCall('/members/my-system-tree'),\n        apiCall('/wallet/commissions'),\n        apiCall('/members/my-referrals')\n      ]);");
  dash = dash.replace(c, "const direct = refs ? refs.directReferrals : 0;");
  fs.writeFileSync(dashPath, dash);
  console.log("✅ Dashboard updated: Direct Referrals = total sponsored IDs.");
}

console.log("\n🎉 All patches applied! Nodemon restarts automatically.");
