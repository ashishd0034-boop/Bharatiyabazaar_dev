const prisma = require("./src/lib/prisma");

async function main() {
  const members = await prisma.member.findMany();
  const idCards = await prisma.memberIdCard.findMany();
  const mySystemNodes = await prisma.mySystemNode.findMany();

  console.log(`\n📊 Database Status:\n`);
  console.log(`Members: ${members.length}`);
  console.log(`ID Cards: ${idCards.length}`);
  console.log(`MY SYSTEM Nodes: ${mySystemNodes.length}`);
  
  if (members.length > 0) {
    console.log(`\nFirst 5 members:`);
    members.slice(0, 5).forEach(m => console.log(`  - ${m.memberCode || m.mobile}`));
  }

  if (mySystemNodes.length > 0) {
    const roots = mySystemNodes.filter(n => !n.parentNodeId);
    const withParents = mySystemNodes.filter(n => n.parentNodeId);
    console.log(`\nMY SYSTEM tree:`);
    console.log(`  - ROOT nodes: ${roots.length}`);
    console.log(`  - Nodes with parents: ${withParents.length}`);
  }

  await prisma.$disconnect();
}

main();
