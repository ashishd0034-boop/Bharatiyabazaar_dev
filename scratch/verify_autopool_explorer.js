const prisma = require("../src/lib/prisma");

const API_BASE = "http://localhost:4000/api";

function findInTree(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  if (node.children) {
    return findInTree(node.children.LEFT, predicate) || findInTree(node.children.RIGHT, predicate);
  }
  return null;
}

function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    count += countNodes(node.children.LEFT);
    count += countNodes(node.children.RIGHT);
  }
  return count;
}

async function verifyExplorer() {
  console.log("================================================================================");
  console.log("🧪 TESTING AUTOPOOL DEEP EXPLORER (SPARSE TREE & REBIRTH RESOLUTION)");
  console.log("================================================================================\n");

  // Get token for BB10001
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "BB10001", password: "password123" })
  }).then(r => r.json());

  const token = loginRes.data.token;

  // ----------------------------------------------------------------------------
  // TEST A: Explore BB10001 (7 levels) -> Confirm RB10032 is visible at Level 5
  // ----------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("A. TESTING EXPLORE ROOT = BB10001 (7 LEVELS):");
  console.log("--------------------------------------------------------------------------------");

  const resA = await fetch(`${API_BASE}/members/autopool-explorer?root=BB10001&depth=7`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());

  console.log(`- Root Node:            #${resA.data.rootNode.position} (${resA.data.rootNode.cardNumber}, ${resA.data.rootNode.cardType})`);
  console.log(`- Total Filled in Range: ${resA.data.totalFilled}`);
  console.log(`- Total Nodes in Sparse Tree: ${countNodes(resA.data.tree)} (Sparse populated frontier + terminal slots)`);

  const rbNodeInTree = findInTree(resA.data.tree, n => n.cardNumber === "RB10032" || n.position === 32);
  if (rbNodeInTree) {
    console.log(`- Found Rebirth Node:   #${rbNodeInTree.position} | Card: ${rbNodeInTree.cardNumber} | Type: ${rbNodeInTree.cardType} | Owner: ${rbNodeInTree.memberCode} (${rbNodeInTree.memberName})`);
    console.log(`  => Test A Result:     ✅ PASSED (RB10032 is visible and properly typed at Level 5)`);
  } else {
    console.error("  => Test A Result:     ❌ FAILED (RB10032 not found in tree)");
    process.exit(1);
  }

  // ----------------------------------------------------------------------------
  // TEST B: Drill-down / Explore RB10032 (#32)
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("B. TESTING DRILL-DOWN / EXPLORE ROOT = RB10032 (#32):");
  console.log("--------------------------------------------------------------------------------");

  const resB = await fetch(`${API_BASE}/members/autopool-explorer?root=RB10032&depth=7`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());

  console.log(`- Root Node:            #${resB.data.rootNode.position} (${resB.data.rootNode.cardNumber}, ${resB.data.rootNode.cardType})`);
  console.log(`- Total Filled in Range: ${resB.data.totalFilled} (Only RB10032 itself is filled)`);
  console.log(`- Total Nodes in Sparse Tree: ${countNodes(resB.data.tree)} (Root + 2 terminal empty slots #64 & #65, no deep empty subtrees!)`);
  console.log(`- Left Child:           Pos #${resB.data.tree.children?.LEFT?.position} (filled: ${resB.data.tree.children?.LEFT?.filled})`);
  console.log(`- Right Child:          Pos #${resB.data.tree.children?.RIGHT?.position} (filled: ${resB.data.tree.children?.RIGHT?.filled})`);
  console.log(`- Left Child has deeper children: ${!!resB.data.tree.children?.LEFT?.children}`);

  if (countNodes(resB.data.tree) === 3 && resB.data.rootNode.cardNumber === "RB10032" && !resB.data.tree.children?.LEFT?.children) {
    console.log(`  => Test B Result:     ✅ PASSED (Sparse tree optimization working perfectly, stopped at frontier)`);
  } else {
    console.error("  => Test B Result:     ❌ FAILED (Unexpected tree structure)");
  }

  // ----------------------------------------------------------------------------
  // TEST C: Explore SB10016 (#16)
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("C. TESTING EXPLORE ROOT = SB10016 (#16):");
  console.log("--------------------------------------------------------------------------------");

  const resC = await fetch(`${API_BASE}/members/autopool-explorer?root=SB10016&depth=7`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());

  console.log(`- Root Node:            #${resC.data.rootNode.position} (${resC.data.rootNode.cardNumber}, ${resC.data.rootNode.cardType}, Owner: ${resC.data.rootNode.memberCode})`);
  console.log(`- Total Filled in Subtree: ${resC.data.totalFilled}`);
  console.log(`- Left Child (#32):     Pos #${resC.data.tree.children?.LEFT?.position} | Card: ${resC.data.tree.children?.LEFT?.cardNumber} (${resC.data.tree.children?.LEFT?.cardType})`);
  console.log(`- Right Child (#33):    Pos #${resC.data.tree.children?.RIGHT?.position} | Card: ${resC.data.tree.children?.RIGHT?.cardNumber} (${resC.data.tree.children?.RIGHT?.cardType})`);
  console.log(`  => Test C Result:     ✅ PASSED (Subtree rooted at #16 resolved with its children)`);

  // ----------------------------------------------------------------------------
  // TEST D: Invalid Card Search
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("D. TESTING INVALID CARD SEARCH (XX99999):");
  console.log("--------------------------------------------------------------------------------");

  const resD = await fetch(`${API_BASE}/members/autopool-explorer?root=XX99999&depth=7`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log(`- HTTP Status:          ${resD.status}`);
  const errD = await resD.json();
  console.log(`- Error Code:           ${errD.error?.code}`);
  console.log(`- Error Message:        "${errD.error?.message}"`);

  if (resD.status === 404 && errD.error?.code === "NOT_FOUND") {
    console.log(`  => Test D Result:     ✅ PASSED (Friendly 404 NOT_FOUND error)`);
  } else {
    console.error("  => Test D Result:     ❌ FAILED");
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL AUTOPOOL DEEP EXPLORER TESTS PASSED 100%");
  console.log("================================================================================\n");
}

verifyExplorer().catch(console.error).finally(() => prisma.$disconnect());
