const prisma = require("../../core/database/prisma");

/**
 * Extreme-Left / Extreme-Right recursive spillover slot finder.
 * Recursively descends along the preferredSide (LEFT: P*2, P*4... / RIGHT: P*2+1, P*4+3...)
 * until an unoccupied slot is reached. Spillover nodes never cross into a sibling's subtree.
 */
async function findSpillSlot(tx, sponsorNodeId, preferredSide) {
  const db = tx || prisma;
  let currentId = sponsorNodeId;
  while (true) {
    const child = await db.mySystemNode.findFirst({ where: { parentNodeId: currentId, side: preferredSide } });
    if (!child) return { parentNodeId: currentId, side: preferredSide };
    currentId = child.id;
  }
}

/**
 * Breadth-first search for auto-filling SUB ID nodes under the member's own tree.
 */
function nextSlot(childrenMap, rootId) {
  const q = [rootId];
  while (q.length > 0) {
    const cur = q.shift();
    const kids = childrenMap[cur] || [];
    if (!kids.some(k => k.side === "LEFT")) return { parentNodeId: cur, side: "LEFT" };
    if (!kids.some(k => k.side === "RIGHT")) return { parentNodeId: cur, side: "RIGHT" };
    for (const k of kids) q.push(k.id);
  }
  throw new Error("No available position found in MY SYSTEM tree");
}

/**
 * Places a newly provisioned ID Card into the MY SYSTEM binary tree.
 * Preserves exact database transactions, coordinate math, and state caches.
 */
async function placeInMySystem(tx, idCard, memberId, type, sponsorIdCardId, sponsorSide, bulkMode, bulkRootNodeId, childrenMap, nodeCardMap) {
  const db = tx || prisma;
  if (idCard.type === "REBIRTH") return null;

  if (type === "MAIN") {
    if (sponsorIdCardId && sponsorSide) {
      const sponsorNode = await db.mySystemNode.findUnique({ where: { idCardId: sponsorIdCardId } });
      if (sponsorNode) {
        const slot = await findSpillSlot(db, sponsorNode.id, sponsorSide);
        const node = await db.mySystemNode.create({
          data: {
            idCardId: idCard.id,
            parentNodeId: slot.parentNodeId,
            side: slot.side,
            placementType: "SPONSOR",
            sponsorIdCardId
          }
        });
        if (childrenMap) {
          if (!childrenMap[slot.parentNodeId]) childrenMap[slot.parentNodeId] = [];
          childrenMap[slot.parentNodeId].push({ id: node.id, side: slot.side });
        }
        if (nodeCardMap) nodeCardMap[node.id] = idCard.id;
        return node;
      }
    }
    const node = await db.mySystemNode.create({
      data: {
        idCardId: idCard.id,
        parentNodeId: null,
        side: null,
        placementType: "ROOT",
        sponsorIdCardId: null
      }
    });
    if (nodeCardMap) nodeCardMap[node.id] = idCard.id;
    return node;
  }

  // SUB ID
  let rootNodeId = bulkRootNodeId;
  if (!rootNodeId) {
    const mainCard = await db.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });
    if (!mainCard) throw new Error("MAIN ID not found for SUB placement");
    let mn = null;
    if (nodeCardMap) {
      for (const nid of Object.keys(nodeCardMap)) {
        if (nodeCardMap[nid] === mainCard.id) {
          mn = nid;
          break;
        }
      }
    }
    if (!mn) {
      const dbn = await db.mySystemNode.findFirst({ where: { idCardId: mainCard.id } });
      if (!dbn) throw new Error("MAIN ID MY SYSTEM node not found. Run Nuke script.");
      mn = dbn.id;
    }
    rootNodeId = mn;
  }

  const position = nextSlot(childrenMap, rootNodeId);
  const sponsorCardId = nodeCardMap ? (nodeCardMap[position.parentNodeId] || null) : null;

  const node = await db.mySystemNode.create({
    data: {
      idCardId: idCard.id,
      parentNodeId: position.parentNodeId,
      side: position.side,
      placementType: "AUTO",
      sponsorIdCardId: sponsorCardId
    }
  });

  // Update pure-JS tree state instantly
  if (childrenMap) {
    if (!childrenMap[position.parentNodeId]) childrenMap[position.parentNodeId] = [];
    childrenMap[position.parentNodeId].push({ id: node.id, side: position.side });
  }
  if (nodeCardMap) nodeCardMap[node.id] = idCard.id;

  return node;
}

/**
 * Retrieves the full binary tree structure and leg metrics for a member.
 */
