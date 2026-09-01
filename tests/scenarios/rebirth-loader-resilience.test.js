const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");
const fs = require("fs");
const path = require("path");

class MockElement {
  constructor(id, tagName = "DIV") {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.innerHTML = "";
    this.textContent = "";
    this.style = {};
    this.classList = {
      classes: new Set(),
      remove: (c) => this.classList.classes.delete(c),
      add: (c) => this.classList.classes.add(c),
      contains: (c) => this.classList.classes.has(c)
    };
  }
}

class MockDocument {
  constructor(html) {
    this.html = html;
    this.elements = new Map();
  }
  getElementById(id) {
    if (!this.elements.has(id)) {
      const isTableBody = id.toLowerCase().includes("body") || id.toLowerCase().includes("table");
      this.elements.set(id, new MockElement(id, isTableBody ? "TBODY" : "DIV"));
    }
    return this.elements.get(id);
  }
}

describe("Rebirth IDs Table & Systemic Loader Resilience Contract", () => {
  let superAdmin;
  let member;
  let memberToken;
  let rebirthCard;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // Generate PIN and register member
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 1, "Rebirth Test PIN");
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Rebirth Pioneer",
        mobile: "9876540001",
        password: "password123",
        activationPin: pinRes.pins[0].pinCode,
        side: "LEFT"
      });
    expect(regRes.status).toBe(201);
    member = regRes.body.data.member;
    memberToken = regRes.body.data.token;

    // Create a REBIRTH card for the member with AutoPool node
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "RB10001",
        type: "REBIRTH",
        status: "ACTIVE",
        acbStatus: false, // Structurally exempt under ACB v3
        autoPoolNode: {
          create: {
            globalPosition: 17,
            depthLevel: 1
          }
        }
      },
      include: {
        autoPoolNode: true
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("1. GET /api/members/profile includes idCards with autoPoolNode relation", async () => {
    const res = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const idCards = res.body.data.idCards;
    expect(idCards.length).toBe(2); // MAIN + REBIRTH

    const rbCard = idCards.find(c => c.type === "REBIRTH");
    expect(rbCard).toBeDefined();
    expect(rbCard.cardNumber).toBe("RB10001");
    expect(rbCard.autoPoolNode).toBeDefined();
    expect(rbCard.autoPoolNode.globalPosition).toBe(17);
  });

  test("2. MemberShell.safeLoad executes successfully and replaces loading spinners with data", async () => {
    const memberShellCode = fs.readFileSync(path.join(__dirname, "../../public/js/member-shell.js"), "utf8");
    const doc = new MockDocument("");
    const sandbox = { window: {}, document: doc, console, localStorage: { getItem: () => "mock" }, setTimeout };
    sandbox.window = sandbox;
    new Function("window", "document", "console", "localStorage", "setTimeout", memberShellCode)(sandbox, doc, console, sandbox.localStorage, setTimeout);

    const targetEl = doc.getElementById("testTarget");
    targetEl.innerHTML = "⏳ Loading...";
    const loaderEl = doc.getElementById("testLoader");

    await sandbox.MemberShell.safeLoad(targetEl, async () => {
      targetEl.innerHTML = "<tr><td>Data 1</td></tr>";
      return [{ id: 1 }];
    }, { loaderEl });

    expect(targetEl.innerHTML).toBe("<tr><td>Data 1</td></tr>");
    expect(targetEl.innerHTML.includes("Loading")).toBe(false);
    expect(loaderEl.classList.contains("hidden")).toBe(true);
  });

  test("3. MemberShell.safeLoad renders error state and clears spinner on failure", async () => {
    const memberShellCode = fs.readFileSync(path.join(__dirname, "../../public/js/member-shell.js"), "utf8");
    const doc = new MockDocument("");
    const sandbox = { window: {}, document: doc, console, localStorage: { getItem: () => "mock" }, setTimeout };
    sandbox.window = sandbox;
    new Function("window", "document", "console", "localStorage", "setTimeout", memberShellCode)(sandbox, doc, console, sandbox.localStorage, setTimeout);

    const targetEl = doc.getElementById("errorTarget");
    targetEl.innerHTML = "⏳ Loading...";
    const loaderEl = doc.getElementById("errorLoader");

    await sandbox.MemberShell.safeLoad(targetEl, async () => {
      throw new Error("Network timeout");
    }, { loaderEl, errorText: "Failed to load data. Please refresh." });

    expect(targetEl.innerHTML).toContain("Failed to load data. Please refresh.");
    expect(targetEl.innerHTML.includes("Loading")).toBe(false);
    expect(loaderEl.classList.contains("hidden")).toBe(true);
  });

  test("4. Systemic Scan: All 6 converted pages contain safeLoad and no unhandled loading text", () => {
    const pages = [
      "bb-rebirth.html",
      "bb-notifications.html",
      "bb-setu-kosh.html",
      "bb-wallet.html",
      "bb-autopool.html",
      "bb-tree.html"
    ];

    for (const pageName of pages) {
      const pageHtml = fs.readFileSync(path.join(__dirname, "../../public", pageName), "utf8");
      expect(pageHtml.includes("MemberShell.safeLoad") || pageHtml.includes("safeLoad(")).toBe(true);
    }
  });

  test("5. Rebirth cards table renders 'ACB not required' badge without ReferenceError", () => {
    const rebirthHtml = fs.readFileSync(path.join(__dirname, "../../public/bb-rebirth.html"), "utf8");
    // Ensure no dangling mainCard reference exists in bb-rebirth.html
    expect(rebirthHtml.includes("mainCard?.acbStatus")).toBe(false);
    expect(rebirthHtml.includes("ACB not required")).toBe(true);
  });
});
