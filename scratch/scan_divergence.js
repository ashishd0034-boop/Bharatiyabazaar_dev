const prisma = require("../src/lib/prisma");

async function scanDivergentMembers() {
  const members = await prisma.member.findMany({
    include: {
      idCards: true
    },
    orderBy: { createdAt: "asc" }
  });

  console.log(`Total members: ${members.length}`);
  const divergent = [];

  for (const m of members) {
    const mainCard = m.idCards.find(c => c.type === "MAIN");
    if (!mainCard) {
      console.log(`⚠️ Member ${m.memberCode} (${m.name}) has NO MAIN CARD!`);
    } else if (m.memberCode !== mainCard.cardNumber) {
      console.log(`❌ DIVERGENCE: Member ${m.name} has memberCode="${m.memberCode}", but MAIN card="${mainCard.cardNumber}" (id=${m.id})`);
      divergent.push({
        id: m.id,
        name: m.name,
        currentMemberCode: m.memberCode,
        mainCardNumber: mainCard.cardNumber
      });
    } else {
      console.log(`✅ MATCH: Member ${m.name} -> memberCode="${m.memberCode}" == MAIN="${mainCard.cardNumber}"`);
    }
  }

  console.log("\nSummary of divergent members:", divergent);
}

scanDivergentMembers().catch(console.error).finally(() => prisma.$disconnect());
