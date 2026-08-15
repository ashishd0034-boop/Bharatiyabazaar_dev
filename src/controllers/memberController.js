const prisma = require("../lib/prisma");

async function getProfile(req, res, next) {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      include: {
        mainWallet: true,
        idCards: true
      }
    });

    res.json({
      success: true,
      data: member
    });
  } catch (err) {
    next(err);
  }
}

async function updateKyc(req, res, next) {
  try {
    const { panNumber, panCardUrl, aadhaarFrontUrl, aadhaarBackUrl } = req.body;

    const updated = await prisma.member.update({
      where: { id: req.member.id },
      data: {
        panNumber,
        kycStatus: "PENDING" // Need admin approval
      }
    });
    
    // We can also store the URLs in a separate KYC document table or just rely on metadata
    // if a metadata column existed. Since we don't have a document table right now,
    // updating panNumber and changing status to PENDING is sufficient for the simulation.

    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateKyc
};
