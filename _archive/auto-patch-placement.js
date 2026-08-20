const fs = require("fs");

const CTRL = "src/controllers/memberController.js";
const ROUTES = "src/routes/memberRoutes.js";

// ---------- 1. Patch memberController.js ----------
let ctrl = fs.readFileSync(CTRL, "utf8");

if (ctrl.includes("getMyPlacement")) {
  console.log("⏭️  memberController.js already patched — skipping.");
} else {
  fs.writeFileSync(CTRL + ".bak", ctrl); // safety backup
  const addition = `

// 🆕 "Who sponsored me & where am I placed?"
async function getMyPlacement(req, res, next) {
  try {
    const node = await prisma.mySystemNode.findFirst({
      where: { idCard: { memberId: req.member.id, type: "MAIN" } },
      include: {
        idCard: { include: { member: { select: { memberCode: true, name: true } } } },
        sponsorCard: { include: { member: { select: { memberCode: true, name: true } } } },
        parent: { include: { idCard: { include: { member: { select: { memberCode: true, name: true } } } } } }
      }
    });

    if (!node) return res.json({ success: true, data: null });

    res.json({
      success: true,
      data: {
        memberCode: node.idCard.member.memberCode,
        side: node.side,
        placementType: node.placementType,
        sponsoredBy: node.sponsorCard ? node.sponsorCard.member.memberCode : null,
        sponsorName: node.sponsorCard ? node.sponsorCard.member.name : null,
        placedUnder: node.parent ? node.parent.idCard.member.memberCode : null,
        placedUnderName: node.parent ? node.parent.idCard.member.name : null
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports.getMyPlacement = getMyPlacement;
`;
  fs.writeFileSync(CTRL, ctrl + addition);
  console.log("✅ memberController.js patched (appended safely at bottom).");
}

// ---------- 2. Patch memberRoutes.js ----------
let routes = fs.readFileSync(ROUTES, "utf8");

if (routes.includes("my-placement")) {
  console.log("⏭️  memberRoutes.js already patched — skipping.");
} else {
  const routerMatch = routes.match(/module\.exports\s*=\s*([A-Za-z0-9_]+)\s*;/);
  const ctrlMatch  = routes.match(/const\s+([A-Za-z0-9_]+)\s*=\s*require\([^)]*memberController[^)]*\)/);
  const authMatch  = routes.match(/const\s+([A-Za-z0-9_]+)\s*=\s*require\([^)]*(auth|Auth)[^)]*\)/);

  if (!routerMatch || !ctrlMatch || !authMatch) {
    console.log("❌ Safety stop: could not detect variable names in memberRoutes.js.");
    console.log("   router:", !!routerMatch, "| controller:", !!ctrlMatch, "| auth:", !!authMatch);
    console.log("   Nothing was changed in the routes file. Paste its first 10 lines to me.");
    process.exit(1);
  }

  fs.writeFileSync(ROUTES + ".bak", routes); // safety backup
  const line = "\n" + routerMatch[1] + ".get(\"/my-placement\", " + authMatch[1] + ", " + ctrlMatch[1] + ".getMyPlacement);\n";
  fs.writeFileSync(ROUTES, routes + line);
  console.log("✅ memberRoutes.js patched (route appended safely at bottom).");
}

console.log("\n🎉 Patch complete! Nodemon restarts automatically.");
