const prisma = require("../lib/prisma");
const walletService = require("./walletService");
const adminService = require("./adminService");

const SETU_KOSH_THRESHOLD_PAISE = 100000; // Rs. 1,000 in paise
const SYSTEM_COUNTER_ID = "SETUKOSH_GLOBAL";

/**
 * Checks if a PIN code has reached the minimum member threshold for active commission distribution.
 */
async function isPinCodeActive(tx, pinCode) {
  if (!pinCode) {
    return { active: false, count: 0, threshold: 10 };
  }

  const thresholdSetting = await adminService.getSetting("SETU_KOSH_PIN_THRESHOLD").catch(() => null);
  const threshold = thresholdSetting ? parseInt(thresholdSetting, 10) : 10;

  const count = await tx.member.count({
    where: {
      pinCode: String(pinCode).trim(),
      status: "ACTIVE"
    }
  });

  return {
    active: count >= threshold,
    count,
    threshold
  };
}

/**
 * Sweeps and activates PIN_GATE_INACTIVE commissions triggered by buyers in a PIN code when that PIN reaches threshold.
 */
async function activatePinGateCommissions(tx, pinCode) {
  if (!pinCode) return 0;

  const membersInPin = await tx.member.findMany({
    where: { pinCode: String(pinCode).trim() },
    select: { id: true, idCards: { select: { id: true } } }
  });

  const sourceCardIds = membersInPin.flatMap(m => m.idCards.map(c => c.id));
  if (sourceCardIds.length === 0) return 0;

  const result = await tx.commissionEntry.updateMany({
    where: {
      sourceIdCardId: { in: sourceCardIds },
      stream: { in: ["SETU_KOSH", "VENDOR_REFERRAL_BONUS"] },
      status: "PIN_GATE_INACTIVE"
    },
    data: {
      status: "PENDING_SETTLEMENT"
    }
  });

  await tx.vendorReferralBonus.updateMany({
    where: {
      status: "PIN_GATE_INACTIVE"
    },
    data: {
      status: "PENDING"
    }
  });

  return result.count;
}

/**
 * Pure integer commission split calculation.
 * Base (L1-L3, L5-L6, L8-L10) = floor(margin/14)
 * Half-rate (L4, L7) = floor(margin/28)
 * Referral bonus = floor(purchaseAmount * 25 / 10000) (0.25%)
 */
function calculateCommissionSplits(marginPaise, purchaseAmountPaise) {
  const fullRatePaise = Math.floor(marginPaise / 14);
  const halfRatePaise = Math.floor(marginPaise / 28);
  let referralBonusPaise = Math.floor((purchaseAmountPaise * 25) / 10000);

  const levelAmounts = {
    1: fullRatePaise,
    2: fullRatePaise,
    3: fullRatePaise,
    4: halfRatePaise,
    5: fullRatePaise,
    6: fullRatePaise,
    7: halfRatePaise,
    8: fullRatePaise,
    9: fullRatePaise,
    10: fullRatePaise
  };

  let totalLevelPayout = 0;
  for (let lvl = 1; lvl <= 10; lvl++) {
    totalLevelPayout += levelAmounts[lvl];
  }

  let totalPayout = totalLevelPayout + referralBonusPaise;

  // Cap Enforcement: Total payout cannot exceed vendor margin
  if (totalPayout > marginPaise) {
    if (referralBonusPaise >= marginPaise) {
      referralBonusPaise = marginPaise;
      for (let lvl = 1; lvl <= 10; lvl++) {
        levelAmounts[lvl] = 0;
      }
      totalPayout = referralBonusPaise;
    } else {
      const availableForLevels = Math.max(0, marginPaise - referralBonusPaise);
      const scalingFactor = totalLevelPayout > 0 ? (availableForLevels / totalLevelPayout) : 0;

      totalLevelPayout = 0;
      for (let lvl = 1; lvl <= 10; lvl++) {
        levelAmounts[lvl] = Math.floor(levelAmounts[lvl] * scalingFactor);
        totalLevelPayout += levelAmounts[lvl];
      }
      totalPayout = totalLevelPayout + referralBonusPaise;
    }
  }

  return {
    levelAmounts,
    referralBonusPaise,
    totalPayoutPaise: totalPayout,
    marginPaise
  };
}

