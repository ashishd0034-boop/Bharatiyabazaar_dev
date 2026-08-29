const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { getSetting, updateSetting } = require("../../src/services/adminService");
const { logAction } = require("../../src/services/auditService");

describe("Scenario G: Admin Settings & Audit", () => {
  let superAdmin, supportAdmin;

  beforeAll(async () => {
    await cleanDb();

    superAdmin = await prisma.adminUser.create({
      data: {
        email: "super@bb.test",
        name: "Super Admin",
        passwordHash: "hashed_password",
        role: "SUPER_ADMIN"
      }
    });

    supportAdmin = await prisma.adminUser.create({
      data: {
        email: "support@bb.test",
        name: "Support Staff",
        passwordHash: "hashed_password",
        role: "SUPPORT"
      }
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await truncateDb(prisma);
  }

  it("should allow SUPER_ADMIN to update financial settings and create an audit log", async () => {
    const setting = await updateSetting(
      "TDS_194C_RATE",
      "2", // Change from 1% to 2%
      superAdmin.id,
      "Increased TDS rate for new financial year"
    );

    expect(setting).toBeDefined();
    expect(setting.key).toBe("TDS_194C_RATE");
    expect(setting.value).toBe("2");
    expect(setting.updatedBy).toBe(superAdmin.id);

    // Verify Audit Log
    const log = await prisma.auditLog.findFirst({
      where: { action: "SETTINGS_UPDATED" }
    });

    expect(log).toBeDefined();
    expect(log.actorId).toBe(superAdmin.id);
    expect(log.actorType).toBe("ADMIN");
    expect(log.entityType).toBe("PlatformSetting");
    expect(log.entityId).toBe(setting.id);
    
    // Check metadata
    const metadata = log.metadata;
    expect(metadata.key).toBe("TDS_194C_RATE");
    expect(metadata.newValue).toBe("2");
    expect(metadata.oldValue).toBeNull(); // Was not set previously
    expect(metadata.reason).toBe("Increased TDS rate for new financial year");
  });

  it("should prevent SUPPORT role from updating financial settings", async () => {
    await expect(
      updateSetting("TDS_194H_RATE", "5", supportAdmin.id)
    ).rejects.toThrow("Unauthorized: Only SUPER_ADMIN can update TDS_194H_RATE.");
  });

  it("should allow SUPPORT role to update non-financial settings", async () => {
    const setting = await updateSetting(
      "MAX_PURCHASED_IDS",
      "10",
      supportAdmin.id,
      "Increased max IDs to 10"
    );

    expect(setting.value).toBe("10");
    
    const logs = await prisma.auditLog.findMany({
      where: { actorId: supportAdmin.id }
    });
    
    expect(logs.length).toBe(1);
    expect(logs[0].metadata.key).toBe("MAX_PURCHASED_IDS");
  });

  it("should retrieve a setting with correct type casting", async () => {
    // We set MAX_PURCHASED_IDS to "10" above
    const intValue = await getSetting("MAX_PURCHASED_IDS", 5, "integer");
    expect(intValue).toBe(10);
    expect(typeof intValue).toBe("number");

    // Default fallback
    const fallback = await getSetting("NON_EXISTENT", 99, "integer");
    expect(fallback).toBe(99);
  });

  it("can log a generic system action manually", async () => {
    await logAction({
      action: "NIGHTLY_CRON_RUN",
      actorType: "SYSTEM",
      metadata: { recordsProcessed: 100 }
    });

    const sysLog = await prisma.auditLog.findFirst({
      where: { actorType: "SYSTEM" }
    });
    
    expect(sysLog).toBeDefined();
    expect(sysLog.action).toBe("NIGHTLY_CRON_RUN");
    expect(sysLog.actorId).toBeNull();
    expect(sysLog.metadata.recordsProcessed).toBe(100);
  });
});
