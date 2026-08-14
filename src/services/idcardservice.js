const prisma = require("../lib/prisma");

async function purchaseIds(memberId, count, sponsorIdCardId = null, sponsorSide = null) {
  // 1. Check if member already has a MAIN ID
  const existingCards = await prisma.memberIdCard.findMany({
    where: { memberId }
  });
  const hasMain = existingCards.some(c => c.type === "MAIN");

  const newCards = [];

  // 2. Create the requested number of IDs
  for (let i = 0; i < count; i++) {
    const type = (!hasMain && i === 0) ? "MAIN" : "SUB";

    // ===== AUTOPOOL PLACEMENT =====
    const totalAutoPoolNodes = await prisma.autoPoolNode.count();
    const globalPosition = totalAutoPoolNodes + 1;

    let autoPoolParentNodeId = null;
    let autoPoolSide = null;

    if (globalPosition > 1) {
      const parentPosition = Math.floor(globalPosition / 2);
      const parentNode = await prisma.autoPoolNode.findUnique({
        where: { globalPosition: parentPosition }
      });

      if (parentNode) {
        autoPoolParentNodeId = parentNode.id;
        autoPoolSide = (globalPosition % 2 === 0) ? "LEFT" : "RIGHT";
      }
    }

    const depthLevel = Math.floor(Math.log2(globalPosition));

    // ===== CREATE ID CARD =====
    const idCard = await prisma.memberIdCard.create({
      data: {
        memberId,
        cardNumber: `BB${String(10000 + globalPosition).padStart(5, '0')}`,
        type,
        status: "ACTIVE",
        acbStatus: false
      }
    });

    // ===== CREATE AUTOPOOL NODE =====
    await prisma.autoPoolNode.create({
      data: {
        idCardId: idCard.id,
        parentNodeId: autoPoolParentNodeId,
        side: autoPoolSide,
        globalPosition,
        depthLevel
      }
    });

    // ===== MY SYSTEM PLACEMENT =====
    await placeInMySystem(idCard, memberId, type, sponsorIdCardId, sponsorSide);

    newCards.push(idCard);
  }

  return newCards;
}

async function placeInMySystem(idCard, memberId, type, sponsorIdCardId, sponsorSide) {
  // CASE 1: This is the member's first ID (MAIN)
  if (type === "MAIN") {
    // If there is a sponsor, place under sponsor's tree
    if (sponsorIdCardId && sponsorSide) {
      const sponsorNode = await prisma.mySystemNode.findUnique({
        where: { idCardId: sponsorIdCardId }
      });

      if (sponsorNode) {
        await prisma.mySystemNode.create({
          data: {
            idCardId: idCard.id,
            parentNodeId: sponsorNode.id,
            side: sponsorSide,
            placementType: "SPONSOR"
          }
        });
        return;
      }
    }

    // No sponsor — this is the root of member's own tree
    await prisma.mySystemNode.create({
      data: {
        idCardId: idCard.id,
        parentNodeId: null,
        side: null,
        placementType: "ROOT"
      }
    });
    return;
  }

  // CASE 2: This is a SUB ID — place under member's MAIN ID
  const mainCard = await prisma.memberIdCard.findFirst({
    where: {
      memberId,
      type: "MAIN"
    }
  });

  if (!mainCard) {
    throw new Error("MAIN ID not found for SUB placement");
  }

  const mainNode = await prisma.mySystemNode.findUnique({
    where: { idCardId: mainCard.id }
  });

  if (!mainNode) {
    throw new Error("MAIN ID MY SYSTEM node not found");
  }

  // Find next available position under MAIN using breadth-first
  const position = await findNextMySystemPosition(mainNode.id);

  await prisma.mySystemNode.create({
    data: {
      idCardId: idCard.id,
      parentNodeId: position.parentNodeId,
      side: position.side,
      placementType: "AUTO"
    }
  });
}

async function findNextMySystemPosition(rootNodeId) {
  // Get all nodes in this member's MY SYSTEM tree
  const allNodes = await prisma.mySystemNode.findMany();

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