const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function applyOptionB() {
  console.log("================================================================================");
  console.log("🛠️  PRE-FLIGHT CHECKS FOR OPTION B");
  console.log("================================================================================\n");

  // 1. Check orphan member BB10015
  const orphan = await prisma.member.findUnique({
    where: { memberCode: "BB10015" },
    include: {
      idCards: {
        include: { autoPoolNode: true }
      }
    }
  });

  if (!orphan) {
    console.error("❌ PRE-FLIGHT CHECK 1 FAILED: Member with memberCode 'BB10015' not found.");
    process.exit(1);
  }

  const mainCard = orphan.idCards.find(c => c.type === "MAIN");
  if (!mainCard || mainCard.cardNumber !== "BB10014" || mainCard.autoPoolNode?.globalPosition !== 14) {
    console.error("❌ PRE-FLIGHT CHECK 1 FAILED: Orphan member does not own MAIN card 'BB10014' at AutoPool position #14.");
    console.error("Found:", {
      memberCode: orphan.memberCode,
      mobile: orphan.mobile,
      mainCardNumber: mainCard?.cardNumber,
      autoPoolPosition: mainCard?.autoPoolNode?.globalPosition
    });
    process.exit(1);
  }
  console.log("✅ Check 1 Passed: Exactly one member has memberCode 'BB10015' owning MAIN card 'BB10014' at AutoPool position #14.");
  console.log(`   (Name: ${orphan.name}, Mobile: ${orphan.mobile})`);

  // 2. Check that target code BB10014 is free
  const existing14 = await prisma.member.findUnique({
    where: { memberCode: "BB10014" }
  });

  if (existing14) {
    console.error("❌ PRE-FLIGHT CHECK 2 FAILED: Member with memberCode 'BB10014' already exists.");
    process.exit(1);
  }
  console.log("✅ Check 2 Passed: Target memberCode 'BB10014' is free.");

  // 3. Check SystemCounter rows
  const memberCounter = await prisma.systemCounter.findUnique({ where: { id: "MEMBER_CODE" } });
  const apCounter = await prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });

  if (!memberCounter || !apCounter) {
    console.error("❌ PRE-FLIGHT CHECK 3 FAILED: SystemCounter rows for 'MEMBER_CODE' or 'AUTOPOOL_GLOBAL' missing.");
    process.exit(1);
  }
  console.log(`✅ Check 3 Passed: SystemCounter rows exist (MEMBER_CODE: ${memberCounter.currentValue}, AUTOPOOL_GLOBAL: ${apCounter.currentValue}).`);

  console.log("\n================================================================================");
  console.log("⚡ APPLYING FIX (SINGLE TRANSACTION)");
  console.log("================================================================================\n");

  await prisma.$transaction(async (tx) => {
    // 1. Rename orphan member
    await tx.member.update({
      where: { id: orphan.id },
      data: { memberCode: "BB10014" }
    });
    console.log(`  ✓ Updated member (ID: ${orphan.id}) memberCode from 'BB10015' -> 'BB10014'`);

    // 2. Update SystemCounter MEMBER_CODE
    await tx.systemCounter.update({
      where: { id: "MEMBER_CODE" },
      data: { currentValue: 10014 }
    });
    console.log(`  ✓ Updated SystemCounter 'MEMBER_CODE' to 10014`);

    // 3. Update SystemCounter AUTOPOOL_GLOBAL
    await tx.systemCounter.update({
      where: { id: "AUTOPOOL_GLOBAL" },
      data: { currentValue: 14 }
    });
    console.log(`  ✓ Updated SystemCounter 'AUTOPOOL_GLOBAL' to 14`);
  });

  console.log("\n================================================================================");
  console.log("🔍 POST-VERIFICATION AUDIT");
  console.log("================================================================================\n");

  // 1. Full 14-member parity table
  const allMembers = await prisma.member.findMany({
    include: {
      idCards: {
        include: { autoPoolNode: true }
      }
    },
    orderBy: { memberCode: "asc" }
  });

  console.log("MEMBER CODE | NAME           | MOBILE     | MAIN CARD  | AUTOPOOL POS | 1:1:1 PARITY");
  console.log("--------------------------------------------------------------------------------------");

  let allParityPass = true;
  allMembers.forEach((m, idx) => {
    const main = m.idCards.find(c => c.type === "MAIN") || m.idCards[0];
    const expectedNum = 10001 + idx;
    const expectedCode = `BB${expectedNum}`;
    const expectedPos = idx + 1;

    const isMatch = (m.memberCode === expectedCode && main?.cardNumber === expectedCode && main?.autoPoolNode?.globalPosition === expectedPos);
    if (!isMatch) allParityPass = false;

    console.log(
      `${(m.memberCode || 'N/A').padEnd(11)} | ` +
      `${(m.name || '').padEnd(14)} | ` +
      `${(m.mobile || '').padEnd(10)} | ` +
      `${(main?.cardNumber || 'N/A').padEnd(10)} | ` +
      `#${String(main?.autoPoolNode?.globalPosition || 'N/A').padEnd(11)} | ` +
      `${isMatch ? "✅ MATCH" : "❌ MISMATCH"}`
    );
  });
  console.log("--------------------------------------------------------------------------------------");

  // 2. Counters check
  const finalMemberCounter = await prisma.systemCounter.findUnique({ where: { id: "MEMBER_CODE" } });
  const finalApCounter = await prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });

  console.log(`\nCounters:`);
  console.log(`  - MEMBER_CODE:     ${finalMemberCounter.currentValue} (Expected: 10014) -> ${finalMemberCounter.currentValue === 10014 ? '✅ OK' : '❌ FAIL'}`);
  console.log(`  - AUTOPOOL_GLOBAL: ${finalApCounter.currentValue} (Expected: 14)    -> ${finalApCounter.currentValue === 14 ? '✅ OK' : '❌ FAIL'}`);

  // 3. Confirm 0 members with BB10015
  const check15 = await prisma.member.findUnique({ where: { memberCode: "BB10015" } });
  console.log(`  - BB10015 Member:  ${check15 ? '❌ Still exists' : '✅ 0 members found'}`);

  // 4. Overall result
  console.log(`\nOverall Parity: ${allParityPass ? '🎉 100% PERFECT 1:1:1 PARITY RESTORED ACROSS ALL 14 MEMBERS' : '❌ FAILED'}`);
  console.log("================================================================================\n");

  await prisma.$disconnect();
}

applyOptionB();
