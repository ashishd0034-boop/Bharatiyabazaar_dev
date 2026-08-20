const fs = require("fs");
const path = require("path");
const vm = require("vm");

const publicDir = path.join(__dirname, "../public");
const files = fs.readdirSync(publicDir).filter(f => f.endsWith(".html"));

for (const file of files) {
  const filePath = path.join(publicDir, file);
  const content = fs.readFileSync(filePath, "utf-8");

  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;

  while ((match = scriptRegex.exec(content)) !== null) {
    scriptIndex++;
    const scriptCode = match[1];
    if (!scriptCode.trim()) continue;
    try {
      new vm.Script(scriptCode, { filename: `${file}#script${scriptIndex}` });
    } catch (err) {
      console.error(`❌ SYNTAX ERROR in ${file} (Script ${scriptIndex}):`, err.message);
    }
  }
}
console.log("Finished checking all HTML files in public directory.");
