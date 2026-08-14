const prisma = require("../lib/prisma");
const walletService = require("./walletService");

const SETU_KOSH_COST_PAISE = 100000; // Rs. 1,000 in paise
const SYSTEM_COUNTER_ID = "SETUKOSH_POSITION";

/**
 * Distributes 10-level upline commissions for a new Setu Kosh node.
 * Formula: Base rate = weighted vendor margin × 0.071428.
 * L4 and L7 get half rate.
 */
async function distributeCommissions(tx, startingNode, weightedVendorMarginPct) {
  // Base commission is on the full Rs. 1000 value
  // 0.071428 * 1000 = 71.428 Rs = 7142.8 paise
  // Since we use the vendor margin percentage directly in calculations:
  // Commission = (100000 * (weightedVendorMarginPct / 100)) * 0.071428
  
  // Actually, standard formula is: vendor margin x 0.071428
  // Meaning if margin is Rs. 100, payout is Rs. 7.14
  // Let's calculate the margin value on the Rs. 1000 purchase
  const marginValuePaise = Math.floor((SETU_KOSH_COST_PAISE * weightedVendorMarginPct) / 100);
  const baseRatePaise = Math.floor(marginValuePaise * 0.071428);
  const halfRatePaise = Math.floor(baseRatePaise / 2);

  let currentNodeId = startingNode.parentNodeId;
  let currentLevel = 1;

  while (currentNodeId && currentLevel <= 10) {
    const ancestor = await tx.setuKoshNode.findUnique({
      where: { id: currentNodeId },
      include: { member: true }
    });

    if (!ancestor) break;

    // L4 and L7 receive half rate
    const amountPaise = (currentLevel === 4 || currentLevel === 7) ? halfRatePaise : baseRatePaise;

    // In Setu Kosh, we do NOT check Pay-Once or ACB.
    // We just create PENDING_SETTLEMENT commissions.

    // Actually, I need to fetch the main ID card for the ancestor to attach the commission to.
    const mainIdCard = await tx.memberIdCard.findFirst({
      where: { memberId: ancestor.memberId, type: "MAIN" }
    });

    if (mainIdCard) {
      await tx.commissionEntry.create({
        data: {
          idCardId: mainIdCard.id,
          stream: "SETU_KOSH",
          level: currentLevel,
          amountPaise: amountPaise,
          status: "PENDING_SETTLEMENT",
        }
      });
      
      // Update wallet as PENDING.
      // Wait, our walletService.credit doesn't track "PENDING" separately in the Wallet schema.
      // The wallet schema just has `balancePaise`. 
      // But PENDING means it's NOT in the withdrawable wallet balance yet.
      // It just sits in the `CommissionEntry` as PENDING_SETTLEMENT.
      // We do NOT credit the wallet until Monday settlement.
      // So we don't call walletService.credit here!
    }

    currentNodeId = ancestor.parentNodeId;
    currentLevel++;
  }
}

/**
 * Generates a new Setu Kosh node in the global 10-level tree.
 * Position is deterministic based on globalPosition.
 * Parent = Math.floor(globalPosition / 2).
 */
async function generateSetuKoshNode(tx, memberId, weightedVendorMarginPct) {
  // 1. Get next global position atomically
  const counter = await tx.systemCounter.upsert({
    where: { id: SYSTEM_COUNTER_ID },
    update: { currentValue: { increment: 1 } },
    create: { id: SYSTEM_COUNTER_ID, currentValue: 1 }
  });

  const globalPosition = counter.currentValue;

  let parentNodeId = null;
  let side = null;
  let depthLevel = 0;

  // 2. Determine parent and side if not root (position 1)
  if (globalPosition > 1) {
    const parentPosition = Math.floor(globalPosition / 2);
    side = (globalPosition % 2 === 0) ? "LEFT" : "RIGHT";

    const parentNode = await tx.setuKoshNode.findUnique({
      where: { globalPosition: parentPosition }
    });

    if (!parentNode) {
      throw new Error(`Parent node at position ${parentPosition} not found for globalPosition ${globalPosition}`);
    }

    parentNodeId = parentNode.id;
    depthLevel = parentNode.depthLevel + 1;
  }

  // 3. Create the node
  const newNode = await tx.setuKoshNode.create({
    data: {
      memberId,
      globalPosition,
      parentNodeId,
      side,
      depthLevel
    }
  });

  // 4. Distribute upline commissions
  if (parentNodeId) {
    await distributeCommissions(tx, newNode, weightedVendorMarginPct);
  }

  return newNode;
}

module.exports = {
  generateSetuKoshNode,
  distributeCommissions
};
