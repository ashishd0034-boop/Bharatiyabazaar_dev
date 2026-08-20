const prisma = require("./src/lib/prisma");
const { purchaseIds } = require("./src/services/idCardService");

async function backfill() {
  console.log("\n🔍 Searching for members without ID Cards...\n");
  const members = await prisma.member.findMany({ include: { idCards: true } });
  
  let fixed = 0;
  for (const member of members) {
    const hasMain = member.idCards.some(c => c.type === "MAIN");
    
    if (!hasMain) {
      console.log(`🛠️  Generating MAIN ID for ${member.name} (${member.memberCode})...`);
      try {
        await purchaseIds(member.id, 1, null, null);
        console.log(`✅ Success! ${member.memberCode} now has an ID Card.\n`);
        fixed++;
      } catch (err) {
        console.log(`❌ Failed for ${member.memberCode}: ${err.message}\n`);
      }
    }
  }
  
  console.log(`\n🎉 Done! Backfilled ${fixed} member(s).`);
  await prisma.$disconnect();
}

backfill();
