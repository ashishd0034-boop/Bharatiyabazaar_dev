const prisma = require("./src/lib/prisma");

async function list() {
  try {
    const members = await prisma.member.findMany({
      select: {
        memberCode: true,
        name: true,
        mobile: true,
        email: true,
        status: true,
        kycStatus: true,
        passwordHash: true, // Shows the encrypted hash
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5 // Just show the 5 most recently registered members
    });
    
    console.log("\n=== RECENTLY REGISTERED MEMBERS ===\n");
    
    members.forEach((m, index) => {
      console.log(`👤 [${index + 1}] ${m.name}`);
      console.log(`   Member Code: ${m.memberCode || 'N/A'}`);
      console.log(`   Mobile:      ${m.mobile}`);
      console.log(`   Email:       ${m.email || 'None'}`);
      console.log(`   Status:      ${m.status} | KYC: ${m.kycStatus}`);
      console.log(`   Registered:  ${new Date(m.createdAt).toLocaleString()}`);
      console.log(`   Password:    ${m.passwordHash ? '✅ Set (Encrypted)' : '❌ Not Set'}`);
      console.log("--------------------------------------------------");
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

list();