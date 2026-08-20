const prisma = require("../src/lib/prisma");

async function cleanupTest() {
  const testMobile = "9999000001";
  const existing = await prisma.member.findUnique({
    where: { mobile: testMobile },
    include: { idCards: true }
  });

  if (existing) {
    await prisma.mySystemNode.deleteMany({ where: { idCard: { memberId: existing.id } } });
    await prisma.autoPoolNode.deleteMany({ where: { idCard: { memberId: existing.id } } });
    await prisma.commissionEntry.deleteMany({ where: { idCard: { memberId: existing.id } } });
    await prisma.memberIdCard.deleteMany({ where: { memberId: existing.id } });
    await prisma.wallet.deleteMany({ where: { memberId: existing.id } });
    await prisma.member.delete({ where: { id: existing.id } });
    console.log("✅ Cleaned up test member 9999000001.");
  }

  await prisma.systemCounter.update({ where: { id: "AUTOPOOL_GLOBAL" }, data: { currentValue: 24 } });
  console.log("✅ SystemCounter AUTOPOOL_GLOBAL set to 24.");
}

cleanupTest().catch(console.error).finally(() => prisma.$disconnect());
