const adminService = require("../../core/services/system-settings.service");

/**
 * Evaluates completed AutoPool levels (L4–L7) upon a new position placement,
 * generates vouchers for Levels 5–7, and queues Rebirth cards sorted by
 * nearest/deepest ancestor first.
 */
async function checkAndProcessRebirths(tx, newlyPlacedGlobalPosition) {
  const rebirthsToQueue = [];
  
  // Rebirth triggers at AutoPool Levels 4, 5, 6, 7
  for (let L = 4; L <= 7; L++) {
    const numerator = newlyPlacedGlobalPosition + 1 - Math.pow(2, L);
    const denominator = Math.pow(2, L);
    
    if (numerator % denominator === 0) {
      const ancestorPos = numerator / denominator;
      
      if (ancestorPos >= 1) {
        // Ancestor completed Level L
        const ancestorNode = await tx.autoPoolNode.findUnique({
          where: { globalPosition: ancestorPos },
          include: { idCard: true }
        });
        
        if (ancestorNode) {
          rebirthsToQueue.push({
            memberId: ancestorNode.idCard.memberId,
            ancestorPos: ancestorPos,
            depthLevel: ancestorNode.depthLevel,
            completedLevel: L,
            // Rebirth properties:
            type: "REBIRTH",
            sponsorIdCardId: null,
            sponsorSide: null
          });

          // Generate Voucher for Levels 5, 6, 7
          if (L >= 5 && L <= 7) {
            const faceValuePaise = await adminService.getSetting("VOUCHER_FACE_VALUE_PAISE", 20000, "integer");
            const validityDays = await adminService.getSetting("VOUCHER_VALIDITY_DAYS", 365, "integer");

            await tx.voucher.create({
              data: {
                memberId: ancestorNode.idCard.memberId,
                idCardId: ancestorNode.idCardId,
                sourceType: `AUTOPOOL_LEVEL_${L}`,
                faceValuePaise,
                expiresAt: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
              }
            });
          }
        }
      }
    }
  }

  // Priority Ordering (Nearest/Deepest ancestor first):
  // Primary: Depth (deepest first, i.e., highest depthLevel)
  // Secondary: Global Position (highest/newest first, i.e., highest ancestorPos)
  rebirthsToQueue.sort((a, b) => {
    if (a.depthLevel !== b.depthLevel) {
      return b.depthLevel - a.depthLevel;
    }
    return b.ancestorPos - a.ancestorPos;
  });

  return rebirthsToQueue;
}

module.exports = {
  checkAndProcessRebirths
};
