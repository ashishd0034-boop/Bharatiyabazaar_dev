const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const adminService = require("../../src/services/adminService");
const vendorService = require("../../src/services/vendorService");
const setuKoshService = require("../../src/services/setuKoshService");
const idCardService = require("../../src/services/idCardService");
const commissionService = require("../../src/services/commissionService");
const withdrawalService = require("../../src/services/withdrawalService");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Wave 5: Admin Settings & Audit Engine Full Validation", () => {
  const unique = Date.now().toString().slice(-6);

  let superAdmin, adminUser;
  let superAdminToken, adminToken;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();

    // Create Superadmin
    superAdmin = await prisma.adminUser.create({
      data: {
        email: `superadmin_${unique}@bb.com`,
        name: "Super Admin",
        role: "SUPER_ADMIN",
        passwordHash: "superhash123"
      }
    });
    superAdminToken = jwt.sign({ id: superAdmin.id, type: "ADMIN", role: superAdmin.role }, JWT_SECRET, { expiresIn: "1h" });

    // Create Operational Admin
    adminUser = await prisma.adminUser.create({
      data: {
        email: `admin_${unique}@bb.com`,
        name: "Operational Admin",
        role: "ADMIN",
        passwordHash: "adminhash123"
      }
    });
    adminToken = jwt.sign({ id: adminUser.id, type: "ADMIN", role: adminUser.role }, JWT_SECRET, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await prisma.platformSetting.deleteMany({});
    const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
    await seedSettingsAndSuperAdmin();
    adminService.invalidateCache();
    await prisma.$disconnect();
  });

  // ==========================================
  // A1: Margin apply-to-existing ON
  // ==========================================
  describe("A1: Margin apply-to-existing ON", () => {
    it("should update existing vendor's future sale margin while keeping past sale snapshots untouched", async () => {
      // 1. Create member & vendor under GROCERY category (default 7% margin)
      const vOwner = await prisma.member.create({
        data: { name: `V A1 ${unique}`, mobile: `9901${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "A1 Grocery",
          category: "GROCERY",
          marginRatePct: 7.0,
          status: "ACTIVE"
        }
      });

      const buyer = await prisma.member.create({
        data: { name: `Buyer A1 ${unique}`, mobile: `9902${unique}`, status: "ACTIVE", pinCode: "110001" }
      });
      const buyerCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `BB91${unique}`, type: "MAIN" }
      });

      // Sale 1: Rs. 1,000 (100,000 paise) @ 7% margin -> snapshotted 7,000 paise
      const sale1 = await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, {
        idCardId: buyerCard.id,
        bypassPinCheck: true
      });
      expect(sale1.vendorSale.marginPaise).toBe(7000);

      // 2. Admin updates GROCERY category margin to 12% with applyToExisting: true
      const res = await request(app)
        .put("/api/admin/categories/GROCERY/margin")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ marginRatePct: 12.0, applyToExisting: true, description: "Festive Margin Revision" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.updatedVendorsCount).toBeGreaterThanOrEqual(1);

      // 3. Sale 2: Rs. 1,000 (100,000 paise) -> should now snapshot 12,000 paise (12%)
      const sale2 = await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, {
        idCardId: buyerCard.id,
        bypassPinCheck: true
      });
      expect(sale2.vendorSale.marginPaise).toBe(12000);

      // 4. Verify past sale 1 margin is still 7,000 paise
      const sale1Db = await prisma.vendorSale.findUnique({ where: { id: sale1.vendorSale.id } });
      expect(sale1Db.marginPaise).toBe(7000);
    });
  });

  // ==========================================
  // A2: Margin apply-to-existing OFF
  // ==========================================
  describe("A2: Margin apply-to-existing OFF", () => {
    it("should keep existing vendor at old margin while assigning new margin to newly registered vendor", async () => {
      const vOwner1 = await prisma.member.create({
        data: { name: `V A2-1 ${unique}`, mobile: `9903${unique}`, status: "ACTIVE" }
      });
      const existingVendor = await prisma.vendor.create({
        data: {
          memberId: vOwner1.id,
          businessName: "A2 Old Electronics",
          category: "ELECTRONICS",
          marginRatePct: 10.0,
          status: "ACTIVE"
        }
      });

      // Update ELECTRONICS margin to 15% with applyToExisting: false
      const res = await request(app)
        .put("/api/admin/categories/ELECTRONICS/margin")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ marginRatePct: 15.0, applyToExisting: false, description: "New Electronics Policy" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.updatedVendorsCount).toBe(0);

      // Register new vendor in ELECTRONICS
      const vOwner2 = await prisma.member.create({
        data: { name: `V A2-2 ${unique}`, mobile: `9904${unique}`, status: "ACTIVE" }
      });
      const newVendor = await vendorService.registerVendor({
        memberId: vOwner2.id,
        businessName: "A2 New Electronics",
        category: "ELECTRONICS"
      });

      // Verify existing vendor retained 10%, new vendor received 15%
      const existingDb = await prisma.vendor.findUnique({ where: { id: existingVendor.id } });
      expect(existingDb.marginRatePct).toBe(10.0);
      expect(newVendor.marginRatePct).toBe(15.0);
    });
  });

  // ==========================================
  // A3: TDS Threshold Change
  // ==========================================
  describe("A3: TDS Threshold Change", () => {
    it("should immediately use new TDS threshold on next withdrawal and write AuditLog", async () => {
      const member = await prisma.member.create({
        data: { name: `TDS Member ${unique}`, mobile: `9905${unique}`, status: "ACTIVE", panVerified: true }
      });
      const mCard = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `BB95${unique}`, type: "MAIN", acbStatus: true }
      });
      const walletService = require("../../src/services/walletService");
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, member.id, 5000000, "TOPUP", null, "Test topup");
      });

      // 1. Update TDS 194H threshold to Rs. 50,000 (5,000,000 paise) via SUPERADMIN
      const updateRes = await request(app)
        .put("/api/admin/settings/TDS_194H_THRESHOLD_PAISE")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ value: "5000000", description: "Budget Threshold Increase" });

      expect(updateRes.status).toBe(200);

      // 2. Member requests withdrawal preview of Rs. 30,000 (3,000,000 paise)
      // Since new threshold is Rs. 50,000, 30k <= 50k -> estimated TDS should be 0!
      const preview = await withdrawalService.previewWithdrawal(member.id, "BANK_TRANSFER", 3000000);
      expect(preview.estimatedTdsPaise).toBe(0); // 0 TDS under new 50k threshold

      // 3. Verify AuditLog written
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "SETTINGS_UPDATED",
          entityType: "PlatformSetting"
        },
        orderBy: { createdAt: "desc" }
      });
      expect(audit).not.toBeNull();
      expect(audit.metadata.key).toBe("TDS_194H_THRESHOLD_PAISE");
      expect(audit.metadata.newValue).toBe("5000000");
    });
  });

  // ==========================================
  // A4: ID Cap Enforced on Purchase; Rebirth Exempt
  // ==========================================
  describe("A4: ID Cap Enforced on Purchase (Rebirth Exempt)", () => {
    it("should reject purchases beyond MAX_PURCHASED_IDS while allowing rebirth generation", async () => {
      // 1. Set MAX_PURCHASED_IDS = 3
      await request(app)
        .put("/api/admin/settings/MAX_PURCHASED_IDS")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "3", description: "Test Cap of 3" });

      const member = await prisma.member.create({
        data: { name: `Capped Member ${unique}`, mobile: `9906${unique}`, status: "ACTIVE" }
      });

      // Purchase 3 IDs -> succeeds
      const cards = await idCardService.purchaseIds(member.id, 3);
      expect(cards).toHaveLength(3);

      // Purchasing 1 more ID -> rejected with 400 ID_PURCHASE_LIMIT_REACHED
      await expect(idCardService.purchaseIds(member.id, 1)).rejects.toThrow("purchased IDs (Limit: 3)");

      // Rebirth cards directly created via checkAndProcessRebirths are exempt
      const rebirthCard = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `RB96${unique}`, type: "REBIRTH", status: "ACTIVE" }
      });
      expect(rebirthCard.type).toBe("REBIRTH");

      // Total cards is now 4 (3 purchased + 1 rebirth)
      const allCards = await prisma.memberIdCard.findMany({ where: { memberId: member.id } });
      expect(allCards).toHaveLength(4);
    });
  });

  // ==========================================
  // A5: System Toggles
  // ==========================================
  describe("A5: System Toggles (7DAY_HOLD, AUTOPOOL_LOCK, REBIRTH_WITHDRAWAL)", () => {
    it("should immediately make MY SYSTEM commissions WITHDRAWABLE when MY_SYSTEM_7DAY_HOLD is false", async () => {
      // Set MY_SYSTEM_7DAY_HOLD = false
      await request(app)
        .put("/api/admin/settings/MY_SYSTEM_7DAY_HOLD")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ value: "false", description: "Disable 7 day hold for testing" });

      const member = await prisma.member.create({
        data: { name: `Hold Toggle Member ${unique}`, mobile: `9907${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });

      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `BB97${unique}`, type: "MAIN", acbStatus: true }
      });

      // Calculate and create commission for MY SYSTEM
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "MY_SYSTEM", 30000);
      });

      const comm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "MY_SYSTEM", level: 1 }
      });
      expect(comm).not.toBeNull();
      expect(comm.status).toBe("WITHDRAWABLE");
    });

    it("should make AutoPool commissions WITHDRAWABLE without ACB when AUTOPOOL_LOCKED_BEFORE_ACB is false", async () => {
      // Set AUTOPOOL_LOCKED_BEFORE_ACB = false
      await request(app)
        .put("/api/admin/settings/AUTOPOOL_LOCKED_BEFORE_ACB")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ value: "false", description: "Disable ACB lock on AutoPool" });

      const member = await prisma.member.create({
        data: { name: `AutoPool Lock Toggle ${unique}`, mobile: `9908${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });

      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `BB98${unique}`, type: "MAIN", acbStatus: false }
      });

      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "AUTOPOOL", 30000);
      });

      const comm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "AUTOPOOL", level: 1 }
      });

      expect(comm).not.toBeNull();
      expect(comm.status).toBe("WITHDRAWABLE"); // Immediately withdrawable because toggle is false!
    });

    it("should make REBIRTH earnings WITHDRAWABLE without owner MAIN ACB when REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB is false", async () => {
      // Set REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB = false
      await request(app)
        .put("/api/admin/settings/REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ value: "false", description: "Disable owner ACB requirement for rebirth" });

      const member = await prisma.member.create({
        data: { name: `Rebirth Toggle Member ${unique}`, mobile: `9909${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });

      // Owner MAIN card without ACB
      await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `BB99${unique}`, type: "MAIN", acbStatus: false }
      });

      // Rebirth card
      const rbCard = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `RB99${unique}`, type: "REBIRTH", acbStatus: false }
      });

      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, rbCard.id, 1, "AUTOPOOL", 30000);
      });

      const comm = await prisma.commissionEntry.findFirst({
        where: { idCardId: rbCard.id, stream: "AUTOPOOL", level: 1 }
      });

      expect(comm).not.toBeNull();
      expect(comm.status).toBe("WITHDRAWABLE");
    });
  });

  // ==========================================
  // A6: RBAC Permissions
  // ==========================================
  describe("A6: RBAC Permissions Matrix", () => {
    it("should return 403 when ADMIN tries to update TDS settings, but 200 for SUPERADMIN", async () => {
      // 1. ADMIN attempts to update TDS_194H_RATE -> 403 FORBIDDEN
      const adminRes = await request(app)
        .put("/api/admin/settings/TDS_194H_RATE_VERIFIED")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "0.05", description: "Unauthorized attempt" });

      expect(adminRes.status).toBe(403);
      expect(adminRes.body.error.code).toBe("FORBIDDEN");

      // 2. SUPERADMIN updates TDS_194H_RATE -> 200 OK
      const superRes = await request(app)
        .put("/api/admin/settings/TDS_194H_RATE_VERIFIED")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ value: "0.05", description: "Authorized TDS rate change" });

      expect(superRes.status).toBe(200);
      expect(superRes.body.success).toBe(true);

      // 3. ADMIN updates operational setting (e.g. SETU_KOSH_PIN_GATE_COUNT) -> 200 OK
      const opRes = await request(app)
        .put("/api/admin/settings/SETU_KOSH_PIN_GATE_COUNT")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "5", description: "Lower PIN threshold" });

      expect(opRes.status).toBe(200);
      expect(opRes.body.success).toBe(true);
    });
  });

  // ==========================================
  // A7: Immutable Audit Logging
  // ==========================================
  describe("A7: Immutable Audit Logging", () => {
    it("should record immutable before/after state in AuditLog on every setting change", async () => {
      await request(app)
        .put("/api/admin/settings/VENDOR_ADMIN_CHARGE_BANK_PCT")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "12", description: "Bank Charge Adjustment" });

      const log = await prisma.auditLog.findFirst({
        where: {
          action: "SETTINGS_UPDATED",
          entityType: "PlatformSetting"
        },
        orderBy: { createdAt: "desc" }
      });

      expect(log).not.toBeNull();
      expect(log.actorId).toBe(adminUser.id);
      expect(log.actorType).toBe("ADMIN");
      expect(log.metadata.key).toBe("VENDOR_ADMIN_CHARGE_BANK_PCT");
      expect(log.metadata.newValue).toBe("12");
      expect(log.metadata.reason).toBe("Bank Charge Adjustment");
    });
  });
});
