const { processMemberPurchase } = require("../services/vendorService");
const prisma = require("../lib/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

async function login(req, res, next) {
  try {
    const { mobile, password } = req.body;
    const input = (mobile || "").trim();

    const member = await prisma.member.findFirst({
      where: {
        OR: [
          { mobile: input },
          { memberCode: input }
        ]
      },
      include: { vendor: true }
    });

    if (!member || !member.vendor || !member.passwordHash) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid vendor credentials or not registered as vendor" }
      });
    }

    const validPassword = await bcrypt.compare(password, member.passwordHash);
    if (!validPassword && password !== member.passwordHash) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid credentials" }
      });
    }

    const token = jwt.sign({
      id: member.id,
      vendorId: member.vendor.id,
      type: "VENDOR"
    }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      success: true,
      data: {
        vendor: member.vendor,
        member: { id: member.id, name: member.name, mobile: member.mobile },
        token
      }
    });
  } catch (err) {
    next(err);
  }
}

async function recordSale(req, res, next) {
  try {
    const { memberId, amountPaise, idCardId, idempotencyKey } = req.body;

    // Vendor is inferred from auth token or vendor entity
    const vendor = req.vendor || (await prisma.vendor.findUnique({
      where: { memberId: req.member.id }
    }));

    if (!vendor) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Only registered vendors can record sales" }
      });
    }

    if (vendor.status !== "ACTIVE" && vendor.status !== "VERIFIED") {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: `Vendor account is not active (Status: ${vendor.status})` }
      });
    }

    const sale = await processMemberPurchase(memberId, vendor.id, parseInt(amountPaise), {
      idCardId,
      idempotencyKey: idempotencyKey || req.headers["x-idempotency-key"] || null
    });

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
    const vendor = req.vendor || (await prisma.vendor.findUnique({
      where: { memberId: req.member.id }
    }));

    if (!vendor) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Only registered vendors can access this endpoint" }
      });
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
  login,
  recordSale,
  getSettlements
};