/**
 * Deterministically generates a Setu Kosh node in the global 10-level tree and distributes upline commissions.
 *
 * Tree Architecture:
 * - Deterministic Breadth-First Binary Tree indexed by globalPosition (1, 2, 3, ...).
 * - Root = Position 1.
 * - Parent of Position P = floor(P / 2).
 * - Side of Position P = (P % 2 === 0) ? "LEFT" : "RIGHT".
 * - Depth of Position P = floor(log2(P)).
 * - Ancestor chain for Position P: floor(P / 2^1), floor(P / 2^2), ..., floor(P / 2^10) up to 10 levels.
 */
async function generateSetuKoshNode(tx, memberId, nodeMarginPaise, isPinActive, sourceIdCardId = null) {
  // 1. Increment atomic global counter
  const counter = await tx.systemCounter.upsert({
    where: { id: SYSTEM_COUNTER_ID },
    update: { currentValue: { increment: 1 } },
    create: { id: SYSTEM_COUNTER_ID, currentValue: 1 }
  });

  const globalPosition = counter.currentValue;

  let parentNodeId = null;
  let side = null;
  let depthLevel = 0;

  // 2. Position Math for Parent and Side
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

  // 3. Insert Node
  const newNode = await tx.setuKoshNode.create({
    data: {
      memberId,
      globalPosition,
      parentNodeId,
      side,
      depthLevel
    }
  });

  // 4. Distribute L1-L10 Upline Commissions
  if (parentNodeId && nodeMarginPaise > 0) {
    const splits = calculateCommissionSplits(nodeMarginPaise, SETU_KOSH_THRESHOLD_PAISE);
    const status = isPinActive ? "PENDING_SETTLEMENT" : "PIN_GATE_INACTIVE";

    let currentNodeId = parentNodeId;
    let currentLevel = 1;

    while (currentNodeId && currentLevel <= 10) {
      const ancestor = await tx.setuKoshNode.findUnique({
        where: { id: currentNodeId },
        include: { member: { include: { idCards: true } } }
      });

      if (!ancestor) break;

      const mainIdCard = ancestor.member.idCards.find(c => c.type === "MAIN") || ancestor.member.idCards[0];
      const amountPaise = splits.levelAmounts[currentLevel] || 0;

      if (mainIdCard && amountPaise > 0) {
        await tx.commissionEntry.create({
          data: {
            idCardId: mainIdCard.id,
            stream: "SETU_KOSH",
            level: currentLevel,
            amountPaise,
            status,
            sourceIdCardId
          }
        });
      }

      currentNodeId = ancestor.parentNodeId;
      currentLevel++;
    }
  }

  return newNode;
}

/**
 * Records a member's purchase at a partner vendor.
 * Accumulates spend and margin into SetuKoshCounter.
 * When threshold (₹1,000) is reached, creates k IDs and distributes upline commissions.
 */
