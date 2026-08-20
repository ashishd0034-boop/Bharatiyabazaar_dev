const prisma = require("./src/lib/prisma");

// Define the perfect binary tree structure
const PLACEMENTS = [
  { member: "BB10002", sponsor: "BB10001", side: "LEFT"  },
  { member: "BB10003", sponsor: "BB10001", side: "RIGHT" },
  { member: "BB10004", sponsor: "BB10002", side: "LEFT"  },
  { member: "BB10005", sponsor: "BB10002", side: "RIGHT" },
  { member: "BB10007", sponsor: "BB10005", side: "LEFT"  },
  { member: "BB10006", sponsor: "BB10005", side: "RIGHT" },
];

async function linkTree() {
  console.log("\n🌳 Linking MY SYSTEM Tree...\n");

  for (const p of PLACEMENTS) {
    const member = await prisma.member.findUnique({ where: { memberCode: p.member } });
    const sponsor = await prisma.member.findUnique({ where: { memberCode: p.sponsor } });

    if (!member || !sponsor) { console.log(`⚠️ Skip ${p.member}: not found`); continue; }

    const mCard = await prisma.memberIdCard.findFirst({ where: { memberId: member.id, type: "MAIN" } });
    const sCard = await prisma.memberIdCard.findFirst({ where: { memberId: sponsor.id, type: "MAIN" } });
    if (!mCard || !sCard) { console.log(`⚠️ Skip ${p.member}: missing MAIN ID`); continue; }

    const mNode = await prisma.mySystemNode.findUnique({ where: { idCardId: mCard.id } });
    const sNode = await prisma.mySystemNode.findUnique({ where: { idCardId: sCard.id } });
    if (!mNode || !sNode) { console.log(`⚠️ Skip ${p.member}: missing tree node`); continue; }

    // Check if sponsor's slot is taken by someone else
    const occupied = await prisma.mySystemNode.findFirst({ where: { parentNodeId: sNode.id, side: p.side } });
    if (occupied && occupied.id !== mNode.id) {
      console.log(`⚠️ Skip ${p.member}: ${p.sponsor}'s ${p.side} slot already taken`);
      continue;
    }

    await prisma.mySystemNode.update({
      where: { id: mNode.id },
      data: { parentNodeId: sNode.id, side: p.side, placementType: "SPONSOR" }
    });

    console.log(`✅ Linked ${p.member} under ${p.sponsor} (${p.side})`);
  }

  console.log("\n🎉 MY SYSTEM tree is fully linked!\n");
  await prisma.$disconnect();
}

linkTree();
