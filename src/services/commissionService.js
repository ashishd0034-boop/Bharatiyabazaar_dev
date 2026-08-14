const prisma = require("../lib/prisma");
const payOnceService = require("./payOnceService");
const walletService = require("./walletService");

const L_AMOUNTS = {
  1: 30000,
  2: 30000,
  3: 20000
};

// AutoPool logic
async function checkAutoPoolLevelCompletion(tx, newGlobalPosition) {
  for (let L = 1; L <= 7; L++) {
    const numerator = newGlobalPosition + 1 - Math.pow(2, L);
    const denominator = Math.pow(2, L);
    
    if (numerator % denominator === 0) {
      const ancestorPos = numerator / denominator;
      
      if (ancestorPos >= 1) {
        // Ancestor completed Level L
        const ancestorNode = await tx.autoPoolNode.findUnique({
          where: { globalPosition: ancestorPos }
        });
        
        if (ancestorNode) {
          if (L >= 1 && L <= 3) {
            await calculateAndCreateCommissions(tx, ancestorNode.idCardId, L, "AUTOPOOL", L_AMOUNTS[L]);
          } else {
            // Level 4-7 rebirth logic will be implemented here later
          }
        }
      }
    }
  }
}

// Helper for MY SYSTEM
async function countMySystemNodesAtDepth(tx, rootId, targetDepth) {
  let currentLevelIds = [rootId];
  for (let d = 1; d <= targetDepth; d++) {
    const children = await tx.mySystemNode.findMany({
      where: { parentNodeId: { in: currentLevelIds } }
    });
    if (children.length === 0) return 0;
    currentLevelIds = children.map(c => c.id);
  }
  return currentLevelIds.length;
}

// MY SYSTEM logic
async function checkMySystemLevelCompletion(tx, newNodeId) {
  const requirements = { 1: 2, 2: 4, 3: 8 };
  let currentNode = await tx.mySystemNode.findUnique({ where: { id: newNodeId } });

  for (let L = 1; L <= 3; L++) {
    if (!currentNode || !currentNode.parentNodeId) break;
    
    const ancestorNode = await tx.mySystemNode.findUnique({ 
      where: { id: currentNode.parentNodeId } 
    });
    
    if (ancestorNode) {
      const count = await countMySystemNodesAtDepth(tx, ancestorNode.id, L);
      
      if (count === requirements[L]) {
        const existingCommission = await tx.commissionEntry.findFirst({
          where: { 
            idCardId: ancestorNode.idCardId, 
            stream: "MY_SYSTEM", 
            level: L 
          }
        });
        
        if (!existingCommission) {
          await calculateAndCreateCommissions(tx, ancestorNode.idCardId, L, "MY_SYSTEM", L_AMOUNTS[L]);
        }
      }
    }
    
    currentNode = ancestorNode;
  }
}

// Main orchestrator for creating commissions with Pay-Once rule
async function calculateAndCreateCommissions(tx, idCardId, level, stream, amountPaise) {
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
      // To check ACB, we must look up the owner's MAIN ID (Rule 4)
      const ownerMainCard = await tx.memberIdCard.findFirst({
        where: { memberId: idCard.memberId, type: "MAIN" }
      });
      
      if (ownerMainCard && !ownerMainCard.acbStatus) {
        initialStatus = "LOCKED_ACB";
      } else {
        initialStatus = "WITHDRAWABLE";
      }
    }
    
    // Create commission entry
    const commission = await tx.commissionEntry.create({
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
      await walletService.credit(tx, idCard.memberId, amountPaise, stream, commission.id, `Commission for ${stream} Level ${level}`);
    }
  }
}

module.exports = {
  checkAutoPoolLevelCompletion,
  checkMySystemLevelCompletion,
  calculateAndCreateCommissions
};
