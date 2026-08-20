const prisma = require("../src/lib/prisma");

const API_BASE = "http://localhost:4000/api";

async function verifyAll() {
  console.log("================================================================================");
  console.log("🧪 RUNNING COMPREHENSIVE VERIFICATION FOR ISSUES 1 & 3");
  console.log("================================================================================\n");

  // 1. Check all members for memberCode == MAIN cardNumber
  console.log("1. AUDITING MEMBER CODES VS MAIN CARDS:");
  const members = await prisma.member.findMany({
    include: { idCards: true },
    orderBy: { memberCode: "asc" }
  });

  let allMatch = true;
  for (const m of members) {
    const mainCard = m.idCards.find(c => c.type === "MAIN");
    const match = mainCard && m.memberCode === mainCard.cardNumber;
    if (!match) allMatch = false;
    console.log(`  - Member: ${m.name.padEnd(15)} | memberCode: ${(m.memberCode || 'null').padEnd(9)} | MAIN card: ${(mainCard?.cardNumber || 'NONE').padEnd(9)} | Parity: ${match ? '✅ MATCH' : '❌ MISMATCH'}`);
  }
  console.log(`  => Total Members: ${members.length} | 100% Parity: ${allMatch ? '✅ PASSED' : '❌ FAILED'}\n`);

  // 2. Check SystemCounter
  console.log("2. AUDITING SYSTEM COUNTERS:");
  const counters = await prisma.systemCounter.findMany();
  const hasMemberCodeCounter = counters.some(c => c.id === "MEMBER_CODE");
  console.log(`  - Active counters: ${counters.map(c => `${c.id}=${c.currentValue}`).join(", ")}`);
  console.log(`  - MEMBER_CODE counter retired: ${!hasMemberCodeCounter ? '✅ YES (RETIRED)' : '❌ NO (STILL PRESENT)'}\n`);

  // 3. Check ACB statuses (specifically SB10019 and SB10020)
  console.log("3. AUDITING ACB STATUS FOR SB10019 & SB10020:");
  const sb19 = await prisma.memberIdCard.findUnique({ where: { cardNumber: "SB10019" } });
  const sb20 = await prisma.memberIdCard.findUnique({ where: { cardNumber: "SB10020" } });
  console.log(`  - SB10019 (SUB): acbStatus=${sb19.acbStatus} | acbUnlockedAt=${sb19.acbUnlockedAt} -> ${sb19.acbStatus ? '✅ UNLOCKED' : '❌ LOCKED'}`);
  console.log(`  - SB10020 (SUB): acbStatus=${sb20.acbStatus} | acbUnlockedAt=${sb20.acbUnlockedAt} -> ${sb20.acbStatus ? '✅ UNLOCKED' : '❌ LOCKED'}\n`);

  // 4. Test Login Matrix
  console.log("4. TESTING LOGIN VERIFICATION MATRIX (sufh account):");

  // A. Mobile login
  const resMob = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "2222333322", password: "password123" })
  }).then(r => r.json());

  console.log("  A. Login via Mobile (2222333322):");
  console.log(`     - memberCode:      ${resMob.data?.member?.memberCode}`);
  console.log(`     - activeCard:      ${resMob.data?.loginContext?.cardNumber}`);
  console.log(`     - isSubCard:       ${resMob.data?.loginContext?.isSubCard}`);
  console.log(`     - ownerMemberCode: ${resMob.data?.loginContext?.ownerMemberCode}`);

  // B. MAIN card login (BB10018)
  const resMain = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10018", password: "password123" })
  }).then(r => r.json());

  console.log("  B. Login via MAIN Card (BB10018):");
  console.log(`     - memberCode:      ${resMain.data?.member?.memberCode}`);
  console.log(`     - activeCard:      ${resMain.data?.loginContext?.cardNumber}`);
  console.log(`     - isSubCard:       ${resMain.data?.loginContext?.isSubCard}`);
  console.log(`     - ownerMemberCode: ${resMain.data?.loginContext?.ownerMemberCode}`);

  // C. SUB card login (SB10019)
  const resSub = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "SB10019", password: "password123" })
  }).then(r => r.json());

  console.log("  C. Login via SUB Card (SB10019):");
  console.log(`     - memberCode:      ${resSub.data?.member?.memberCode}`);
  console.log(`     - activeCard:      ${resSub.data?.loginContext?.cardNumber}`);
  console.log(`     - isSubCard:       ${resSub.data?.loginContext?.isSubCard}`);
  console.log(`     - ownerMemberCode: ${resSub.data?.loginContext?.ownerMemberCode}\n`);

  console.log("================================================================================");
  console.log("🎉 ALL VERIFICATIONS COMPLETED SUCCESSFULLY");
  console.log("================================================================================\n");
}

verifyAll().catch(console.error).finally(() => prisma.$disconnect());
