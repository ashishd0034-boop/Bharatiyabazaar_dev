const prisma = require("../core/database/prisma");
const commissionService = require("../core/services/commission.service");
const acbService = require("../core/services/acb.service");
const rebirthService = require("./rebirthService");
const adminService = require("../core/services/system-settings.service");
const { placeInMySystem } = require("../modules/my-system/my-system.service");

async function purchaseIds(memberId, count, sponsorIdCardId = null, sponsorSide = null, externalTx = null) {
  const db = externalTx || prisma;
  const existingCards = await db.memberIdCard.findMany({ where: { memberId } });

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
  const existingNodes = await db.mySystemNode.findMany({ where: { idCard: { memberId } } });
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

  const runLogic = async (tx) => {
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
        if (treeSponsor && treeSponsor.type !== "REBIRTH" && !treeSponsor.acbStatus) {
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
        if (sponsorCard && sponsorCard.type !== "REBIRTH" && !sponsorCard.acbStatus) {
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
  };

  if (externalTx) {
    await runLogic(externalTx);
  } else {
    await prisma.$transaction(runLogic, { timeout: 30000 });
  }

  return newCards;
}

module.exports = { purchaseIds };