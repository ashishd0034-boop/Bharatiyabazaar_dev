const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function checkDb() {
  const members = await prisma.member.findMany();
  console.log("Members in DB count:", members.length);
  members.forEach(m => console.log(m.memberCode, m.mobile));
  await prisma.$disconnect();
}

checkDb();
