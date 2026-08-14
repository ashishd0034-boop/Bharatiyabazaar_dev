const prisma = require("../lib/prisma");
const commissionService = require("./commissionService");
const acbService = require("./acbService");
const rebirthService = require("./rebirthService");

async function purchaseIds(memberId, count, sponsorIdCardId = null, sponsorSide = null) {
  // 1. Check if member already has a MAIN ID
  const existingCards = await prisma.memberIdCard.findMany({
    where: { memberId }
  });
  const hasMain = existingCards.some(c => c.type === "MAIN");

  const newCards = [];

  await prisma.$transaction(async (tx) => {
    // Check if we need to seed the AutoPool counter (first run)
    let counterExists = await tx.systemCounter.findUnique({
      where: { id: "AUTOPOOL_GLOBAL" }
    });

    if (!counterExists) {
      const maxNode = await tx.autoPoolNode.findFirst({
        orderBy: { globalPosition: 'desc' }
      });
      const seedPosition = maxNode ? maxNode.globalPosition : 0;
      
      try {
        counterExists = await tx.systemCounter.upsert({
          where: { id: "AUTOPOOL_GLOBAL" },
          update: {},
          create: { id: "AUTOPOOL_GLOBAL", currentValue: seedPosition }
        });
      } catch (e) {
        if (e.code === 'P2002') {
          // Another concurrent transaction just created it. Refetch.
          counterExists = await tx.systemCounter.findUnique({
            where: { id: "AUTOPOOL_GLOBAL" }
          });
        } else {
          throw e;
        }
      }
    }

    // Build the initial queue of purchased IDs
    const queue = [];
    for (let i = 0; i < count; i++) {
      const type = (!hasMain && i === 0) ? "MAIN" : "SUB";
      queue.push({
        memberId,
        type,
        sponsorIdCardId,
        sponsorSide
      });
    }

    let processedCount = 0;

    while (queue.length > 0) {
      if (processedCount >= 500) {
        throw new Error("Queue limit of 500 exceeded. Aborting to prevent infinite loops.");
      }

      const item = queue.shift();
      processedCount++;

      // 1. Get next global position atomically
      const counter = await tx.systemCounter.update({
        where: { id: "AUTOPOOL_GLOBAL" },
        data: { currentValue: { increment: 1 } }
      });
      const globalPosition = counter.currentValue;

      // Calculate AutoPool parent
      let autoPoolParentNodeId = null;
      let autoPoolSide = null;

      if (globalPosition > 1) {
        const parentPosition = Math.floor(globalPosition / 2);
        const parentNode = await tx.autoPoolNode.findUnique({
          where: { globalPosition: parentPosition }
        });

        if (parentNode) {
          autoPoolParentNodeId = parentNode.id;
          autoPoolSide = (globalPosition % 2 === 0) ? "LEFT" : "RIGHT";
        }
      }

      const depthLevel = Math.floor(Math.log2(globalPosition));

      // 2. Create ID Card
      const idCard = await tx.memberIdCard.create({
        data: {
          memberId: item.memberId,
          cardNumber: `BB${String(10000 + globalPosition).padStart(5, '0')}`,
          type: item.type,
          status: "ACTIVE",
          acbStatus: false
        }
      });

      // 3. Create AutoPool Node
      await tx.autoPoolNode.create({
        data: {
          idCardId: idCard.id,
          parentNodeId: autoPoolParentNodeId,
          side: autoPoolSide,
          globalPosition,
          depthLevel
        }
      });

      // 4. Create MY SYSTEM Node (Bypass if REBIRTH)
      let mySystemNode = null;
      if (item.type !== "REBIRTH") {
        mySystemNode = await placeInMySystem(tx, idCard, item.memberId, item.type, item.sponsorIdCardId, item.sponsorSide);
      }

      // 5. Commission Hooks
      // 1. Trigger AutoPool completion check FIRST (tie-breaker logic)
      await commissionService.checkAutoPoolLevelCompletion(tx, globalPosition);

      // 2. Trigger MY SYSTEM completion check SECOND
      if (mySystemNode) {
        await commissionService.checkMySystemLevelCompletion(tx, mySystemNode.id);
      }

      // 6. ACB Unlock Check
      // After placing an ID, check the MAIN ID for ACB status.
      const mainCard = await tx.memberIdCard.findFirst({
        where: { memberId: item.memberId, type: "MAIN" }
      });
      
      if (mainCard && !mainCard.acbStatus) {
        const isAcb = await acbService.checkAcbStatus(tx, mainCard.id);
        if (isAcb) {
          await acbService.unlockAcb(tx, mainCard.id);
          await acbService.unlockLockedEarnings(tx, mainCard.id);
        }
      }

      // 7. Check Rebirths
      const rebirths = await rebirthService.checkAndProcessRebirths(tx, globalPosition);
      if (rebirths.length > 0) {
        // Prepend rebirths to the queue
        queue.unshift(...rebirths);
      }

      newCards.push(idCard);
    }
  }, { timeout: 30000 });

  return newCards;
}

