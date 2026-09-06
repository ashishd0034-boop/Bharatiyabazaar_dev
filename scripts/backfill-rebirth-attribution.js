/**
 * Idempotent backfill script to attribute existing REBIRTH cards to their earning cards.
 *
 * Mappings:
 * - RB10032 (pos 32) -> BB10001 (pos 1, completed AutoPool L4)
 * - RB10048 (pos 48) -> SB10002 (pos 2, completed AutoPool L4)
 * - RB10064 (pos 64) -> BB10001 (pos 1, completed AutoPool L5)
 * - RB10065 (pos 65) -> SB10003 (pos 3, completed AutoPool L4)
 * - RB10080 (pos 80) -> BB10004 (pos 4, completed AutoPool L4)
 */

const prisma = require("../src/core/database/prisma");

const ATTRIBUTION_MAP = [
  { rebirthCardNumber: "RB10032", earningCardNumber: "BB10001", reason: "Position 1 completed AutoPool Level 4" },
  { rebirthCardNumber: "RB10048", earningCardNumber: "SB10002", reason: "Position 2 completed AutoPool Level 4" },
  { rebirthCardNumber: "RB10064", earningCardNumber: "BB10001", reason: "Position 1 completed AutoPool Level 5" },
  { rebirthCardNumber: "RB10065", earningCardNumber: "SB10003", reason: "Position 3 completed AutoPool Level 4" },
  { rebirthCardNumber: "RB10080", earningCardNumber: "BB10004", reason: "Position 4 completed AutoPool Level 4" }
];

async function runBackfill() {
  console.log("Starting idempotent Rebirth Attribution backfill...");
  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of ATTRIBUTION_MAP) {
    const rebirthCard = await prisma.memberIdCard.findUnique({
      where: { cardNumber: item.rebirthCardNumber }
    });

    if (!rebirthCard) {
      console.log(`[SKIP] Rebirth card ${item.rebirthCardNumber} not found in database.`);
      skippedCount++;
      continue;
    }

    const earningCard = await prisma.memberIdCard.findUnique({
      where: { cardNumber: item.earningCardNumber }
    });

    if (!earningCard) {
      console.log(`[WARN] Earning card ${item.earningCardNumber} not found for ${item.rebirthCardNumber}.`);
      skippedCount++;
      continue;
    }

    if (rebirthCard.earnedByIdCardId === earningCard.id) {
      console.log(`[IDEMPOTENT] ${item.rebirthCardNumber} is already attributed to ${item.earningCardNumber} (${item.reason}).`);
      skippedCount++;
      continue;
    }

    await prisma.memberIdCard.update({
      where: { id: rebirthCard.id },
      data: { earnedByIdCardId: earningCard.id }
    });

    console.log(`[UPDATED] ${item.rebirthCardNumber} -> Attributed to ${item.earningCardNumber} (${item.reason}).`);
    updatedCount++;
  }

  console.log(`\nBackfill summary: ${updatedCount} updated, ${skippedCount} skipped/idempotent.`);
}

if (require.main === module) {
  runBackfill()
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { runBackfill };
