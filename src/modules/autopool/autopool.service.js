const prisma = require("../../core/database/prisma");

/**
 * Retrieves the global and personal AutoPool tree structures, milestone progression, and earning stats.
 */
async function getAutoPoolTree(memberId, loginContext) {
  const targetCard = loginContext?.loginCardId
    ? await prisma.memberIdCard.findUnique({ where: { id: loginContext.loginCardId } })
    : await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });

  const myPoolNode = targetCard
    ? await prisma.autoPoolNode.findUnique({ where: { idCardId: targetCard.id } })
    : null;

  const allNodes = await prisma.autoPoolNode.findMany({
    include: {
      idCard: {
        include: {
          member: { select: { id: true, name: true, memberCode: true } },
          mySystemNode: {
            include: {
              sponsorCard: {
                include: {
                  member: { select: { name: true, memberCode: true } }
                }
              }
            }
          }
        }
      }
    }
  });

  const positionMap = {};
  for (const n of allNodes) {
    positionMap[n.globalPosition] = {
      id: n.id,
      position: n.globalPosition,
      level: n.depthLevel,
      side: n.side,
      memberId: n.idCard.member.id,
      memberName: n.idCard.member.name,
      memberCode: n.idCard.member.memberCode || n.idCard.cardNumber,
      cardNumber: n.idCard.cardNumber,
      cardType: n.idCard.type,
      acbStatus: n.idCard.acbStatus,
      acbUnlockedAt: n.idCard.acbUnlockedAt || null,
      joinedAt: n.idCard.createdAt,
      sponsorCode: n.idCard.mySystemNode?.sponsorCard?.member?.memberCode || null,
      sponsorName: n.idCard.mySystemNode?.sponsorCard?.member?.name || null
    };
  }

  function buildTree(pos, levelsLeft, currentDepth) {
    const node = positionMap[pos];
    const result = node
      ? { ...node, filled: true }
      : { position: pos, level: currentDepth, filled: false, side: pos % 2 === 0 ? "LEFT" : "RIGHT" };
    if (levelsLeft > 0) {
      result.children = {
        LEFT: buildTree(pos * 2, levelsLeft - 1, currentDepth + 1),
        RIGHT: buildTree(pos * 2 + 1, levelsLeft - 1, currentDepth + 1)
      };
    }
    return result;
  }

  const globalTree = buildTree(1, 4, 0);

  let myStats = null;
  let myTree = null;
  const levelStatus = [];

  if (myPoolNode && targetCard) {
    const p = myPoolNode.globalPosition;
    myTree = buildTree(p, 3, myPoolNode.depthLevel);

    let rebirthIds = 0, vouchersPaise = 0;

    for (let lvl = 1; lvl <= 7; lvl++) {
      const size = Math.pow(2, lvl);
      const start = p * size;
      let filled = 0;
      for (let i = start; i < start + size; i++) if (positionMap[i]) filled++;
      const complete = filled === size;
      if (complete) {
        if (lvl >= 4) rebirthIds += 1;
        if (lvl >= 5) vouchersPaise += 20000;
      }
      levelStatus.push({ level: lvl, size, filled, complete });
    }

    const apSum = await prisma.commissionEntry.aggregate({
      where: { idCardId: targetCard.id, stream: "AUTOPOOL" },
      _sum: { amountPaise: true }
    });
    const cashEarnedPaise = apSum._sum.amountPaise || 0;

    myStats = {
      position: p,
      level: myPoolNode.depthLevel,
      totalInPool: allNodes.length,
      highestLevel: Math.max(...allNodes.map(n => n.depthLevel)),
      cashEarnedPaise,
      rebirthIds,
      vouchersPaise
    };
  }

  return { globalTree, myTree, myStats, levelStatus };
}

/**
 * Mathematical range-based sparse tree explorer supporting queries up to depth 7.
 */