async function getGenealogyTree(memberId, loginContext) {
  if (loginContext?.loginCardType === "REBIRTH") {
    return {
      tree: null,
      stats: null,
      isRebirth: true,
      message: "Rebirth IDs participate exclusively in AutoPool."
    };
  }

  const targetCard = loginContext?.isSubCard && loginContext?.loginCardId
    ? await prisma.memberIdCard.findUnique({ where: { id: loginContext.loginCardId } })
    : await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });

  if (!targetCard) {
    return { tree: null, stats: null };
  }

  const rootNode = await prisma.mySystemNode.findUnique({
    where: { idCardId: targetCard.id }
  });

  if (!rootNode) {
    return { tree: null, stats: null };
  }

  const allNodes = await prisma.mySystemNode.findMany({
    include: {
      idCard: {
        include: {
          member: { select: { id: true, name: true, memberCode: true } }
        }
      },
      sponsorCard: {
        include: {
          member: { select: { name: true, memberCode: true } }
        }
      }
    }
  });

  function buildTree(nodeId, depth) {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node || depth > 6) return null;

    const children = allNodes.filter(n => n.parentNodeId === nodeId);
    const left = children.find(c => c.side === "LEFT");
    const right = children.find(c => c.side === "RIGHT");

    return {
      id: node.id,
      memberName: node.idCard.member.name,
      memberCode: node.idCard.member.memberCode,
      cardNumber: node.idCard.cardNumber,
      cardType: node.idCard.type,
      acbStatus: node.idCard.acbStatus,
      joinedAt: node.idCard.createdAt,
      acbUnlockedAt: node.idCard.acbUnlockedAt || null,
      side: node.side,
      placementType: node.placementType,
      sponsorName: node.sponsorCard?.member?.name || null,
      sponsorCode: node.sponsorCard?.member?.memberCode || null,
      sponsorCardNumber: node.sponsorCard?.cardNumber || null,
      parentId: node.parentNodeId,
      children: {
        LEFT: left ? buildTree(left.id, depth + 1) : null,
        RIGHT: right ? buildTree(right.id, depth + 1) : null
      }
    };
  }

  const tree = buildTree(rootNode.id, 0);

  function countLeg(node, side) {
    if (!node) return 0;
    let count = 0;
    if (node.side === side) count++;
    count += countLeg(node.children?.LEFT, side);
    count += countLeg(node.children?.RIGHT, side);
    return count;
  }

  const stats = {
    leftLegSize: countLeg(tree, "LEFT"),
    rightLegSize: countLeg(tree, "RIGHT"),
    totalNetwork: countLeg(tree, "LEFT") + countLeg(tree, "RIGHT"),
    hasDirectLeft: !!tree.children?.LEFT,
    hasDirectRight: !!tree.children?.RIGHT,
    acbStatus: targetCard.acbStatus
  };

  return { tree, stats };
}

/**
 * Returns placement metadata (sponsor & parent details).
 */
async function getMyPlacement(memberId, loginContext) {
  if (loginContext?.loginCardType === "REBIRTH") {
    return { isRebirth: true, message: "Rebirth IDs are not placed in MY SYSTEM." };
  }

  const targetCardId = loginContext?.isSubCard && loginContext?.loginCardId
    ? loginContext.loginCardId
    : (await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } }))?.id;

  if (!targetCardId) return null;

  const node = await prisma.mySystemNode.findUnique({
    where: { idCardId: targetCardId },
    include: {
      idCard: { include: { member: { select: { memberCode: true, name: true } } } },
      sponsorCard: { include: { member: { select: { memberCode: true, name: true } } } },
      parent: { include: { idCard: { include: { member: { select: { memberCode: true, name: true } } } } } }
    }
  });

  if (!node) return null;

  return {
    memberCode: node.idCard.member.memberCode,
    cardNumber: node.idCard.cardNumber,
    side: node.side,
    placementType: node.placementType,
    sponsoredBy: node.sponsorCard ? node.sponsorCard.member.memberCode : null,
    sponsoredByCard: node.sponsorCard ? node.sponsorCard.cardNumber : null,
    sponsorName: node.sponsorCard ? node.sponsorCard.member.name : null,
    placedUnder: node.parent ? node.parent.idCard.member.memberCode : null,
    placedUnderCard: node.parent ? node.parent.idCard.cardNumber : null,
    placedUnderName: node.parent ? node.parent.idCard.member.name : null
  };
}

/**
 * Calculates direct sponsored referral counts split by left and right leg.
 */
async function getDirectReferralCounts(memberId, loginContext) {
  if (loginContext?.loginCardType === "REBIRTH") {
    return { directReferrals: 0, left: 0, right: 0, total: 0 };
  }

  const targetCardId = loginContext?.isSubCard && loginContext?.loginCardId
    ? loginContext.loginCardId
    : (await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } }))?.id;

  if (!targetCardId) return { directReferrals: 0, left: 0, right: 0, total: 0 };

  const [leftCount, rightCount] = await Promise.all([
    prisma.mySystemNode.count({ where: { sponsorIdCardId: targetCardId, side: "LEFT" } }),
    prisma.mySystemNode.count({ where: { sponsorIdCardId: targetCardId, side: "RIGHT" } })
  ]);

  return {
    directReferrals: leftCount + rightCount,
    left: leftCount,
    right: rightCount,
    total: leftCount + rightCount
  };
}

module.exports = {
  findSpillSlot,
  nextSlot,
  placeInMySystem,
  getGenealogyTree,
  getMyPlacement,
  getDirectReferralCounts
};
