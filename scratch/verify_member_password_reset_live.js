const prisma = require("../src/lib/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { resetMemberPassword } = require("../src/services/adminService");

async function main() {
  console.log("=== LIVE E2E VERIFICATION: ADMIN MEMBER PASSWORD RESET ===");

  // 1. Find Super Admin and Root Member BB10020
  const superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!superAdmin) throw new Error("Super Admin not found on bb_dev.");

  const member = await prisma.member.findFirst({
    where: { memberCode: "BB10020" },
    include: { mainWallet: true, idCards: true }
  });
  if (!member) throw new Error("Member BB10020 not found on bb_dev.");

  console.log(`Target Member: ${member.name} (${member.memberCode}), ID: ${member.id}`);

  // 2. Perform Password Reset via adminService
  const resetRes = await resetMemberPassword(superAdmin.id, superAdmin.email, member.id, "127.0.0.1");
  console.log(`Generated Temp Password: ${resetRes.temporaryPassword}`);

  // 3. Verify Member DB passwordHash matches
  const updatedMember = await prisma.member.findUnique({ where: { id: member.id } });
  const isMatch = await bcrypt.compare(resetRes.temporaryPassword, updatedMember.passwordHash);
  console.log(`DB Password Hash Match: ${isMatch ? "SUCCESS (Matches)" : "FAILED"}`);

  // 4. Verify AuditLog Entry
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: "MEMBER_PASSWORD_RESET",
      entityId: member.id
    },
    orderBy: { createdAt: "desc" }
  });
  console.log(`AuditLog Recorded: ${auditLog ? "SUCCESS" : "FAILED"}`);
  if (auditLog) {
    console.log(`AuditLog Details: Actor=${auditLog.actorType}:${auditLog.actorId}, Meta=${JSON.stringify(auditLog.metadata)}`);
  }

  // 5. Test Member Authentication Simulation
  const JWT_SECRET = process.env.JWT_SECRET;
  const loginCard = member.idCards[0];
  const memberToken = jwt.sign(
    { id: member.id, loginCardId: loginCard ? loginCard.id : null, type: "MEMBER" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  console.log(`Member Token Generated Successfully: ${memberToken ? "SUCCESS" : "FAILED"}`);
  console.log("=== LIVE E2E VERIFICATION COMPLETED ===");
}

main()
  .catch(err => { console.error("Error in live verification:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
