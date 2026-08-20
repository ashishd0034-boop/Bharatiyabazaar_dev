const prisma = require("../src/lib/prisma");

async function inspectMember16() {
  const member = await prisma.member.findFirst({
    where: { OR: [{ memberCode: "BB10016" }, { memberCode: "BB10018" }] },
    include: { idCards: true, mainWallet: true }
  });
  console.log("Member record:", member);

  const counters = await prisma.systemCounter.findMany();
  console.log("Counters:", counters);

  const allMembers = await prisma.member.findMany({
    select: { id: true, memberCode: true, name: true, createdAt: true, idCards: { select: { cardNumber: true, type: true, acbStatus: true } } },
    orderBy: { memberCode: "asc" }
  });
  console.log("All members summary:");
  for (const m of allMembers) {
    console.log(`- ${m.memberCode} (${m.name}): Cards: ${m.idCards.map(c => `${c.cardNumber}(${c.type}, acb=${c.acbStatus})`).join(", ")}`);
  }
}

inspectMember16().catch(console.error).finally(() => prisma.$disconnect());
