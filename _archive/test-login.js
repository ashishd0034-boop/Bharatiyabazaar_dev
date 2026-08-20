const prisma = require("./src/lib/prisma");
const bcrypt = require("bcrypt");

async function testLogin() {
  const target = "BB10005"; // Change if your code is different!
  const passwordToTest = "password123";

  console.log(`\nSearching for member: ${target}...`);
  
  // Use the exact same query your backend uses
  const member = await prisma.member.findFirst({
    where: { 
      OR: [{ mobile: target }, { memberCode: target }] 
    }
  });

  if (!member) {
    console.log("❌ Member not found! Check your member code.");
    await prisma.$disconnect();
    return;
  }
  console.log(`✅ Found: ${member.name} (${member.memberCode})`);

  if (!member.passwordHash) {
    console.log("❌ ERROR: This member has no password hash in the database!");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nTesting password: "${passwordToTest}"...`);
  const isValid = await bcrypt.compare(passwordToTest, member.passwordHash);

  if (isValid) {
    console.log("✅ PASSWORD MATCHES! Your backend and database are 100% correct.");
    console.log("If the browser still fails, it's a frontend caching issue. Hard refresh!");
  } else {
    console.log("❌ PASSWORD DOES NOT MATCH.");
    console.log("The reset-password.js script didn't save correctly.");
  }
  
  await prisma.$disconnect();
}

testLogin();