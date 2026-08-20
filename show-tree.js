const prisma = require("./src/lib/prisma");

async function main() {
  const allNodes = await prisma.mySystemNode.findMany({
    include: {
      idCard: {
        include: {
          member: { select: { memberCode: true, name: true } }
        }
      },
      sponsorCard: {
        include: {
          member: { select: { memberCode: true, name: true } }
        }
      }
    }
  });

  const byId = {};
  const childrenMap = {};
  const roots = [];

  for (const n of allNodes) {
    byId[n.id] = n;
    if (n.parentNodeId) {
      if (!childrenMap[n.parentNodeId]) childrenMap[n.parentNodeId] = [];
      childrenMap[n.parentNodeId].push(n);
    } else {
      roots.push(n);
    }
  }

  for (const key in childrenMap) {
    childrenMap[key].sort((a, b) => (a.side === "LEFT" ? -1 : 1));
  }

  function print(node, depth) {
    const indent = "    ".repeat(depth);
    const m = node.idCard.member;
    const code = m.memberCode || m.mobile;
    const sideTag = node.side ? `  [${node.side} leg]` : "  [ROOT]";
    const sponsorTag = node.sponsorCard
      ? ` | Sponsored by: ${node.sponsorCard.member.memberCode}`
      : "";
    console.log(`${indent}👤 ${code} (${m.name})${sideTag}${sponsorTag}`);
    const kids = childrenMap[node.id] || [];
    kids.forEach(k => print(k, depth + 1));
  }

  const start = allNodes.find(n => n.idCard.member.memberCode === "BB10001");

  console.log("\n🌳 MY SYSTEM TREE — with Sponsor Tracking\n");
  if (start) print(start, 0);
  else { console.log("⚠️ BB10001 not found as a root. Printing all roots:\n"); roots.forEach(r => print(r, 0)); }

  console.log("\n📋 SPONSOR vs PLACEMENT (Key Distinction):\n");
  for (const n of allNodes) {
    if (n.parentNodeId && byId[n.parentNodeId]) {
      const placedUnder = byId[n.parentNodeId].idCard.member;
      const sponsoredBy = n.sponsorCard?.member;
      const c = n.idCard.member;

      if (sponsoredBy) {
        console.log(`${c.memberCode}: Sponsored by ${sponsoredBy.memberCode} | Placed under ${placedUnder.memberCode} (${n.side})`);
      }
    }
  }

  console.log("");
  await prisma.$disconnect();
}

main();
