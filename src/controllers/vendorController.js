const { processMemberPurchase, registerVendor } = require("../services/vendorService");
const { processEarlySettlement } = require("../services/settlementService");
const prisma = require("../lib/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Register a new vendor with category margin, referral binding, and security deposit.
 */
async function register(req, res, next) {
  try {
    const {
      name,
      businessName,
      mobile,
      password,
      category = "GENERAL",
      entityType = "INDIVIDUAL",
      panNumber,
      gstin,
      address,
      pinCode,
      payoutMethod = "BANK",
      referrerCode,
      referrerMemberCode
    } = req.body;

    const trimmedMobile = String(mobile || "").trim();

    // 1. Resolve Referrer Member if code provided
    let referredByMemberId = null;
    const refCode = (referrerCode || referrerMemberCode || "").trim();
    if (refCode) {
      const referrer = await prisma.member.findFirst({
        where: {
          OR: [
            { memberCode: refCode },
            { mobile: refCode },
            { id: refCode }
          ]
        }
      });
      if (referrer) {
        referredByMemberId = referrer.id;
      }
    }

    // 2. Find or Create Owner Member
    let member = await prisma.member.findUnique({
      where: { mobile: trimmedMobile },
      include: { vendor: true }
    });

    if (member && member.vendor) {
      return res.status(400).json({
        success: false,
        error: { code: "ALREADY_REGISTERED", message: `Mobile ${trimmedMobile} is already registered as a vendor` }
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    if (!member) {
      const memberCode = `M${trimmedMobile.slice(-6)}${Math.floor(100 + Math.random() * 900)}`;
      member = await prisma.member.create({
        data: {
          name: name.trim(),
          mobile: trimmedMobile,
          memberCode,
          passwordHash,
          panNumber: panNumber ? panNumber.trim().toUpperCase() : null,
          panVerified: !!panNumber,
          kycStatus: "VERIFIED",
          pinCode: pinCode ? String(pinCode).trim() : null,
          address: address ? address.trim() : null,
          mainWallet: {
            create: { balancePaise: 0 }
          }
        }
      });
    } else if (!member.passwordHash) {
      await prisma.member.update({
        where: { id: member.id },
        data: { passwordHash }
      });
    }

    // 3. Register Vendor via Service (derive margin strictly server-side)
    const vendor = await registerVendor({
      memberId: member.id,
      businessName: businessName.trim(),
      category: (category || "GENERAL").toUpperCase(),
      gstin: gstin ? gstin.trim().toUpperCase() : null,
      address: address ? address.trim() : null,
      pinCode: pinCode ? String(pinCode).trim() : null,
      payoutMethod: (payoutMethod || "BANK").toUpperCase(),
      referredByMemberId
    });

    res.status(201).json({
      success: true,
      data: {
        vendor,
        member: {
          id: member.id,
          name: member.name,
          mobile: member.mobile,
          memberCode: member.memberCode
        },
        vendorCode: vendor.id
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Vendor Login
 */
async function login(req, res, next) {
  try {
    const { mobile, password } = req.body;
    const input = (mobile || "").trim();

    const member = await prisma.member.findFirst({
      where: {
        OR: [
          { mobile: input },
          { memberCode: input },
          { id: input }
        ]
      },
      include: {
        vendor: true,
        mainWallet: true
      }
    });

    if (!member || !member.vendor || !member.passwordHash) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid vendor credentials or not registered as vendor" }
      });
    }

    const validPassword = await bcrypt.compare(password, member.passwordHash);
    if (!validPassword) {
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
        member: {
          id: member.id,
          name: member.name,
          mobile: member.mobile,
          memberCode: member.memberCode
        },
        token
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Vendor Profile & Live Metrics
 */
async function getProfile(req, res, next) {
  try {
    const vendor = req.vendor;
    const member = req.member;

    // Fetch aggregate sales summary
    const salesAgg = await prisma.vendorSale.aggregate({
      where: { vendorId: vendor.id },
      _count: { id: true },
      _sum: { amountPaise: true, marginPaise: true }
    });

    res.json({
      success: true,
      data: {
        vendor,
        member: {
          id: member.id,
          name: member.name,
          mobile: member.mobile,
          memberCode: member.memberCode,
          panNumber: member.panNumber
        },
        walletBalancePaise: member.mainWallet?.balancePaise || vendor.walletBalancePaise || 0,
        totalSalesCount: salesAgg._count.id || 0,
        totalSalesPaise: salesAgg._sum.amountPaise || 0,
        totalMarginPaise: salesAgg._sum.marginPaise || 0
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Record Sale / Member Purchase
 */
async function recordSale(req, res, next) {
  try {
    const {
      memberId,
      buyerCode,
      cardNumber,
      memberCode,
      amountPaise,
      idCardId,
      idempotencyKey
    } = req.body;

    const vendor = req.vendor;

    if (vendor.status === "FROZEN" || vendor.status === "CLOSED") {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: `Vendor account is ${vendor.status}. Sales recording disabled.` }
      });
    }

    // Resolve buyer member
    let resolvedMemberId = memberId;
    let resolvedCardId = idCardId;

    const lookupQuery = (buyerCode || cardNumber || memberCode || "").trim();
    if (!resolvedMemberId && lookupQuery) {
      const card = await prisma.memberIdCard.findFirst({
        where: {
          OR: [
            { cardNumber: lookupQuery },
            { id: lookupQuery }
          ]
        },
        include: { member: true }
      });

      if (card) {
        resolvedMemberId = card.memberId;
        resolvedCardId = card.id;
      } else {
        const buyerMember = await prisma.member.findFirst({
          where: {
            OR: [
              { memberCode: lookupQuery },
              { mobile: lookupQuery }
            ]
          }
        });
        if (buyerMember) {
          resolvedMemberId = buyerMember.id;
        }
      }
    }

    if (!resolvedMemberId) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "Valid buyer member ID, member code, or card number is required" }
      });
    }

    const sale = await processMemberPurchase(resolvedMemberId, vendor.id, parseInt(amountPaise, 10), {
      idCardId: resolvedCardId,
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

/**
 * Get Vendor Settlement History
 */
async function getSettlements(req, res, next) {
  try {
    const vendor = req.vendor;

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

/**
 * Request On-Demand Early Settlement
 */
async function requestEarlySettlement(req, res, next) {
  try {
    const vendor = req.vendor;

    if (vendor.status === "FROZEN" || vendor.status === "CLOSED") {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: `Vendor account is ${vendor.status}. Settlements unavailable.` }
      });
    }

    const settlement = await processEarlySettlement(vendor.id, {
      actorId: req.member.id
    });

    res.json({
      success: true,
      data: settlement
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  getProfile,
  recordSale,
  getSettlements,
  requestEarlySettlement
};
