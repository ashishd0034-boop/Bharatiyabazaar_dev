const prisma = require("./src/lib/prisma");

// Patch purchaseIds with logging
const originalCode = require('fs').readFileSync('src/services/idCardService.js', 'utf8');

// Add logging after bulkMode is set
const debugCode = originalCode.replace(
  'const bulkMode = count > 1;',
  'const bulkMode = count > 1;\n  console.log(`[DEBUG] purchaseIds called: count=${count}, bulkMode=${bulkMode}`);'
);

// Add logging when firstMySystemNode is set
const debugCode2 = debugCode.replace(
  'if (!firstMySystemNode && mySystemNode) {',
  'if (!firstMySystemNode && mySystemNode) {\n          console.log(`[DEBUG] Setting firstMySystemNode:`, mySystemNode.id);'
);

// Add logging in placeInMySystem
const debugCode3 = debugCode2.replace(
  'async function placeInMySystem(tx, idCard, memberId, type, sponsorIdCardId, sponsorSide, bulkMode = false, bulkRootNodeId = null, createdNodes = []) {',
  'async function placeInMySystem(tx, idCard, memberId, type, sponsorIdCardId, sponsorSide, bulkMode = false, bulkRootNodeId = null, createdNodes = []) {\n  console.log(`[DEBUG] placeInMySystem: type=${type}, bulkMode=${bulkMode}, bulkRootNodeId=${bulkRootNodeId}, createdNodes.length=${createdNodes.length}`);'
);

require('fs').writeFileSync('src/services/idCardService.js', debugCode3);
console.log('✅ Debug logging added to idCardService.js');
