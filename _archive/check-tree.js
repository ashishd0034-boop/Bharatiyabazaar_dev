const prisma = require("./src/lib/prisma");

async function check(memberCode) {
  const member = await prisma.member.findUnique({ where: { memberCode } });
  if (!member) { console.log("❌ Member not found"); return; }
  
  console.log(`\n👤 Member: ${member.name} (${member.memberCode})\n`);
  
  const cards = await prisma.memberIdCard.findMany({
    where: { memberId: member.id },
    select: { id: true, cardNumber: true, type: true, acbStatus: true }
  });
  
  if (cards.length === 0) {
    console.log("❌ NO ID CARDS FOUND!");
    console.log("The purchaseIds() function was NOT called during registration.");
    console.log("This means BB10006 has no tree placement, no AutoPool entry, etc.");
  } else {
    console.log(`✅ Found ${cards.length} ID Card(s):`);
    cards.forEach(c => console.log(`   - ${c.cardNumber} [${c.type}] ACB:${c.acbStatus}`));
    
    const myNodes = await prisma.mySystemNode.findMany({
      where: { idCardId: { in: cards.map(c => c.id) } }
    });
    console.log(`\n🌳 MY SYSTEM Nodes: ${myNodes.length}`);
    myNodes.forEach(n => console.log(`   - ${n.id} (Side: ${n.side}, Type: ${n.placementType})`));

    const autoNodes = await prisma.autoPoolNode.findMany({
      where: { idCardId: { in: cards.map(c => c.id) } }
    });
    console.log(`\n🔄 AutoPool Nodes: ${autoNodes.length}`);
    autoNodes.forEach(n => console.log(`   - Global Position: ${n.globalPosition} (Level: ${n.depthLevel})`));
  }
  
  await prisma.$disconnect();
}

check("BB10006"); // Change this if you want to check a different code