const prisma = require("../database/prisma");
const payOnceService = require("./pay-once.service");
const walletService = require("./wallet.service");
const systemSettingsService = require("./system-settings.service");

const L_AMOUNTS = {
  1: 30000,
  2: 30000,
  3: 20000
};

// AutoPool logic
async function checkAutoPoolLevelCompletion(tx, newGlobalPosition) {
  const db = tx || prisma;
  for (let L = 1; L <= 7; L++) {
    const numerator = newGlobalPosition + 1 - Math.pow(2, L);
    const denominator = Math.pow(2, L);
    
    if (numerator % denominator === 0) {
      const ancestorPos = numerator / denominator;
      
      if (ancestorPos >= 1) {
        const ancestorNode = await db.autoPoolNode.findUnique({
          where: { globalPosition: ancestorPos }
        });
        
        if (ancestorNode) {
          if (L >= 1 && L <= 3) {
            await calculateAndCreateCommissions(db, ancestorNode.idCardId, L, "AUTOPOOL", L_AMOUNTS[L]);
          } else {
            // Level 4-7 rebirth logic
          }
        }
      }
    }
  }
}

// Helper for MY SYSTEM
async function countMySystemNodesAtDepth(tx, rootId, targetDepth) {
  const db = tx || prisma;
  let currentLevelIds = [rootId];
  for (let d = 1; d <= targetDepth; d++) {
    const children = await db.mySystemNode.findMany({
      where: { parentNodeId: { in: currentLevelIds } }
    });
    if (children.length === 0) return 0;
    currentLevelIds = children.map(c => c.id);
  }
  return currentLevelIds.length;
}

// MY SYSTEM logic
async function checkMySystemLevelCompletion(tx, newNodeId) {
  const db = tx || prisma;
  const requirements = { 1: 2, 2: 4, 3: 8 };
  let currentNode = await db.mySystemNode.findUnique({ where: { id: newNodeId } });

  for (let L = 1; L <= 3; L++) {
    if (!currentNode || !currentNode.parentNodeId) break;
    
    const ancestorNode = await db.mySystemNode.findUnique({ 
      where: { id: currentNode.parentNodeId } 
    });
    
    if (ancestorNode) {
      const count = await countMySystemNodesAtDepth(db, ancestorNode.id, L);
      
      if (count === requirements[L]) {
        const existingCommission = await db.commissionEntry.findFirst({
          where: { 
            idCardId: ancestorNode.idCardId, 
            stream: "MY_SYSTEM", 
            level: L 
          }
        });
        
        if (!existingCommission) {
          await calculateAndCreateCommissions(db, ancestorNode.idCardId, L, "MY_SYSTEM", L_AMOUNTS[L]);
        }
      }
    }
    
    currentNode = ancestorNode;
  }
}

// Main orchestrator for creating commissions with Pay-Once rule
async function calculateAndCreateCommissions(tx, idCardId, level, stream, amountPaise) {
  const db = tx || prisma;
  // 1. Check Pay-Once Ledger
  const alreadyPaid = await payOnceService.hasAlreadyPaid(db, idCardId, level);
  
  const idCard = await db.memberIdCard.findUnique({ where: { id: idCardId } });
  
  if (alreadyPaid) {
    // Prevent duplicate blocked rows when checks run more than once
    const existingBlocked = await db.commissionEntry.findFirst({
      where: { idCardId, stream, level, status: "PAY_ONCE_BLOCKED" }
    });
    if (existingBlocked) return;

    await db.commissionEntry.create({
      data: {
        idCardId,
        stream,
        level,
        amountPaise: 0,
        status: "PAY_ONCE_BLOCKED"
      }
    });
  } else {
    // Record payment in PayOnceLedger
    await payOnceService.recordPayment(db, idCardId, level, stream);
    
    // Read live system toggles
    const mySystem7DayHold = await systemSettingsService.getSettingBoolean("MY_SYSTEM_7DAY_HOLD", true);
    const autoPoolLockedBeforeAcb = await systemSettingsService.getSettingBoolean("AUTOPOOL_LOCKED_BEFORE_ACB", true);
    const rebirthRequiresMainAcb = await systemSettingsService.getSettingBoolean("REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB", true);

    const isRebirth = idCard.type === "REBIRTH";
    let hasAcb = true;
    if (isRebirth) {
      hasAcb = true; // REBIRTH cards are ACB-exempt (ACB v3)
    } else {
      hasAcb = Boolean(idCard.acbStatus); // MAIN and SUB require their OWN acbStatus (no inheritance)
    }

    let initialStatus = "CONFIRMED";

    if (stream === "MY_SYSTEM") {
      if (mySystem7DayHold) {
        initialStatus = "PENDING_7_DAY";
      } else {
        initialStatus = hasAcb ? "WITHDRAWABLE" : "LOCKED_ACB";
      }
    } else if (stream === "AUTOPOOL") {
      if (!autoPoolLockedBeforeAcb) {
        initialStatus = "WITHDRAWABLE";
      } else if (!hasAcb) {
        initialStatus = "LOCKED_ACB";
      } else {
        initialStatus = "WITHDRAWABLE";
      }
    }
    
    // Create commission entry
    const commission = await db.commissionEntry.create({
      data: {
        idCardId,
        stream,
        level,
        amountPaise,
        status: initialStatus
      }
    });

    // If immediately withdrawable, credit the wallet
    if (initialStatus === "WITHDRAWABLE") {
      await walletService.credit(db, idCard.memberId, amountPaise, stream, commission.id, `Commission for ${stream} Level ${level}`);
    }
  }
}

module.exports = {
  checkAutoPoolLevelCompletion,
  checkMySystemLevelCompletion,
  calculateAndCreateCommissions
};
