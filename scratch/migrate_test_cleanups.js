const fs = require("fs");
const path = require("path");

const testDirs = [
  path.resolve(__dirname, "../tests/unit"),
  path.resolve(__dirname, "../tests/scenarios"),
  path.resolve(__dirname, "../tests/integration")
];

function migrateTestFiles() {
  for (const dir of testDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".test.js"));

    for (const file of files) {
      const fullPath = path.join(dir, file);
      let content = fs.readFileSync(fullPath, "utf-8");
      let changed = false;

      // 1. Ensure truncateDb is imported if cleanDb/deleteMany is used
      if (content.includes("ledgerEntry.deleteMany") || content.includes("wallet.deleteMany") || content.includes("cleanDb")) {
        if (!content.includes("truncateDb")) {
          const relPath = path.relative(dir, path.resolve(__dirname, "../tests/helpers/cleanDb"));
          const importStmt = `const { truncateDb } = require("${relPath.startsWith(".") ? relPath : "./" + relPath}");\n`;
          content = importStmt + content;
          changed = true;
        }

        // Replace cleanDb body with truncateDb(prisma)
        const cleanDbRegex = /async function cleanDb\(\) \{[\s\S]*?\n  \}/g;
        if (cleanDbRegex.test(content)) {
          content = content.replace(cleanDbRegex, "async function cleanDb() {\n    await truncateDb(prisma);\n  }");
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(fullPath, content, "utf-8");
        console.log(`✓ Updated ${file}`);
      }
    }
  }
}

migrateTestFiles();
