const prisma = require("../lib/prisma");
const payOnceService = require("./payOnceService");

const L_AMOUNTS = {
  1: 30000,
  2: 30000,
  3: 20000
};

// AutoPool logic
async function checkAutoPoolLevelCompletion(newGlobalPosition) {
  for (let L = 1; L <= 7; L++) {
    const numerator = newGlobalPosition + 1 - Math.pow(2, L);
    const denominator = Math.pow(2, L);
    
    if (numerator % denominator === 0) {
      const ancestorPos = numerator / denominator;
      
      if (ancestorPos >= 1) {
        // Ancestor completed Level L
        const ancestorNode = await prisma.autoPoolNode.findUnique({
          where: { globalPosition: ancestorPos }
        });
        
        if (ancestorNode) {
          if (L >= 1 && L <= 3) {
            await calculateAndCreateCommissions(ancestorNode.idCardId, L, "AUTOPOOL", L_AMOUNTS[L]);
          } else {
            // Level 4-7 rebirth logic will be implemented here later
          }
        }
      }
    }
  }
}

// Helper for MY SYSTEM
async function countMySystemNodesAtDepth(rootId, targetDepth) {
  let currentLevelIds = [rootId];
  for (let d = 1; d <= targetDepth; d++) {
    const children = await prisma.mySystemNode.findMany({
      where: { parentNodeId: { in: currentLevelIds } }
    });
    if (children.length === 0) return 0;
    currentLevelIds = children.map(c => c.id);
  }
  return currentLevelIds.length;
}

// MY SYSTEM logic
async function checkMySystemLevelCompletion(newNodeId) {
  const requirements = { 1: 2, 2: 4, 3: 8 };
  let currentNode = await prisma.mySystemNode.findUnique({ where: { id: newNodeId } });

  for (let L = 1; L <= 3; L++) {
    if (!currentNode || !currentNode.parentNodeId) break;
    
    const ancestorNode = await prisma.mySystemNode.findUnique({ 
      where: { id: currentNode.parentNodeId } 
    });
    
    if (ancestorNode) {
      const count = await countMySystemNodesAtDepth(ancestorNode.id, L);
      
      if (count === requirements[L]) {
        // Double-check if we already recorded a commission entry for this level to avoid duplicate processing
        const existingCommission = await prisma.commissionEntry.findFirst({
          where: { 
            idCardId: ancestorNode.idCardId, 
            stream: "MY_SYSTEM", 
            level: L 
          }
        });
        
        if (!existingCommission) {
          await calculateAndCreateCommissions(ancestorNode.idCardId, L, "MY_SYSTEM", L_AMOUNTS[L]);
        }
      }
    }
    
    currentNode = ancestorNode;
  }
}

// Main orchestrator for creating commissions with Pay-Once rule
async function calculateAndCreateCommissions(idCardId, level, stream, amountPaise) {
  await prisma.$transaction(async (tx) => {
    // 1. Check Pay-Once Ledger
    const alreadyPaid = await payOnceService.hasAlreadyPaid(tx, idCardId, level);
    
    // Check if the idCard belongs to a MAIN ID or SUB ID for ACB locking
    const idCard = await tx.memberIdCard.findUnique({ where: { id: idCardId } });
    
    if (alreadyPaid) {
      // Create a PAY_ONCE_BLOCKED commission
      await tx.commissionEntry.create({
        data: {
          idCardId,
          stream,
          level,
          amountPaise: 0, // Blocked, so 0 earned
          status: "PAY_ONCE_BLOCKED"
        }
      });
    } else {
      // Record payment in PayOnceLedger
      await payOnceService.recordPayment(tx, idCardId, level, stream);
      
      // Determine initial status based on ACB and Stream
      let initialStatus = "CONFIRMED";
      
      if (stream === "MY_SYSTEM") {
        // MY SYSTEM commissions are pending for 7 days
        initialStatus = "PENDING_7_DAY";
      } else if (stream === "AUTOPOOL") {
        // AutoPool commissions require ACB to be unlocked
        // If not ACB, lock it.
        if (!idCard.acbStatus) {
          initialStatus = "LOCKED_ACB";
        }
      }
      
      // Create commission entry
      await tx.commissionEntry.create({
        data: {
          idCardId,
          stream,
          level,
          amountPaise,
          status: initialStatus
        }
      });
    }
  });
}

module.exports = {
  checkAutoPoolLevelCompletion,
  checkMySystemLevelCompletion,
  calculateAndCreateCommissions
};
