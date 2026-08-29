const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Scenario: Admin Member Password Reset", () => {
  const unique = Date.now().toString().slice(-6);
  let superAdmin, regularAdmin, testMember;
  let superAdminToken, regularAdminToken, memberToken;
  const initialMemberPassword = "InitialMemberPass123!";

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash(initialMemberPassword, 10);
    const adminPassHash = await bcrypt.hash("AdminSecretPass123!", 10);

    // 1. Super Admin
    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
    if (!superAdmin) {
      superAdmin = await prisma.adminUser.create({
        data: {
          email: "super_reset@bb.test",
          name: "Super Reset Tester",
          passwordHash: adminPassHash,
          role: "SUPER_ADMIN"
        }
      });
    }

    superAdminToken = jwt.sign(
      { id: superAdmin.id, email: superAdmin.email, role: "SUPER_ADMIN", type: "ADMIN" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 2. Regular Admin
    regularAdmin = await prisma.adminUser.create({
      data: {
        email: `admin_${unique}@bb.test`,
        name: "Regular Admin Tester",
        passwordHash: adminPassHash,
        role: "ADMIN"
      }
    });

    regularAdminToken = jwt.sign(
      { id: regularAdmin.id, email: regularAdmin.email, role: "ADMIN", type: "ADMIN" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 3. Member
    testMember = await prisma.member.create({
      data: {
        memberCode: `BB${unique}`,
        name: "Test Reset Member",
        mobile: `9666${unique}`,
        passwordHash,
        kycStatus: "VERIFIED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });

    const card = await prisma.memberIdCard.create({
      data: {
        memberId: testMember.id,
        cardNumber: `BB${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    memberToken = jwt.sign(
      { id: testMember.id, loginCardId: card.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. RBAC: Should reject unauthenticated requests and member tokens with 401", async () => {
    const unauthRes = await request(app)
      .post(`/api/admin/members/${testMember.id}/reset-password`);
    expect(unauthRes.status).toBe(401);

    const memberRes = await request(app)
      .post(`/api/admin/members/${testMember.id}/reset-password`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(memberRes.status).toBe(401);
  });

  it("2. Target Validation: Should return 404 if member does not exist", async () => {
    const res = await request(app)
      .post("/api/admin/members/nonexistent_member_id/reset-password")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  let generatedTempPassword;

  it("3. Password Reset: ADMIN / SUPER_ADMIN should generate temporary password and update hash", async () => {
    const res = await request(app)
      .post(`/api/admin/members/${testMember.id}/reset-password`)
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.memberId).toBe(testMember.id);
    expect(res.body.data.memberCode).toBe(testMember.memberCode);
    expect(typeof res.body.data.temporaryPassword).toBe("string");
    expect(res.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    expect(res.body.data.temporaryPassword.startsWith("BB@Temp")).toBe(true);

    generatedTempPassword = res.body.data.temporaryPassword;

    // Verify hash changed in DB
    const updatedMember = await prisma.member.findUnique({
      where: { id: testMember.id }
    });
    const isNewMatch = await bcrypt.compare(generatedTempPassword, updatedMember.passwordHash);
    expect(isNewMatch).toBe(true);
  });

  it("4. AuditLog: Should synchronously log MEMBER_PASSWORD_RESET with admin and member metadata", async () => {
    const log = await prisma.auditLog.findFirst({
      where: {
        action: "MEMBER_PASSWORD_RESET",
        entityId: testMember.id
      },
      orderBy: { createdAt: "desc" }
    });

    expect(log).not.toBeNull();
    expect(log.actorId).toBe(regularAdmin.id);
    expect(log.actorType).toBe("ADMIN");
    expect(log.metadata.memberCode).toBe(testMember.memberCode);
    expect(log.metadata.adminEmail).toBe(regularAdmin.email);
  });

  let newMemberToken;

  it("5. Member Login: Member should log in successfully with temporary password and fail with old password", async () => {
    // 5a. Old password fails
    const oldLoginRes = await request(app)
      .post("/api/auth/login")
      .send({
        mobile: testMember.mobile,
        password: initialMemberPassword
      });
    expect(oldLoginRes.status).toBe(401);

    // 5b. New temporary password succeeds
    const newLoginRes = await request(app)
      .post("/api/auth/login")
      .send({
        mobile: testMember.mobile,
        password: generatedTempPassword
      });

    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.success).toBe(true);
    expect(newLoginRes.body.data.token).toBeDefined();

    newMemberToken = newLoginRes.body.data.token;
  });

  it("6. Defense-in-Depth: Password hash must NOT be returned in member profile or admin members list", async () => {
    // 6a. GET /api/members/profile
    const profileRes = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${newMemberToken}`);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.data.id).toBe(testMember.id);
    expect(profileRes.body.data.passwordHash).toBeUndefined();

    // 6b. GET /api/admin/members
    const adminListRes = await request(app)
      .get("/api/admin/members")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(adminListRes.status).toBe(200);
    const listed = adminListRes.body.data.members.find(m => m.id === testMember.id);
    expect(listed).toBeDefined();
    expect(listed.passwordHash).toBeUndefined();
  });
});
