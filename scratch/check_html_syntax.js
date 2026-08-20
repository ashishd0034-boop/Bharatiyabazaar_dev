const fs = require("fs");
const path = require("path");
const vm = require("vm");

const publicDir = path.join(__dirname, "../public");
const files = [
  "bb-dashboard.html",
  "bb-tree.html",
  "bb-autopool.html",
  "bb-wallet.html",
  "bb-rebirth.html",
  "bb-commissions.html"
];

for (const file of files) {
  const filePath = path.join(publicDir, file);
  const content = fs.readFileSync(filePath, "utf-8");

  // Extract all script tags
  const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;

  console.log(`\n==================================================`);
  console.log(`Checking ${file}:`);

  while ((match = scriptRegex.exec(content)) !== null) {
    scriptIndex++;
    const scriptCode = match[1];
    try {
      new vm.Script(scriptCode, { filename: `${file}#script${scriptIndex}` });
      console.log(`  ✓ Script ${scriptIndex}: Valid JS syntax`);
    } catch (err) {
      console.error(`  ❌ SYNTAX ERROR in ${file} (Script ${scriptIndex}):`, err.message);
      console.error(`     Stack:`, err.stack);
    }
  }
}
