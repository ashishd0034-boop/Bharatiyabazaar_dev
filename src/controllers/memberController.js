const prisma = require("../lib/prisma");

async function getProfile(req, res, next) {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      include: {
        mainWallet: true,
        idCards: true,
        vouchers: true
      }
    });

    const activeCard = member.idCards.find(c => c.cardNumber === req.loginContext?.loginCardNumber) || 
                       member.idCards.find(c => c.type === "MAIN") || 
                       member.idCards[0];

    res.json({
      success: true,
      data: {
        ...member,
        activeCard: activeCard ? {
          id: activeCard.id,
          cardNumber: activeCard.cardNumber,
          type: activeCard.type,
          acbStatus: activeCard.acbStatus
        } : null
      }
    });
  } catch (err) {
    next(err);
  }
}

async function updateKyc(req, res, next) {
  try {
    const { panNumber, panCardUrl, aadhaarFrontUrl, aadhaarBackUrl } = req.body;

    const updated = await prisma.member.update({
      where: { id: req.member.id },
      data: {
        panNumber,
        kycStatus: "PENDING"
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

// ===== NEW: MY SYSTEM Binary Tree =====
async function getMySystemTree(req, res, next) {
  try {
    // 🛡️ REBIRTH cards do not participate in MY SYSTEM
    if (req.loginContext?.loginCardType === "REBIRTH") {
      return res.json({
        success: true,
        data: null,
        isRebirth: true,
        message: "Rebirth IDs participate exclusively in AutoPool."
      });
    }

    const memberId = req.member.id;
    const targetCard = req.loginContext?.isSubCard && req.loginContext?.loginCardId
      ? await prisma.memberIdCard.findUnique({ where: { id: req.loginContext.loginCardId } })
      : await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });

    if (!targetCard) {
      return res.json({ success: true, data: null });
    }

    const rootNode = await prisma.mySystemNode.findUnique({
      where: { idCardId: targetCard.id }
    });

    if (!rootNode) {
      return res.json({ success: true, data: null });
    }

    // sponsorCard sits NEXT TO idCard (it belongs to MySystemNode)
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

    res.json({ success: true, data: { tree, stats } });
  } catch (err) {
    next(err);
  }
}

async function getAutoPoolTree(req, res, next) {
  try {
    const memberId = req.member.id;

    const targetCard = req.loginContext?.loginCardId
      ? await prisma.memberIdCard.findUnique({ where: { id: req.loginContext.loginCardId } })
      : await prisma.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });

    const myPoolNode = targetCard
      ? await prisma.autoPoolNode.findUnique({ where: { idCardId: targetCard.id } })
      : null;

    // 🆕 Added mySystemNode → sponsorCard chain for sponsor tracking
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
        cardType: n.idCard.type,                                  // 🆕
        acbStatus: n.idCard.acbStatus,
        acbUnlockedAt: n.idCard.acbUnlockedAt || null,            // 🆕
        joinedAt: n.idCard.createdAt,                             // 🆕
        sponsorCode: n.idCard.mySystemNode?.sponsorCard?.member?.memberCode || null,  // 🆕
        sponsorName: n.idCard.mySystemNode?.sponsorCard?.member?.name || null         // 🆕
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

      // Live level completion for MY pool cycle (business rules)
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

    res.json({ success: true, data: { globalTree, myTree, myStats, levelStatus } });
  } catch (err) {
    next(err);
  }
}

async function checkAvailability(req, res, next) {
  try {
    const { mobile, email } = req.query;
    
    if (!mobile) {
      return res.status(400).json({ success: false, message: "Mobile is required" });
    }

    const existingMobile = await prisma.member.findUnique({ where: { mobile } });
    if (existingMobile) {
      return res.json({ 
        success: true, 
        available: false, 
        reason: "mobile",
        message: "This mobile number is already registered"
      });
    }

    if (email) {
      const existingEmail = await prisma.member.findFirst({ where: { email } });
      if (existingEmail) {
        return res.json({
          success: true,
          available: false,
          reason: "email",
          message: "This email is already registered"
        });
      }
    }

    res.json({ success: true, available: true });
  } catch (err) {
    next(err);
  }
}

// Add to module.exports:
module.exports = {
  getProfile,
  updateKyc,
  getMySystemTree,
  getAutoPoolTree,
  checkAvailability  // 🆕
};

// 🆕 "Who sponsored me & where am I placed?"
async function getMyPlacement(req, res, next) {
  try {
    if (req.loginContext?.loginCardType === "REBIRTH") {
      return res.json({ success: true, data: null, message: "Rebirth IDs are not placed in MY SYSTEM." });
    }

    const targetCardId = req.loginContext?.isSubCard && req.loginContext?.loginCardId
      ? req.loginContext.loginCardId
      : (await prisma.memberIdCard.findFirst({ where: { memberId: req.member.id, type: "MAIN" } }))?.id;

    if (!targetCardId) return res.json({ success: true, data: null });

    const node = await prisma.mySystemNode.findUnique({
      where: { idCardId: targetCardId },
      include: {
        idCard: { include: { member: { select: { memberCode: true, name: true } } } },
        sponsorCard: { include: { member: { select: { memberCode: true, name: true } } } },
        parent: { include: { idCard: { include: { member: { select: { memberCode: true, name: true } } } } } }
      }
    });

    if (!node) return res.json({ success: true, data: null });

    res.json({
      success: true,
      data: {
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
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports.getMyPlacement = getMyPlacement;

// 🆕 Total IDs this member has sponsored (true direct referrals)
async function getMyReferralCount(req, res, next) {
  try {
    if (req.loginContext?.loginCardType === "REBIRTH") {
      return res.json({ success: true, data: { directReferrals: 0, left: 0, right: 0, total: 0 } });
    }

    const targetCardId = req.loginContext?.isSubCard && req.loginContext?.loginCardId
      ? req.loginContext.loginCardId
      : (await prisma.memberIdCard.findFirst({ where: { memberId: req.member.id, type: "MAIN" } }))?.id;

    if (!targetCardId) return res.json({ success: true, data: { directReferrals: 0, left: 0, right: 0, total: 0 } });

    const [leftCount, rightCount] = await Promise.all([
      prisma.mySystemNode.count({ where: { sponsorIdCardId: targetCardId, side: "LEFT" } }),
      prisma.mySystemNode.count({ where: { sponsorIdCardId: targetCardId, side: "RIGHT" } })
    ]);

    res.json({
      success: true,
      data: {
        directReferrals: leftCount + rightCount,
        left: leftCount,
        right: rightCount,
        total: leftCount + rightCount
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports.getMyReferralCount = getMyReferralCount;

// 🆕 AutoPool Deep Explorer (Sparse Tree: up to 7 levels, stops at empty frontier)
async function getAutoPoolExplorer(req, res, next) {
  try {
    const { root, depth = 7 } = req.query;
    const maxDepth = Math.min(Math.max(parseInt(depth) || 7, 1), 7);

    // 1. Resolve root card and AutoPoolNode
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
      // Default to active login card
      const targetCardId = req.loginContext?.loginCardId
        ? req.loginContext.loginCardId
        : (await prisma.memberIdCard.findFirst({ where: { memberId: req.member.id, type: "MAIN" } }))?.id;

      rootNode = await prisma.autoPoolNode.findUnique({
        where: { idCardId: targetCardId },
        include: { idCard: { include: { member: true } } }
      });
      rootCard = rootNode?.idCard;
    }

    if (!rootNode || !rootCard) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `AutoPool node for "${root || 'active card'}" not found.` }
      });
    }

    const p = rootNode.globalPosition;

    // 2. Fetch all nodes in the 7-level subtree range via index-backed query
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

    // 3. Sparse Tree Builder:
    // Only continue deeper if current node is FILLED.
    // If a child is EMPTY, output terminal empty slot (filled: false) and STOP recursing.
    function buildSparseTree(pos, levelsLeft, currentDepth) {
      const node = positionMap[pos];
      if (!node) {
        // Terminal empty slot directly beneath a filled parent
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

    res.json({
      success: true,
      data: {
        rootNode: positionMap[p],
        tree,
        depth: maxDepth,
        totalFilled: allNodes.length
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports.getAutoPoolExplorer = getAutoPoolExplorer;
