const prisma = require("../src/lib/prisma");

async function checkTopology() {
  console.log("=== MEMBERS ===");
  const members = await prisma.member.findMany({
    where: {
      OR: [
        { memberCode: { in: ["BB10016", "BB10018"] } },
        { idCards: { some: { cardNumber: { in: ["BB10016", "BB10018", "SB10019", "SB10020"] } } } }
      ]
    },
    include: {
      idCards: {
        include: {
          mySystemNode: true,
          autoPoolNode: true
        }
      }
    }
  });

  for (const m of members) {
    console.log(`Member: id=${m.id}, memberCode=${m.memberCode}, name=${m.name}, mobile=${m.mobile}`);
    for (const c of m.idCards) {
      console.log(`  Card: id=${c.id}, cardNumber=${c.cardNumber}, type=${c.type}, acbStatus=${c.acbStatus}, acbUnlockedAt=${c.acbUnlockedAt}`);
      console.log(`    MySystemNode: id=${c.mySystemNode?.id}, parentNodeId=${c.mySystemNode?.parentNodeId}, side=${c.mySystemNode?.side}, sponsorIdCardId=${c.mySystemNode?.sponsorIdCardId}`);
    }
  }

  console.log("\n=== SPECIFIC CARDS ===");
  const cards = await prisma.memberIdCard.findMany({
    where: {
      cardNumber: { in: ["BB10016", "BB10018", "SB10019", "SB10020"] }
    },
    include: {
      member: true,
      mySystemNode: true
    }
  });

  for (const c of cards) {
    console.log(`Card ${c.cardNumber}: type=${c.type}, acbStatus=${c.acbStatus}, ownerMemberCode=${c.member.memberCode}, ownerName=${c.member.name}`);
    // Check direct referrals of this card in MySystem
    const referrals = await prisma.mySystemNode.findMany({
      where: { sponsorIdCardId: c.id },
      include: { idCard: true }
    });
    console.log(`  Direct Referrals count: ${referrals.length}`);
    for (const r of referrals) {
      console.log(`    -> Ref Card: ${r.idCard.cardNumber}, Side: ${r.side}, PlacementType: ${r.placementType}`);
    }
    // Check placement children of this card in MySystem
    if (c.mySystemNode) {
      const children = await prisma.mySystemNode.findMany({
        where: { parentNodeId: c.mySystemNode.id },
        include: { idCard: true }
      });
      console.log(`  Placement Children count: ${children.length}`);
      for (const ch of children) {
        console.log(`    -> Child Card: ${ch.idCard.cardNumber}, Side: ${ch.side}`);
      }
    }
  }
}

checkTopology().catch(console.error).finally(() => prisma.$disconnect());
