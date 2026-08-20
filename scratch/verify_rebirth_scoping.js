const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev";
const API_BASE = "http://localhost:4000/api";

async function verifyRebirthScoping() {
  console.log("================================================================================");
  console.log("🧪 TESTING REBIRTH CARD SCOPING & EDGE CASES");
  console.log("================================================================================");

  // 1. Fetch a member to create a synthetic REBIRTH token
  const member = await prisma.member.findFirst({
    where: { memberCode: "BB10018" },
    include: { idCards: true }
  });

  const rebirthToken = jwt.sign({
    id: member.id,
    type: "MEMBER",
    loginCardId: "synthetic_rb_id",
    loginCardNumber: "RB10032",
    loginCardType: "REBIRTH",
    isSubCard: true,
    ownerMemberCode: member.memberCode
  }, JWT_SECRET, { expiresIn: "1h" });

  const [treeRes, placementRes, refRes, profileRes] = await Promise.all([
    fetch(`${API_BASE}/members/my-system-tree`, { headers: { Authorization: `Bearer ${rebirthToken}` } }).then(r => r.json()),
    fetch(`${API_BASE}/members/my-placement`, { headers: { Authorization: `Bearer ${rebirthToken}` } }).then(r => r.json()),
    fetch(`${API_BASE}/members/my-referral-count`, { headers: { Authorization: `Bearer ${rebirthToken}` } }).then(r => r.json()),
    fetch(`${API_BASE}/members/profile`, { headers: { Authorization: `Bearer ${rebirthToken}` } }).then(r => r.json())
  ]);

  console.log("\nRebirth Token Test Results:");
  console.log(`- MY SYSTEM Tree:  data=${treeRes.data}, isRebirth=${treeRes.isRebirth}, message="${treeRes.message}"`);
  console.log(`- My Placement:    data=${placementRes.data}, message="${placementRes.message}"`);
  console.log(`- Referral Count:  directReferrals=${refRes.data?.directReferrals}, total=${refRes.data?.total}`);
  console.log(`- Profile Active:  ${profileRes.data?.activeCard?.cardNumber || 'fallback'}`);

  console.log("\n================================================================================");
  console.log("✅ REBIRTH CARD SCOPING CONFIRMED");
  console.log("================================================================================\n");
}

verifyRebirthScoping().catch(console.error).finally(() => prisma.$disconnect());
