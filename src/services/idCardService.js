const prisma = require("../lib/prisma");
const commissionService = require("./commissionService");
const acbService = require("./acbService");
const rebirthService = require("./rebirthService");
const adminService = require("./adminService");

async function purchaseIds(memberId, count, sponsorIdCardId = null, sponsorSide = null) {
  const existingCards = await prisma.memberIdCard.findMany({ where: { memberId } });

  // Enforce MAX_PURCHASED_IDS (rebirths are exempt)
  const maxPurchasedIds = await adminService.getSetting("MAX_PURCHASED_IDS", 255, "integer");
  const nonRebirthCount = existingCards.filter(c => c.type !== "REBIRTH").length;
  if (nonRebirthCount + count > maxPurchasedIds) {
    const err = new Error(`Cannot purchase ${count} IDs. Member already owns ${nonRebirthCount} purchased IDs (Limit: ${maxPurchasedIds}).`);
    err.code = "ID_PURCHASE_LIMIT_REACHED";
    err.status = 400;
    throw err;
  }

  const hasMain = existingCards.some(c => c.type === "MAIN");
  const bulkMode = count > 1;

  // Snapshot the member's existing MY SYSTEM tree ONCE (pure JS state from here on)
  const existingNodes = await prisma.mySystemNode.findMany({ where: { idCard: { memberId } } });
  const childrenMap = {};
  const nodeCardMap = {};
  for (const n of existingNodes) {
    nodeCardMap[n.id] = n.idCardId;
    if (n.parentNodeId) {
      if (!childrenMap[n.parentNodeId]) childrenMap[n.parentNodeId] = [];
      childrenMap[n.parentNodeId].push({ id: n.id, side: n.side });
    }
  }

  let existingMainNodeId = null;
  if (hasMain) {
    const mainCard = existingCards.find(c => c.type === "MAIN");
    const mn = existingNodes.find(n => n.idCardId === mainCard.id);
    if (mn) existingMainNodeId = mn.id;
  }

  const newCards = [];
  let firstMySystemNodeId = existingMainNodeId;

  await prisma.$transaction(async (tx) => {
    let counterExists = await tx.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });
    if (!counterExists) {
      const maxNode = await tx.autoPoolNode.findFirst({ orderBy: { globalPosition: "desc" } });
      const seedPosition = maxNode ? maxNode.globalPosition : 0;
      counterExists = await tx.systemCounter.upsert({
        where: { id: "AUTOPOOL_GLOBAL" },
        update: {},
        create: { id: "AUTOPOOL_GLOBAL", currentValue: seedPosition }
      });
    }

    const queue = [];
    for (let i = 0; i < count; i++) {
      queue.push({ memberId, type: (!hasMain && i === 0) ? "MAIN" : "SUB", sponsorIdCardId, sponsorSide });
    }

    let processedCount = 0;
    while (queue.length > 0) {
      if (processedCount++ >= 500) throw new Error("Queue limit of 500 exceeded.");
      const item = queue.shift();

      const counter = await tx.systemCounter.update({ where: { id: "AUTOPOOL_GLOBAL" }, data: { currentValue: { increment: 1 } } });
      const globalPosition = counter.currentValue;

      let autoPoolParentNodeId = null, autoPoolSide = null;
      if (globalPosition > 1) {
        const parentNode = await tx.autoPoolNode.findUnique({ where: { globalPosition: Math.floor(globalPosition / 2) } });
        if (parentNode) { autoPoolParentNodeId = parentNode.id; autoPoolSide = (globalPosition % 2 === 0) ? "LEFT" : "RIGHT"; }
      }

      const prefix = item.type === "SUB" ? "SB" : (item.type === "REBIRTH" ? "RB" : "BB");
      const cardNumber = prefix + String(10000 + globalPosition).padStart(5, "0");

      // Ensure memberCode matches MAIN card number (BBxxxxx)
      if (item.type === "MAIN") {
        await tx.member.update({
          where: { id: item.memberId },
          data: { memberCode: cardNumber }
        });
      }

      const idCard = await tx.memberIdCard.create({
        data: { memberId: item.memberId, cardNumber, type: item.type, status: "ACTIVE", acbStatus: false }
      });

      await tx.autoPoolNode.create({
        data: { idCardId: idCard.id, parentNodeId: autoPoolParentNodeId, side: autoPoolSide, globalPosition, depthLevel: Math.floor(Math.log2(globalPosition)) }
      });

      let mySystemNode = null;
      if (item.type !== "REBIRTH") {
        mySystemNode = await placeInMySystem(tx, idCard, item.memberId, item.type, item.sponsorIdCardId, item.sponsorSide, bulkMode, firstMySystemNodeId, childrenMap, nodeCardMap);
        if (mySystemNode && !firstMySystemNodeId) firstMySystemNodeId = mySystemNode.id;
      }

      await commissionService.checkAutoPoolLevelCompletion(tx, globalPosition);
      if (mySystemNode) await commissionService.checkMySystemLevelCompletion(tx, mySystemNode.id);

      // 1. Evaluate ACB for direct tree sponsor (enables SUB cards with L+R referrals to unlock ACB)
      if (mySystemNode && mySystemNode.sponsorIdCardId) {
        const treeSponsor = await tx.memberIdCard.findUnique({ where: { id: mySystemNode.sponsorIdCardId } });
        if (treeSponsor && !treeSponsor.acbStatus) {
          if (await acbService.checkAcbStatus(tx, treeSponsor.id)) {
            await acbService.unlockAcb(tx, treeSponsor.id);
            await acbService.unlockLockedEarnings(tx, treeSponsor.id);
          }
        }
      }

      // 2. Evaluate ACB for purchasing member's MAIN card
      const mainCard = await tx.memberIdCard.findFirst({ where: { memberId: item.memberId, type: "MAIN" } });
      if (mainCard && !mainCard.acbStatus) {
        if (await acbService.checkAcbStatus(tx, mainCard.id)) {
          await acbService.unlockAcb(tx, mainCard.id);
          await acbService.unlockLockedEarnings(tx, mainCard.id);
        }
      }

      // 3. Evaluate ACB for external batch sponsor if distinct
      if (item.sponsorIdCardId && (!mySystemNode || item.sponsorIdCardId !== mySystemNode.sponsorIdCardId)) {
        const sponsorCard = await tx.memberIdCard.findUnique({ where: { id: item.sponsorIdCardId } });
        if (sponsorCard && !sponsorCard.acbStatus) {
          if (await acbService.checkAcbStatus(tx, sponsorCard.id)) {
            await acbService.unlockAcb(tx, sponsorCard.id);
            await acbService.unlockLockedEarnings(tx, sponsorCard.id);
          }
        }
      }

      const rebirths = await rebirthService.checkAndProcessRebirths(tx, globalPosition);
      if (rebirths.length > 0) queue.unshift(...rebirths);
      newCards.push(idCard);
    }
  }, { timeout: 30000 });

  return newCards;
}

