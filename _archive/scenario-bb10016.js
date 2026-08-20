const prisma = require("./src/lib/prisma");

const API = "http://localhost:4000/api";
const MOBILE = "9876500015";
const PASSWORD = "password123";

async function post(path, body, token) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function main() {
  console.log("\n🎬 SCENARIO: New member registers with 10 IDs starting at BB10016\n");

  // Sync MEMBER_CODE counter so next member = BB10016
  await prisma.systemCounter.update({
    where: { id: "MEMBER_CODE" },
    data: { currentValue: 10015 }
  });
  console.log("✅ MEMBER_CODE synced to 10015 (next member = BB10016)");

  // Step 1: Register (creates MAIN + 1 SUB... wait, we need 10 total)
  // Register with count=1 first (MAIN only)
  const reg = await post("/auth/register", {
    name: "Ten ID Member",
    mobile: MOBILE,
    password: PASSWORD,
    referralCode: "BB10001",
    side: "LEFT"
  });

  if (!reg.success) {
    console.log("❌ Registration failed:", JSON.stringify(reg, null, 2));
    return;
  }

  const token = reg.data.token;
  const mainCode = reg.data.member.memberCode;
  console.log("✅ MAIN ID created:", mainCode);

  // Step 2: Buy 9 more SUBs (bulk mode triggers tree-sponsor rule)
  const buy = await post("/idcards/purchase-additional", { count: 9 }, token);
  if (buy.success) {
    console.log("✅ +" + buy.data.purchased + " SUB IDs created via bulk mode");
  } else {
    console.log("❌ Bulk purchase failed:", JSON.stringify(buy, null, 2));
    return;
  }

  // Step 3: Full placement report
  const cards = await prisma.memberIdCard.findMany({
    where: { member: { mobile: MOBILE } },
    orderBy: { cardNumber: "asc" },
    include: {
      mySystemNode: {
        include: {
          parent: { include: { idCard: { include: { member: { select: { memberCode: true } } } } } },
          sponsorCard: { include: { member: { select: { memberCode: true } } } }
        }
      },
      autoPoolNode: true
    }
  });

  console.log("\n📋 COMPLETE PLACEMENT REPORT — 10 IDs\n");
  console.log("CARD      TYPE    SPONSORED BY    PLACED UNDER         POOL  ACB");
  console.log("─────────────────────────────────────────────────────────────────");
  for (const c of cards) {
    const n = c.mySystemNode;
    const sponsor = (n && n.sponsorCard && n.sponsorCard.member) ? n.sponsorCard.member.memberCode : "—";
    const parent  = (n && n.parent && n.parent.idCard) ? n.parent.idCard.member.memberCode : "ROOT";
    const side    = (n && n.side) ? n.side : "ROOT";
    const pool    = c.autoPoolNode ? "#" + c.autoPoolNode.globalPosition : "—";
    const acb     = c.acbStatus ? "✅" : "❌";
    console.log(
      c.cardNumber.padEnd(9) + " " + c.type.padEnd(7) + " " + sponsor.padEnd(15) + " " + (parent + " (" + side + ")").padEnd(20) + " " + pool.padEnd(5) + " " + acb
    );
  }

  console.log("\n🔓 ACB Status per card:");
  for (const c of cards) {
    console.log(`  ${c.cardNumber} (${c.type}): ${c.acbStatus ? "✅ ACB UNLOCKED" : "❌ Pending"}`);
  }

  await prisma.$disconnect();
}
main();