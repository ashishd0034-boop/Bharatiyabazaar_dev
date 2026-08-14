const prisma = require("../lib/prisma");
const { generateSetuKoshNode } = require("./setuKoshService");

const SETU_KOSH_COST_PAISE = 100000; // Rs. 1,000

/**
 * Processes a purchase made by a member at a vendor.
 * Accumulates the purchase amount and margin in the member's Setu Kosh Counter.
 * If the counter crosses Rs. 1,000, generates Setu Kosh IDs and distributes commissions.
 */
async function processMemberPurchase(memberId, vendorId, amountPaise) {
  return await prisma.$transaction(async (tx) => {
    // 1. Fetch vendor and their margin
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      include: { member: true }
    });

    if (!vendor || vendor.status !== "VERIFIED") {
      throw new Error(`Vendor ${vendorId} not found or not verified`);
    }

    // 2. Create the VendorSale record
    const vendorSale = await tx.vendorSale.create({
      data: {
        vendorId,
        memberId,
        amountPaise
      }
    });

    // 3. Process Vendor Referral Bonus (0.25% of purchase amount)
    // The referral bonus goes to the MY SYSTEM sponsor of the purchasing member.
    // Wait, the spec says: "Referral bonus = 0.25% of purchase amount (to MY SYSTEM sponsor)"
    // The sponsor is the parent of the purchasing member's MAIN ID in MY SYSTEM.
    const purchasingMemberMainIdCard = await tx.memberIdCard.findFirst({
      where: { memberId, type: "MAIN" },
      include: { mySystemNode: true }
    });

    if (purchasingMemberMainIdCard && purchasingMemberMainIdCard.mySystemNode && purchasingMemberMainIdCard.mySystemNode.parentNodeId) {
      const sponsorNode = await tx.mySystemNode.findUnique({
        where: { id: purchasingMemberMainIdCard.mySystemNode.parentNodeId },
        include: { idCard: true }
      });

      if (sponsorNode) {
        const bonusPaise = Math.floor(amountPaise * 0.0025); // 0.25%
        if (bonusPaise > 0) {
          await tx.commissionEntry.create({
            data: {
              idCardId: sponsorNode.idCard.id,
              stream: "VENDOR_REFERRAL_BONUS",
              level: 1, // N/A conceptually, but required by schema
              amountPaise: bonusPaise,
              status: "PENDING_SETTLEMENT"
            }
          });
          
          // Also record in VendorReferralBonus table for tracking
          await tx.vendorReferralBonus.create({
            data: {
              memberId: sponsorNode.idCard.memberId,
              referredVendorId: vendorId,
              bonusPaise: bonusPaise,
              status: "PENDING"
            }
          });
        }
      }
    }

    // 4. Update Setu Kosh Counter (Upsert)
    // Calculate the margin in paise for this specific purchase
    const marginPaise = Math.floor((amountPaise * vendor.marginRatePct) / 100);

    const counter = await tx.setuKoshCounter.upsert({
      where: { memberId },
      create: {
        memberId,
        counterPaise: amountPaise,
        accumulatedMarginPaise: marginPaise,
      },
      update: {
        counterPaise: { increment: amountPaise },
        accumulatedMarginPaise: { increment: marginPaise }
      }
    });

    // 5. Check if threshold (Rs. 1,000) is reached to generate IDs
    let remainingCounterPaise = counter.counterPaise;
    let remainingMarginPaise = counter.accumulatedMarginPaise;
    let idsGenerated = 0;

    while (remainingCounterPaise >= SETU_KOSH_COST_PAISE) {
      // Calculate weighted margin percentage
      // Formula: Math.floor((totalMarginPaise * 100) / totalAccumulatedPurchasePaise)
      // Note: We use the *current* accumulated values BEFORE deduction to calculate the average.
      let weightedMarginPct = 0;
      if (remainingCounterPaise > 0) {
         weightedMarginPct = Math.floor((remainingMarginPaise * 100) / remainingCounterPaise);
      }

      // Generate Setu Kosh Node and Distribute Commissions
      await generateSetuKoshNode(tx, memberId, weightedMarginPct);
      idsGenerated++;

      // Deduct the Rs. 1000 threshold from counter
      remainingCounterPaise -= SETU_KOSH_COST_PAISE;

      // Deduct the proportional margin corresponding to the Rs. 1000 deducted
      // Deducting 100000 worth of purchase means we deduct `weightedMarginPct` of 100000 from accumulated margin.
      const marginToDeduct = Math.floor((SETU_KOSH_COST_PAISE * weightedMarginPct) / 100);
      remainingMarginPaise -= marginToDeduct;
    }

    // Update the counter with remainders if we generated IDs
    if (idsGenerated > 0) {
      await tx.setuKoshCounter.update({
        where: { memberId },
        data: {
          counterPaise: remainingCounterPaise,
          accumulatedMarginPaise: remainingMarginPaise,
          idsCreated: { increment: idsGenerated }
        }
      });
    }

    return vendorSale;
  }, {
    timeout: 30000 // 30 seconds for potential deep tree insertions
  });
}

module.exports = {
  processMemberPurchase
};