async function findSpillSlot(tx, sponsorNodeId, preferredSide) {
  let currentId = sponsorNodeId;
  while (true) {
    const child = await tx.mySystemNode.findFirst({ where: { parentNodeId: currentId, side: preferredSide } });
    if (!child) return { parentNodeId: currentId, side: preferredSide };
    currentId = child.id;
  }
}

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

async function placeInMySystem(tx, idCard, memberId, type, sponsorIdCardId, sponsorSide, bulkMode, bulkRootNodeId, childrenMap, nodeCardMap) {
  if (idCard.type === "REBIRTH") return null;

  if (type === "MAIN") {
    if (sponsorIdCardId && sponsorSide) {
      const sponsorNode = await tx.mySystemNode.findUnique({ where: { idCardId: sponsorIdCardId } });
      if (sponsorNode) {
        const slot = await findSpillSlot(tx, sponsorNode.id, sponsorSide);
        const node = await tx.mySystemNode.create({ data: { idCardId: idCard.id, parentNodeId: slot.parentNodeId, side: slot.side, placementType: "SPONSOR", sponsorIdCardId } });
        if (!childrenMap[slot.parentNodeId]) childrenMap[slot.parentNodeId] = [];
        childrenMap[slot.parentNodeId].push({ id: node.id, side: slot.side });
        nodeCardMap[node.id] = idCard.id;
        return node;
      }
    }
    const node = await tx.mySystemNode.create({ data: { idCardId: idCard.id, parentNodeId: null, side: null, placementType: "ROOT", sponsorIdCardId: null } });
    nodeCardMap[node.id] = idCard.id;
    return node;
  }

  // SUB ID
  let rootNodeId = bulkRootNodeId;
  if (!rootNodeId) {
    const mainCard = await tx.memberIdCard.findFirst({ where: { memberId, type: "MAIN" } });
    if (!mainCard) throw new Error("MAIN ID not found for SUB placement");
    let mn = null;
    for (const nid of Object.keys(nodeCardMap)) { if (nodeCardMap[nid] === mainCard.id) { mn = nid; break; } }
    if (!mn) {
      const dbn = await tx.mySystemNode.findFirst({ where: { idCardId: mainCard.id } });
      if (!dbn) throw new Error("MAIN ID MY SYSTEM node not found. Run Nuke script.");
      mn = dbn.id;
    }
    rootNodeId = mn;
  }

  const position = nextSlot(childrenMap, rootNodeId);
  const sponsorCardId = nodeCardMap[position.parentNodeId] || null;

  const node = await tx.mySystemNode.create({
    data: { idCardId: idCard.id, parentNodeId: position.parentNodeId, side: position.side, placementType: "AUTO", sponsorIdCardId: sponsorCardId }
  });

  // Update pure-JS tree state instantly (no DB read-back)
  if (!childrenMap[position.parentNodeId]) childrenMap[position.parentNodeId] = [];
  childrenMap[position.parentNodeId].push({ id: node.id, side: position.side });
  nodeCardMap[node.id] = idCard.id;

  return node;
}

module.exports = { purchaseIds };