async function recordPurchase(memberId, vendorId, amountPaise, options = {}) {
  const { idCardId = null, idempotencyKey = null, bypassPinCheck = false } = options;

  return await prisma.$transaction(async (tx) => {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingSale = await tx.vendorSale.findUnique({
        where: { idempotencyKey }
      });
      if (existingSale) {
        return {
          vendorSale: existingSale,
          alreadyProcessed: true
        };
      }
    }

    // 2. Validate Vendor and Active Status
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      include: { member: true }
    });

    if (!vendor || (vendor.status !== "ACTIVE" && vendor.status !== "VERIFIED")) {
      throw new Error(`Vendor ${vendorId} is not active or verified (Status: ${vendor?.status || 'NOT_FOUND'})`);
    }

    // 3. Snapshot Vendor Margin
    const marginPaise = Math.floor((amountPaise * vendor.marginRatePct) / 100);

    // 4. Create VendorSale Record
    const vendorSale = await tx.vendorSale.create({
      data: {
        vendorId,
        memberId,
        idCardId,
        amountPaise,
        marginPaise,
        idempotencyKey: idempotencyKey || null,
        status: "COMPLETED"
      }
    });

    // 5. Evaluate PIN Code Gate
    const buyer = await tx.member.findUnique({
      where: { id: memberId },
      include: { idCards: { include: { mySystemNode: true } } }
    });

    const pinCheck = await isPinCodeActive(tx, buyer?.pinCode);
    const isPinActive = bypassPinCheck || pinCheck.active;

    // Resolve buyer card
    let buyerCard = null;
    if (idCardId) {
      buyerCard = buyer?.idCards.find(c => c.id === idCardId);
    }
    if (!buyerCard) {
      buyerCard = buyer?.idCards.find(c => c.type === "MAIN") || buyer?.idCards[0];
    }
    const sourceCardId = buyerCard?.id || null;

    // Activate existing locked commissions in this PIN if threshold just reached
    if (isPinActive && buyer?.pinCode) {
      await activatePinGateCommissions(tx, buyer.pinCode);
    }

    // 6. Referral Bonus (0.25% or dynamic BPS to MY SYSTEM sponsor)
    const bonusBps = await adminService.getSetting("SETU_KOSH_REFERRAL_BONUS_BPS", 25, "integer");
    const bonusPaise = Math.floor((amountPaise * bonusBps) / 10000);
    if (bonusPaise > 0) {
      let sponsorCardId = buyerCard?.mySystemNode?.sponsorIdCardId ||
        (buyerCard?.mySystemNode?.parentNodeId
          ? (await tx.mySystemNode.findUnique({ where: { id: buyerCard.mySystemNode.parentNodeId } }))?.idCardId
          : null);

      // Confirmation C1: Fallback to owner's MAIN card MY SYSTEM sponsor if current card has no MY SYSTEM node (e.g. REBIRTH)
      if (!sponsorCardId) {
        const ownerMainCard = buyer?.idCards.find(c => c.type === "MAIN") ||
          (await tx.memberIdCard.findFirst({ where: { memberId, type: "MAIN" }, include: { mySystemNode: true } }));

        if (ownerMainCard?.mySystemNode) {
          sponsorCardId = ownerMainCard.mySystemNode.sponsorIdCardId ||
            (ownerMainCard.mySystemNode.parentNodeId
              ? (await tx.mySystemNode.findUnique({ where: { id: ownerMainCard.mySystemNode.parentNodeId } }))?.idCardId
              : null);
        }
      }

      if (sponsorCardId) {
        const sponsorCard = await tx.memberIdCard.findUnique({
          where: { id: sponsorCardId }
        });

        if (sponsorCard) {
          await tx.commissionEntry.create({
            data: {
              idCardId: sponsorCard.id,
              stream: "VENDOR_REFERRAL_BONUS",
              level: 1,
              amountPaise: bonusPaise,
              status: isPinActive ? "PENDING_SETTLEMENT" : "PIN_GATE_INACTIVE",
              sourceIdCardId: sourceCardId
            }
          });

          await tx.vendorReferralBonus.create({
            data: {
              memberId: sponsorCard.memberId,
              referredVendorId: vendorId,
              bonusPaise,
              status: isPinActive ? "PENDING" : "PIN_GATE_INACTIVE"
            }
          });
        }
      }
    }

    // 7. Unified Margin Accumulation on SetuKoshCounter
    const counter = await tx.setuKoshCounter.upsert({
      where: { memberId },
      create: {
        memberId,
        counterPaise: amountPaise,
        accumulatedMarginPaise: marginPaise
      },
      update: {
        counterPaise: { increment: amountPaise },
        accumulatedMarginPaise: { increment: marginPaise }
      }
    });

    const newCounterPaise = counter.counterPaise;
    const accMarginPaise = counter.accumulatedMarginPaise;

    const counterThresholdPaise = await adminService.getSetting("SETU_KOSH_COUNTER_THRESHOLD_PAISE", SETU_KOSH_THRESHOLD_PAISE, "integer");
    const k = Math.floor(newCounterPaise / counterThresholdPaise);

    let remainingCounterPaise = newCounterPaise;
    let remainingMarginPaise = accMarginPaise;
    const createdNodes = [];

    // 8. Distribute ONLY when >= 1 new ID is generated
    if (k >= 1) {
      const marginPerNode = Math.floor(accMarginPaise / k);

      for (let i = 0; i < k; i++) {
        const node = await generateSetuKoshNode(tx, memberId, marginPerNode, isPinActive, sourceCardId);
        createdNodes.push(node);
      }

      const processedSpend = k * SETU_KOSH_THRESHOLD_PAISE;
      const processedMargin = k * marginPerNode;

      remainingCounterPaise = newCounterPaise - processedSpend;
      remainingMarginPaise = accMarginPaise - processedMargin;

      await tx.setuKoshCounter.update({
        where: { memberId },
        data: {
          counterPaise: remainingCounterPaise,
          accumulatedMarginPaise: remainingMarginPaise,
          idsCreated: { increment: k }
        }
      });
    }

    return {
      vendorSale,
      idsCreated: k,
      nodes: createdNodes,
      currentCounterPaise: remainingCounterPaise,
      accumulatedMarginPaise: remainingMarginPaise,
      isPinActive
    };
  }, {
    timeout: 30000
  });
}

