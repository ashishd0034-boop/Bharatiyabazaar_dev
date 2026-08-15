const { processMemberPurchase } = require("../services/vendorService");
const prisma = require("../lib/prisma");

async function recordSale(req, res, next) {
  try {
    const { memberId, amountPaise, idCardId } = req.body;
    
    // Vendor is inferred from auth token (assuming Vendor accounts use a specific member token or have a Vendor entity)
    const vendor = await prisma.vendor.findUnique({
      where: { memberId: req.member.id }
    });
    
    if (!vendor) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only registered vendors can record sales" } });
    }

    if (vendor.status !== "VERIFIED") {
       return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Vendor account is not verified" } });
    }

    const sale = await processMemberPurchase(vendor.id, memberId, amountPaise, idCardId);

    res.status(201).json({
      success: true,
      data: sale
    });
  } catch (err) {
    next(err);
  }
}

async function getSettlements(req, res, next) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { memberId: req.member.id }
    });

    if (!vendor) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only registered vendors can access this endpoint" } });
    }

    const settlements = await prisma.vendorSettlement.findMany({
      where: { vendorId: vendor.id },
      orderBy: { periodStart: "desc" }
    });

    res.json({
      success: true,
      data: settlements
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  recordSale,
  getSettlements
};
