const prisma = require("../lib/prisma");
const adminService = require("./adminService");

// Section 194H rules
const THRESHOLD_PAISE = 2000000; // Rs. 20,000

function getCurrentFinancialYearRange(date = new Date()) {
  let year = date.getFullYear();
  let month = date.getMonth(); // 0 = Jan, 3 = Apr
  
  if (month < 3) {
    // If before April, we are in the previous calendar year's FY
    year = year - 1;
  }
  
  const startDate = new Date(year, 3, 1); // April 1
  const endDate = new Date(year + 1, 2, 31, 23, 59, 59, 999); // March 31 of next year
  
  return { startDate, endDate };
}

async function calculate194HTds(tx, memberId, requestGrossPaise) {
  const member = await tx.member.findUnique({ where: { id: memberId }});
  
  let rate = 0.03;
  if (member.kycStatus === "VERIFIED") {
    const dynamicRate = await adminService.getSetting("TDS_194H_RATE");
    rate = dynamicRate ? parseFloat(dynamicRate) / 100 : 0.03;
  } else {
    const unverifiedRate = await adminService.getSetting("TDS_UNVERIFIED_RATE");
    rate = unverifiedRate ? parseFloat(unverifiedRate) / 100 : 0.20;
  }
  
  const { startDate, endDate } = getCurrentFinancialYearRange();
  
  // Find all COMPLETED withdrawals in the current FY
  const pastWithdrawals = await tx.withdrawal.findMany({
    where: {
      memberId,
      status: "COMPLETED",
      completedAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });
  
  const priorGrossPaise = pastWithdrawals.reduce((sum, w) => sum + w.grossPaise, 0);
  const totalGrossPaise = priorGrossPaise + requestGrossPaise;
  
  let taxablePaise = 0;
  
  if (totalGrossPaise > THRESHOLD_PAISE) {
    if (priorGrossPaise >= THRESHOLD_PAISE) {
      // Already fully above threshold, entire amount is taxable
      taxablePaise = requestGrossPaise;
    } else {
      // Just crossed the threshold, only the excess is taxable
      taxablePaise = totalGrossPaise - THRESHOLD_PAISE;
    }
  }
  
  const tdsPaise = Math.floor(taxablePaise * rate);
  
  return {
    tdsPaise,
    taxablePaise
  };
}

module.exports = {
  calculate194HTds,
  getCurrentFinancialYearRange
};
