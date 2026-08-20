const prisma = require("../src/lib/prisma");

const API_BASE = "http://localhost:4000/api";

async function testRegistrationParity() {
  console.log("================================================================================");
  console.log("🧪 TESTING NEW MEMBER REGISTRATION PARITY & NO TEMP_ CODE IN RESPONSE");
  console.log("================================================================================\n");

  const testMobile = "9999000001";
  // Clean up if already exists
  const existing = await prisma.member.findUnique({ where: { mobile: testMobile } });
  if (existing) {
    await prisma.mySystemNode.deleteMany({ where: { idCard: { memberId: existing.id } } });
    await prisma.autoPoolNode.deleteMany({ where: { idCard: { memberId: existing.id } } });
    await prisma.commissionEntry.deleteMany({ where: { memberId: existing.id } });
    await prisma.memberIdCard.deleteMany({ where: { memberId: existing.id } });
    await prisma.wallet.deleteMany({ where: { memberId: existing.id } });
    await prisma.member.delete({ where: { id: existing.id } });
  }

  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Test Member",
      mobile: testMobile,
      email: "newtest@example.com",
      password: "password123",
      referralCode: "BB10001",
      side: "LEFT"
    })
  });

  const json = await res.json();
  console.log("Registration Response Data:", json.data);

  const registeredCode = json.data?.member?.memberCode;
  const isTemp = registeredCode?.startsWith("TEMP_");

  console.log(`\n- Returned memberCode: ${registeredCode}`);
  console.log(`- Is Temporary Code:   ${isTemp ? '❌ YES (BUG)' : '✅ NO (CLEAN PERMANENT CODE)'}`);
  console.log(`- Login Context Card:  ${json.data?.loginContext?.cardNumber}`);

  const dbMember = await prisma.member.findUnique({
    where: { mobile: testMobile },
    include: { idCards: true }
  });

  const mainCard = dbMember.idCards.find(c => c.type === "MAIN");
  console.log(`- DB Member Code:      ${dbMember.memberCode}`);
  console.log(`- DB MAIN Card Number: ${mainCard?.cardNumber}`);
  console.log(`- Member/Card Match:   ${dbMember.memberCode === mainCard?.cardNumber ? '✅ 1:1:1 PARITY CONFIRMED' : '❌ MISMATCH'}\n`);

  // Clean up test member to leave DB in exact state
  await prisma.mySystemNode.deleteMany({ where: { idCard: { memberId: dbMember.id } } });
  await prisma.autoPoolNode.deleteMany({ where: { idCard: { memberId: dbMember.id } } });
  await prisma.commissionEntry.deleteMany({ where: { memberId: dbMember.id } });
  await prisma.memberIdCard.deleteMany({ where: { memberId: dbMember.id } });
  await prisma.wallet.deleteMany({ where: { memberId: dbMember.id } });
  await prisma.member.delete({ where: { id: dbMember.id } });

  // Reset AUTOPOOL_GLOBAL counter to 24
  await prisma.systemCounter.update({ where: { id: "AUTOPOOL_GLOBAL" }, data: { currentValue: 24 } });
  console.log("🧹 Cleaned up test member and reset AUTOPOOL_GLOBAL to 24.\n");
}

testRegistrationParity().catch(console.error).finally(() => prisma.$disconnect());
