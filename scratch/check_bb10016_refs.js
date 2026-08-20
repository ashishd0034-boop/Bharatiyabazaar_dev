const prisma = require("../src/lib/prisma");

async function checkReferencesToBB10016() {
  const member = await prisma.member.findUnique({
    where: { memberCode: "BB10016" },
    include: {
      idCards: {
        include: {
          mySystemNode: true,
          sponsoredNodes: true
        }
      }
    }
  });

  console.log("Member sufh cards & sponsored nodes:");
  for (const c of member.idCards) {
    console.log(`Card ${c.cardNumber} (${c.type}): sponsoredNodes count = ${c.sponsoredNodes.length}`);
  }

  // Check if any other member has sponsor/referral referencing BB10016
  // In our schema, referrals in MySystem are linked via sponsorIdCardId (relation to MemberIdCard.id)
  // Let's check if any other table stores memberCode string
  console.log("Member sufh ID:", member.id);
}

checkReferencesToBB10016().catch(console.error).finally(() => prisma.$disconnect());
