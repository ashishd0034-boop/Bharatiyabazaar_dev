const prisma = require("../src/lib/prisma");
const acbService = require("../src/services/acbService");

async function checkAllCardsAcb() {
  const cards = await prisma.memberIdCard.findMany({
    include: {
      member: true,
      mySystemNode: true,
      sponsoredNodes: true
    },
    orderBy: { cardNumber: "asc" }
  });

  console.log("=== ALL CARDS ACB STATUS AUDIT ===");
  for (const c of cards) {
    const qualifies = await acbService.checkAcbStatus(prisma, c.id);
    const leftCount = c.sponsoredNodes.filter(n => n.side === "LEFT").length;
    const rightCount = c.sponsoredNodes.filter(n => n.side === "RIGHT").length;
    const statusStr = c.acbStatus ? "✅ TRUE" : "❌ FALSE";
    const qualStr = qualifies ? "🌟 QUALIFIES" : "— NO";
    const diff = (c.acbStatus !== qualifies) ? "⚠️ MISMATCH" : "OK";

    console.log(`Card ${c.cardNumber} (${c.type}, Member ${c.member.memberCode} ${c.member.name}): currentACB=${statusStr} | Qualifies=${qualStr} (L=${leftCount}, R=${rightCount}) -> ${diff}`);
  }
}

checkAllCardsAcb().catch(console.error).finally(() => prisma.$disconnect());
