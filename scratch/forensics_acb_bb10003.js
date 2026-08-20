const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function forensicDump() {
  console.log("================================================================================");
  console.log("🔬 TASK 1 & 2: BB10003, BB10014, BB10015 TREE DUMP");
  console.log("================================================================================\n");

  // 1. BB10003 MySystemNode & Direct Children
  const bb10003Card = await prisma.memberIdCard.findFirst({
    where: { cardNumber: "BB10003" },
    include: {
      member: true,
      mySystemNode: {
        include: {
          parent: { include: { idCard: { include: { member: true } } } },
          sponsorCard: { include: { member: true } },
          children: {
            include: {
              idCard: { include: { member: true } },
              sponsorCard: { include: { member: true } }
            }
          }
        }
      }
    }
  });

  console.log("BB10003 Node:");
  console.log({
    id: bb10003Card.mySystemNode?.id,
    cardNumber: bb10003Card.cardNumber,
    memberCode: bb10003Card.member.memberCode,
    acbStatus: bb10003Card.acbStatus,
    acbUnlockedAt: bb10003Card.acbUnlockedAt,
    placementType: bb10003Card.mySystemNode?.placementType,
    parentNodeCard: bb10003Card.mySystemNode?.parent?.idCard.cardNumber,
    sponsorCard: bb10003Card.mySystemNode?.sponsorCard?.cardNumber,
    sponsorMemberCode: bb10003Card.mySystemNode?.sponsorCard?.member.memberCode
  });

  console.log("\nBB10003 Direct Children (parentNodeId = BB10003):");
  bb10003Card.mySystemNode?.children.forEach(c => {
    console.log({
      childCardNumber: c.idCard.cardNumber,
      childOwnerMemberCode: c.idCard.member.memberCode,
      side: c.side,
      placementType: c.placementType,
      sponsorCardNumber: c.sponsorCard?.cardNumber,
      sponsorOwnerMemberCode: c.sponsorCard?.member.memberCode,
      createdAt: c.createdAt
    });
  });

  // 2. BB10014 and BB10015 MySystemNode
  const bb10014 = await prisma.memberIdCard.findFirst({
    where: { cardNumber: "BB10014" },
    include: {
      mySystemNode: {
        include: {
          parent: { include: { idCard: true } },
          sponsorCard: { include: { member: true } }
        }
      }
    }
  });

  console.log("\nBB10014 Node Details:");
  console.log({
    cardNumber: bb10014?.cardNumber,
    parentNodeCardNumber: bb10014?.mySystemNode?.parent?.idCard.cardNumber,
    side: bb10014?.mySystemNode?.side,
    placementType: bb10014?.mySystemNode?.placementType,
    sponsorCardNumber: bb10014?.mySystemNode?.sponsorCard?.cardNumber,
    sponsorMemberCode: bb10014?.mySystemNode?.sponsorCard?.member.memberCode,
    createdAt: bb10014?.createdAt
  });

  const bb10015 = await prisma.memberIdCard.findFirst({
    where: { cardNumber: "BB10015" },
    include: {
      mySystemNode: {
        include: {
          parent: { include: { idCard: true } },
          sponsorCard: { include: { member: true } }
        }
      }
    }
  });

  console.log("\nBB10015 Node Details:");
  console.log({
    cardNumber: bb10015?.cardNumber,
    parentNodeCardNumber: bb10015?.mySystemNode?.parent?.idCard.cardNumber,
    side: bb10015?.mySystemNode?.side,
    placementType: bb10015?.mySystemNode?.placementType,
    sponsorCardNumber: bb10015?.mySystemNode?.sponsorCard?.cardNumber,
    sponsorMemberCode: bb10015?.mySystemNode?.sponsorCard?.member.memberCode,
    createdAt: bb10015?.createdAt
  });

  // 4. Audit timestamps around BB10003 ACB Unlock
  console.log("\n================================================================================");
  console.log("🔬 TASK 4: TIMESTAMPS & TRANSACTION CORRELATION");
  console.log("================================================================================\n");

  const bb10003Comms = await prisma.commissionEntry.findMany({
    where: { idCardId: bb10003Card.id },
    orderBy: { createdAt: "asc" }
  });

  const bb10003Ledgers = await prisma.ledgerEntry.findMany({
    where: { wallet: { memberId: bb10003Card.memberId } },
    orderBy: { createdAt: "asc" }
  });

  console.log("BB10003 Commissions:");
  bb10003Comms.forEach(c => console.log(`  - Comm ID: ${c.id} | Stream: ${c.stream} L${c.level} | Rs.${c.amountPaise/100} | Status: ${c.status} | Created: ${c.createdAt.toISOString()}`));

  console.log("\nBB10003 Ledger Entries:");
  bb10003Ledgers.forEach(l => console.log(`  - Ledger ID: ${l.id} | Amount: Rs.${l.amountPaise/100} | Type: ${l.type} | Source: ${l.source} | Ref: ${l.referenceId} | Balance: Rs.${l.balanceBeforePaise/100} -> Rs.${l.balanceAfterPaise/100} | Description: ${l.description} | Created: ${l.createdAt.toISOString()}`));

  // 5. Referrals vs Placement Children for BB10003
  console.log("\n================================================================================");
  console.log("🔬 TASK 5: REFERRALS VS PLACEMENT CHILDREN FOR BB10003");
  console.log("================================================================================\n");

  const referrals = await prisma.mySystemNode.findMany({
    where: { sponsorIdCardId: bb10003Card.id },
    include: { idCard: { include: { member: true } } }
  });

  const placementChildren = await prisma.mySystemNode.findMany({
    where: { parentNodeId: bb10003Card.mySystemNode?.id },
    include: { idCard: { include: { member: true } } }
  });

  console.log(`Direct Referrals (sponsorIdCardId = ${bb10003Card.id}) - Count: ${referrals.length}:`);
  referrals.forEach(r => console.log(`  - Card: ${r.idCard.cardNumber} | Owner: ${r.idCard.member.memberCode} (${r.idCard.member.name}) | Side: ${r.side} | PlacementType: ${r.placementType}`));

  console.log(`\nPlacement Children (parentNodeId = ${bb10003Card.mySystemNode?.id}) - Count: ${placementChildren.length}:`);
  placementChildren.forEach(p => console.log(`  - Card: ${p.idCard.cardNumber} | Owner: ${p.idCard.member.memberCode} (${p.idCard.member.name}) | Side: ${p.side} | PlacementType: ${p.placementType}`));

  console.log("\n================================================================================\n");
  await prisma.$disconnect();
}

forensicDump();
