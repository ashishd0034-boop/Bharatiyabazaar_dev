const prisma = require("../src/lib/prisma");

async function checkPoolNodes() {
  const nodes = await prisma.autoPoolNode.findMany({
    include: {
      idCard: {
        include: {
          member: true
        }
      }
    },
    orderBy: { globalPosition: "asc" }
  });

  console.log(`Total AutoPoolNodes in DB: ${nodes.length}`);
  for (const n of nodes) {
    console.log(`Pos #${n.globalPosition.toString().padEnd(3)} | Card: ${n.idCard.cardNumber.padEnd(8)} | Type: ${n.idCard.type.padEnd(8)} | Member: ${n.idCard.member.memberCode} (${n.idCard.member.name}) | Depth: ${n.depthLevel}`);
  }
}

checkPoolNodes().catch(console.error).finally(() => prisma.$disconnect());
