const prisma = require("./src/lib/prisma");
const bcrypt = require("bcrypt");

async function resetPassword() {
  const targetCode = "BB10005"; // ← Change this to your actual member code!
  const newPassword = "password123";

  try {
    const newHash = await bcrypt.hash(newPassword, 10);
    
    const member = await prisma.member.update({
      where: { memberCode: targetCode },
      data: { passwordHash: newHash }
    });

    console.log(`\n✅ SUCCESS!\n`);
    console.log(`Member Code: ${member.memberCode}`);
    console.log(`Name: ${member.name}`);
    console.log(`New Password: ${newPassword}\n`);
    console.log(`Now go to http://localhost:4000/bb-register.html, click "Login Here", and use:`);
    console.log(`   Username: ${member.memberCode}`);
    console.log(`   Password: ${newPassword}\n`);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Check if the member code exists by running: node list-members.js");
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();