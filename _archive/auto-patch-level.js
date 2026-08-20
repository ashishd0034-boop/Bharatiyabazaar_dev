const fs = require("fs");
const candidates = ["public/bb-dashboard.html", "bb-dashboard.html", "src/public/bb-dashboard.html", "frontend/bb-dashboard.html"];
const dashPath = candidates.find(p => fs.existsSync(p));
if (!dashPath) { console.log("❌ bb-dashboard.html not found."); process.exit(1); }

let dash = fs.readFileSync(dashPath, "utf8");
const oldLine = "document.getElementById('apLevel').textContent = 'Level ' + ap.myStats.level;";

if (dash.includes("inProgress")) {
  console.log("⏭️  Dashboard already updated — skipping.");
} else if (!dash.includes(oldLine)) {
  console.log("❌ Snippet not matched — file left UNCHANGED. Paste your dashboard file to me.");
  process.exit(1);
} else {
  fs.writeFileSync(dashPath + ".bak3", dash);
  dash = dash.replace(oldLine,
    "const inProgress = (ap.levelStatus || []).find(ls => !ls.complete);\n" +
    "        document.getElementById('apLevel').textContent = inProgress\n" +
    "          ? 'L' + inProgress.level + ' · ' + inProgress.filled + '/' + inProgress.size + ' filled'\n" +
    "          : 'Cycle Complete ✓';"
  );
  fs.writeFileSync(dashPath, dash);
  console.log("✅ Dashboard 'Current Level' now matches 'My Pool Cycle'!");
}
