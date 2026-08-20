const prisma = require("../lib/prisma");

/**
 * Get volume discount tier based on monthly sales.
 */
async function getVolumeDiscountPct(vendorId, periodEnd) {
  const monthStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  const aggregate = await prisma.vendorSale.aggregate({
    where: {
      vendorId,
      status: { notIn: ["REFUNDED", "CANCELLED"] },
      createdAt: {
        gte: monthStart,
        lte: periodEnd
      }
    },
    _sum: { amountPaise: true }
  });

  const monthlySales = aggregate._sum.amountPaise || 0;

  if (monthlySales >= 50000000) return 50;
  if (monthlySales >= 20000000) return 30;
  if (monthlySales >= 10000000) return 20;
  if (monthlySales >= 5000000) return 10;
  return 0;
}

/**
 * Process the weekly settlement.
 * runDate should be the Monday 00:00:00 IST of the settlement run.
 */
async function processWeeklySettlement(runDate) {
  // Idempotency lock
  const runDateStr = runDate.toISOString();
  let settlementRun;

  // OUTER TRY: create the settlement run (P2002 throws here on duplicate runDate)
  try {
    settlementRun = await prisma.settlementRun.create({
      data: {
        runDate,
        status: "RUNNING"
      }
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      let field = "a unique field";
      if (Array.isArray(target)) field = target.join(", ");
      else if (typeof target === "string") field = target;

      console.warn(`Settlement run duplicate detected on ${field} — skipping`);
      return; // Settlement already ran for this date, safe to skip
    }
    throw error;
  }

  // INNER TRY: main settlement processing logic
  try {
    const periodStart = new Date(runDate);
    periodStart.setDate(periodStart.getDate() - 7);
    const periodEnd = new Date(runDate);
    periodEnd.setMilliseconds(-1);

    let totalEntries = 0;
    let totalPaise = 0;

    // Process vendors sequentially
    const vendors = await prisma.vendor.findMany({
      where: { status: "VERIFIED" }
    });

    for (const vendor of vendors) {
      await prisma.$transaction(async (tx) => {
        // Find all unrefunded sales for this vendor in the period
        const sales = await tx.vendorSale.findMany({
          where: {
            vendorId: vendor.id,
            status: { notIn: ["REFUNDED", "CANCELLED"] },
            createdAt: {
              gte: periodStart,
              lte: periodEnd
            }
          }
        });

        if (sales.length === 0) return;

        const grossSalesPaise = sales.reduce((sum, sale) => sum + sale.amountPaise, 0);

        // Strict integer math
        const marginPaise = Math.floor((grossSalesPaise * vendor.marginRatePct) / 100);
        const postMarginPaise = grossSalesPaise - marginPaise;

        const adminChargeRatePct = 10; // Defaulting to 10% bank withdrawal
        const baseAdminChargePaise = Math.floor((postMarginPaise * adminChargeRatePct) / 100);

        const discountPct = await getVolumeDiscountPct(vendor.id, periodEnd);
        const volumeDiscountPaise = Math.floor((baseAdminChargePaise * discountPct) / 100);

        const finalAdminChargePaise = baseAdminChargePaise - volumeDiscountPaise;
        const payoutBeforeTdsPaise = postMarginPaise - finalAdminChargePaise;

        // TDS calculation - spec says 194C is 1% (assuming individual with PAN for simplicity in Phase 7)
        const tdsPaise = Math.floor((grossSalesPaise * 1) / 100);

        const netPayablePaise = payoutBeforeTdsPaise - tdsPaise;

        await tx.vendorSettlement.create({
          data: {
            vendorId: vendor.id,
            grossSalesPaise,
            marginPaise,
            postMarginPaise,
            adminChargePaise: finalAdminChargePaise,
            tdsPaise,
            netPayablePaise,
            status: "COMPLETED",
            periodStart,
            periodEnd,
            settledAt: new Date()
          }
        });

        // Add to wallet directly as confirmed payout
        let wallet = await tx.wallet.findUnique({ where: { memberId: vendor.memberId }});
        if (!wallet) {
          wallet = await tx.wallet.create({ data: { memberId: vendor.memberId }});
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balancePaise: { increment: netPayablePaise } }
        });

        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            type: "CREDIT",
            amountPaise: netPayablePaise,
            source: "VENDOR_SETTLEMENT",
            referenceId: settlementRun.id,
            description: `Weekly Settlement for ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`,
            balanceBeforePaise: wallet.balancePaise,
            balanceAfterPaise: wallet.balancePaise + netPayablePaise
          }
        });

        totalEntries++;
        totalPaise += netPayablePaise;
      });
    }

    // Process PENDING_SETTLEMENT commissions in batches
    const BATCH_SIZE = 500;

    // 1. CommissionEntries (Setu Kosh)
    let hasMoreCommissions = true;
    while (hasMoreCommissions) {
      await prisma.$transaction(async (tx) => {
        const commissions = await tx.commissionEntry.findMany({
          where: {
            status: "PENDING_SETTLEMENT",
            createdAt: { lte: periodEnd }
          },
          take: BATCH_SIZE
        });

        if (commissions.length === 0) {
          hasMoreCommissions = false;
          return;
        }

        for (const commission of commissions) {
          await tx.commissionEntry.update({
            where: { id: commission.id },
            data: {
              status: "CONFIRMED",
              confirmedAt: new Date()
            }
          });

          const idCard = await tx.memberIdCard.findUnique({ where: { id: commission.idCardId }});

          let wallet = await tx.wallet.findUnique({ where: { memberId: idCard.memberId }});
          if (!wallet) {
            wallet = await tx.wallet.create({ data: { memberId: idCard.memberId }});
          }

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balancePaise: { increment: commission.amountPaise } }
          });

          await tx.ledgerEntry.create({
            data: {
              walletId: wallet.id,
              type: "CREDIT",
              amountPaise: commission.amountPaise,
              source: commission.stream,
              referenceId: commission.id,
              description: `Setu Kosh Commission Confirmed`,
              balanceBeforePaise: wallet.balancePaise,
              balanceAfterPaise: wallet.balancePaise + commission.amountPaise
            }
          });

          totalEntries++;
          totalPaise += commission.amountPaise;
        }
      });
    }

    // 2. VendorReferralBonus
    let hasMoreBonuses = true;
    while (hasMoreBonuses) {
      await prisma.$transaction(async (tx) => {
        const bonuses = await tx.vendorReferralBonus.findMany({
          where: {
            status: "PENDING_SETTLEMENT",
            createdAt: { lte: periodEnd }
          },
          take: BATCH_SIZE
        });

        if (bonuses.length === 0) {
          hasMoreBonuses = false;
          return;
        }

        for (const bonus of bonuses) {
          await tx.vendorReferralBonus.update({
            where: { id: bonus.id },
            data: { status: "CONFIRMED" }
          });

          let wallet = await tx.wallet.findUnique({ where: { memberId: bonus.memberId }});
          if (!wallet) {
            wallet = await tx.wallet.create({ data: { memberId: bonus.memberId }});
          }

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balancePaise: { increment: bonus.bonusPaise } }
          });

          await tx.ledgerEntry.create({
            data: {
              walletId: wallet.id,
              type: "CREDIT",
              amountPaise: bonus.bonusPaise,
              source: "VENDOR_REFERRAL_BONUS",
              referenceId: bonus.id,
              description: `Vendor Referral Bonus Confirmed`,
              balanceBeforePaise: wallet.balancePaise,
              balanceAfterPaise: wallet.balancePaise + bonus.bonusPaise
            }
          });

          totalEntries++;
          totalPaise += bonus.bonusPaise;
        }
      });
    }

    await prisma.settlementRun.update({
      where: { id: settlementRun.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        totalEntries,
        totalPaise
      }
    });

    return { totalEntries, totalPaise };

  } catch (error) {
    // Mark run as failed first
    await prisma.settlementRun.update({
      where: { id: settlementRun.id },
      data: { status: "FAILED" }
    });

    // Re-throw error (P2002 is already handled in the outer try)
    throw error;
  }
}

module.exports = {
  processWeeklySettlement
};