/**
 * Settlement Hook (for Wave 4):
 * Releases PENDING_SETTLEMENT commissions to WITHDRAWABLE and credits wallets.
 * No Pay-Once or ACB checks required for Setu Kosh.
 */
async function settlePending(tx, settlementRunId = null) {
  const pendingCommissions = await tx.commissionEntry.findMany({
    where: {
      stream: { in: ["SETU_KOSH", "VENDOR_REFERRAL_BONUS"] },
      status: "PENDING_SETTLEMENT"
    },
    include: { idCard: true }
  });

  let totalSettledPaise = 0;

  for (const comm of pendingCommissions) {
    await tx.commissionEntry.update({
      where: { id: comm.id },
      data: { status: "WITHDRAWABLE", confirmedAt: new Date() }
    });

    await walletService.credit(
      tx,
      comm.idCard.memberId,
      comm.amountPaise,
      comm.stream,
      comm.id,
      `Weekly Settlement Release for ${comm.stream}`
    );

    totalSettledPaise += comm.amountPaise;
  }

  return {
    settledCount: pendingCommissions.length,
    totalSettledPaise
  };
}

/**
 * Returns member's current counter status, earned cards, and referral bonuses.
 */
async function getMemberCounter(memberId) {
  const [counter, referralBonuses, earnedIdCards] = await Promise.all([
    prisma.setuKoshCounter.findUnique({
      where: { memberId }
    }),
    prisma.vendorReferralBonus.findMany({
      where: { memberId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.memberIdCard.findMany({
      where: { memberId, type: "SUB" },
      select: { id: true, cardNumber: true, type: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const counterPaise = counter?.counterPaise || 0;
  const idsCreated = counter?.idsCreated || 0;
  const accumulatedMarginPaise = counter?.accumulatedMarginPaise || 0;
  const progressPct = Math.min(100, Math.floor((counterPaise * 100) / SETU_KOSH_THRESHOLD_PAISE));
  const remainingPaise = Math.max(0, SETU_KOSH_THRESHOLD_PAISE - counterPaise);

  return {
    memberId,
    counterPaise,
    accumulatedMarginPaise,
    idsCreated,
    thresholdPaise: SETU_KOSH_THRESHOLD_PAISE,
    progressPct,
    remainingPaise,
    referralBonuses: referralBonuses || [],
    earnedIdCards: earnedIdCards || []
  };
}

/**
 * Returns 10-level tree for AutoPool/Setu Kosh explorer navigation.
 */
async function getSetuKoshTree(rootPosition = 1, maxDepth = 10) {
  const root = await prisma.setuKoshNode.findUnique({
    where: { globalPosition: parseInt(rootPosition, 10) },
    include: { member: { select: { id: true, name: true, memberCode: true } } }
  });

  if (!root) return null;

  const allNodes = await prisma.setuKoshNode.findMany({
    include: { member: { select: { id: true, name: true, memberCode: true } } }
  });

  const nodeMap = {};
  for (const n of allNodes) {
    nodeMap[n.globalPosition] = n;
  }

  function buildTree(pos, depth) {
    const node = nodeMap[pos];
    if (!node || depth > maxDepth) return null;

    const leftPos = pos * 2;
    const rightPos = pos * 2 + 1;

    return {
      position: node.globalPosition,
      level: node.depthLevel,
      side: node.side,
      memberId: node.memberId,
      memberName: node.member.name,
      memberCode: node.member.memberCode,
      children: {
        LEFT: nodeMap[leftPos] ? buildTree(leftPos, depth + 1) : null,
        RIGHT: nodeMap[rightPos] ? buildTree(rightPos, depth + 1) : null
      }
    };
  }

  return {
    rootNode: root,
    tree: buildTree(root.globalPosition, 0),
    totalNodes: allNodes.length
  };
}

module.exports = {
  isPinCodeActive,
  activatePinGateCommissions,
  calculateCommissionSplits,
  generateSetuKoshNode,
  recordPurchase,
  settlePending,
  getMemberCounter,
  getSetuKoshTree,
  SETU_KOSH_THRESHOLD_PAISE,
  SYSTEM_COUNTER_ID
};
