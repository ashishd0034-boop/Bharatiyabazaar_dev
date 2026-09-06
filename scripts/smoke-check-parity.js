const prisma = require("../src/lib/prisma");
const autopoolService = require("../src/modules/autopool/autopool.service");
const memberService = require("../src/modules/member/member.service");

async function main() {
  const ramji = await prisma.member.findFirst({
    where: { memberCode: "BB10001" },
    include: {
      idCards: {
        include: { autoPoolNode: true }
      },
      vouchers: true
    }
  });

  if (!ramji) {
    console.log("Ramji (BB10001) not found in DB.");
    return;
  }

  console.log(`--- RAMJI (BB10001) LIVE SMOKE AUDIT ---`);
  console.log(`Total ID Cards: ${ramji.idCards.length}`);
  console.log(`Total Vouchers: ${ramji.vouchers.length}`);

  const mainCard = ramji.idCards.find(c => c.type === "MAIN");
  const subCard = ramji.idCards.find(c => c.cardNumber === "SB10002");

  // MAIN Context Check
  if (mainCard) {
    const mainCtx = { loginCardId: mainCard.id, loginCardNumber: mainCard.cardNumber, loginCardType: "MAIN" };
    const apData = await autopoolService.getAutoPoolTree(ramji.id, mainCtx);
    const profile = await memberService.getMemberProfile(ramji.id, mainCtx);

    const cardVouchers = profile.vouchers.filter(v => v.idCardId === mainCard.id);
    const cardRebirths = profile.idCards.filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === mainCard.id);

    console.log("\n[BB10001 - MAIN Card Context]:");
    console.log(`  autopool-tree myStats: Rebirth IDs = ${apData.myStats.rebirthIds}, Vouchers = Rs.${apData.myStats.vouchersPaise / 100}`);
    console.log(`  profile fallback:      Rebirth IDs = ${cardRebirths.length}, Vouchers = Rs.${cardVouchers.reduce((s,v)=>s+v.faceValuePaise,0)/100}`);
  }

  // SUB Context Check
  if (subCard) {
    const subCtx = { loginCardId: subCard.id, loginCardNumber: subCard.cardNumber, loginCardType: "SUB" };
    const apDataSub = await autopoolService.getAutoPoolTree(ramji.id, subCtx);
    const profileSub = await memberService.getMemberProfile(ramji.id, subCtx);

    const cardVouchersSub = profileSub.vouchers.filter(v => v.idCardId === subCard.id);
    const cardRebirthsSub = profileSub.idCards.filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === subCard.id);

    console.log("\n[SB10002 - SUB Card Context]:");
    console.log(`  autopool-tree myStats: Rebirth IDs = ${apDataSub.myStats.rebirthIds}, Vouchers = Rs.${apDataSub.myStats.vouchersPaise / 100}`);
    console.log(`  profile fallback:      Rebirth IDs = ${cardRebirthsSub.length}, Vouchers = Rs.${cardVouchersSub.reduce((s,v)=>s+v.faceValuePaise,0)/100}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