async function placeInMySystem(tx, idCard, memberId, type, sponsorIdCardId, sponsorSide) {
  // Rebirth IDs do NOT get a MY SYSTEM node
  if (idCard.type === "REBIRTH") return null;

  // CASE 1: This is the member's first ID (MAIN)
  if (type === "MAIN") {
    // If there is a sponsor, place under sponsor's tree
    if (sponsorIdCardId && sponsorSide) {
      const sponsorNode = await tx.mySystemNode.findUnique({
        where: { idCardId: sponsorIdCardId }
      });

      if (sponsorNode) {
        const newNode = await tx.mySystemNode.create({
          data: {
            idCardId: idCard.id,
            parentNodeId: sponsorNode.id,
            side: sponsorSide,
            placementType: "SPONSOR"
          }
        });
        return newNode;
      }
    }

    // No sponsor — this is the root of member's own tree
    const newNode = await tx.mySystemNode.create({
      data: {
        idCardId: idCard.id,
        parentNodeId: null,
        side: null,
        placementType: "ROOT"
      }
    });
    return newNode;
  }

  // CASE 2: This is a SUB ID — place under member's MAIN ID
  const mainCard = await tx.memberIdCard.findFirst({
    where: {
      memberId,
      type: "MAIN"
    }
  });

  if (!mainCard) {
    throw new Error("MAIN ID not found for SUB placement");
  }

  const mainNode = await tx.mySystemNode.findUnique({
    where: { idCardId: mainCard.id }
  });

  if (!mainNode) {
    throw new Error("MAIN ID MY SYSTEM node not found");
  }

  // Find next available position under MAIN using breadth-first
  const position = await findNextMySystemPosition(tx, mainNode.id);

  const newNode = await tx.mySystemNode.create({
    data: {
      idCardId: idCard.id,
      parentNodeId: position.parentNodeId,
      side: position.side,
      placementType: "AUTO"
    }
  });
  return newNode;
}

async function findNextMySystemPosition(tx, rootNodeId) {
  // Get all nodes in this member's MY SYSTEM tree
  const allNodes = await tx.mySystemNode.findMany();

  // Build a map of nodeId -> children
  const childrenMap = {};
  for (const node of allNodes) {
    if (node.parentNodeId) {
      if (!childrenMap[node.parentNodeId]) {
        childrenMap[node.parentNodeId] = [];
      }
      childrenMap[node.parentNodeId].push(node);
    }
  }

  // BFS to find first node with an open slot
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    const children = childrenMap[currentNodeId] || [];

    const hasLeft = children.some(c => c.side === "LEFT");
    const hasRight = children.some(c => c.side === "RIGHT");

    if (!hasLeft) {
      return { parentNodeId: currentNodeId, side: "LEFT" };
    }
    if (!hasRight) {
      return { parentNodeId: currentNodeId, side: "RIGHT" };
    }

    // Both sides filled, add children to queue
    for (const child of children) {
      queue.push(child.id);
    }
  }

  throw new Error("No available position found in MY SYSTEM tree");
}

module.exports = {
  purchaseIds
};