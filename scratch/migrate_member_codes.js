const prisma = require("../src/lib/prisma");

async function runMigration() {
  console.log("================================================================================");
  console.log("🔄 EXECUTING MEMBER CODE MIGRATION (ALIGNING memberCode == MAIN cardNumber)");
  console.log("================================================================================\n");

  const members = await prisma.member.findMany({
    include: {
      idCards: true
    }
  });

  const updates = [];

  for (const m of members) {
    const mainCard = m.idCards.find(c => c.type === "MAIN");
    if (!mainCard) {
      console.log(`⚠️ Member ${m.name} (${m.memberCode}) has no MAIN card!`);
      continue;
    }

    if (m.memberCode !== mainCard.cardNumber) {
      const oldCode = m.memberCode;
      const newCode = mainCard.cardNumber;
      console.log(`🔧 Migrating Member ${m.name} (id=${m.id}):`);
      console.log(`   Old memberCode: ${oldCode}`);
      console.log(`   New memberCode: ${newCode}`);

      await prisma.member.update({
        where: { id: m.id },
        data: { memberCode: newCode }
      });

      updates.push({ memberId: m.id, oldCode, newCode });
    }
  }

  // Delete retired MEMBER_CODE counter
  const deletedCounter = await prisma.systemCounter.deleteMany({
    where: { id: "MEMBER_CODE" }
  });
  console.log(`\n🗑️ Retired MEMBER_CODE SystemCounter (${deletedCounter.count} rows deleted).`);

  console.log(`\n✅ Migration successfully updated ${updates.length} divergent member(s).\n`);
  return updates;
}

runMigration().catch(console.error).finally(() => prisma.$disconnect());