async function getAutoPoolExplorer(root, depth = 7, memberId, loginContext) {
  const maxDepth = Math.min(Math.max(parseInt(depth) || 7, 1), 7);

  let rootCard = null;
  let rootNode = null;

  if (root) {
    const rootStr = String(root).trim().toUpperCase();
    if (rootStr.startsWith("BB") || rootStr.startsWith("SB") || rootStr.startsWith("RB")) {
      rootCard = await prisma.memberIdCard.findUnique({
        where: { cardNumber: rootStr },
        include: { autoPoolNode: true, member: true }
      });
      rootNode = rootCard?.autoPoolNode;
    } else if (!isNaN(parseInt(rootStr))) {
      rootNode = await prisma.autoPoolNode.findUnique({
        where: { globalPosition: parseInt(rootStr) },
        include: { idCard: { include: { member: true } } }
      });
      rootCard = rootNode?.idCard;
    }
  } else {
    const targetCardId = loginContext?.loginCardId
      ? loginContext.loginCardId
      : (await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } }))?.id;

    rootNode = await prisma.autoPoolNode.findUnique({
      where: { idCardId: targetCardId },
      include: { idCard: { include: { member: true } } }
    });
    rootCard = rootNode?.idCard;
  }

  if (!rootNode || !rootCard) {
    const err = new Error(`AutoPool node for "${root || 'active card'}" not found.`);
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const p = rootNode.globalPosition;

  const ranges = [];
  for (let lvl = 0; lvl <= maxDepth; lvl++) {
    const start = p * Math.pow(2, lvl);
    const end = start + Math.pow(2, lvl) - 1;
    ranges.push({ globalPosition: { gte: start, lte: end } });
  }

  const allNodes = await prisma.autoPoolNode.findMany({
    where: { OR: ranges },
    include: {
      idCard: {
        include: {
          member: { select: { id: true, name: true, memberCode: true } },
          mySystemNode: {
            include: {
              sponsorCard: {
                include: {
                  member: { select: { name: true, memberCode: true } }
                }
              }
            }
          }
        }
      }
    }
  });

  const positionMap = {};
  for (const n of allNodes) {
    positionMap[n.globalPosition] = {
      id: n.id,
      position: n.globalPosition,
      level: n.depthLevel,
      side: n.side,
      memberId: n.idCard.member.id,
      memberName: n.idCard.member.name,
      memberCode: n.idCard.member.memberCode || n.idCard.cardNumber,
      cardNumber: n.idCard.cardNumber,
      cardType: n.idCard.type,
      acbStatus: n.idCard.acbStatus,
      acbUnlockedAt: n.idCard.acbUnlockedAt || null,
      joinedAt: n.idCard.createdAt,
      sponsorCode: n.idCard.mySystemNode?.sponsorCard?.member?.memberCode || null,
      sponsorName: n.idCard.mySystemNode?.sponsorCard?.member?.name || null
    };
  }

  function buildSparseTree(pos, levelsLeft, currentDepth) {
    const node = positionMap[pos];
    if (!node) {
      return {
        position: pos,
        level: currentDepth,
        filled: false,
        side: pos % 2 === 0 ? "LEFT" : "RIGHT"
      };
    }

    const result = {
      ...node,
      filled: true
    };

    if (levelsLeft > 0) {
      const leftPos = pos * 2;
      const rightPos = pos * 2 + 1;
      result.children = {
        LEFT: buildSparseTree(leftPos, levelsLeft - 1, currentDepth + 1),
        RIGHT: buildSparseTree(rightPos, levelsLeft - 1, currentDepth + 1)
      };
    }

    return result;
  }

  const tree = buildSparseTree(p, maxDepth, rootNode.depthLevel);

  return {
    rootNode: positionMap[p],
    tree,
    depth: maxDepth,
    totalFilled: allNodes.length
  };
}

module.exports = {
  getAutoPoolTree,
  getAutoPoolExplorer
};
