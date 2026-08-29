const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const walletService = require("../../src/services/walletService");
const pinService = require("../../src/services/pinService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Permanent Ledger Integrity & Immutability Enforcement", () => {
  let member;
  let memberToken;

  beforeAll(async () => {
    // Clean tables using TRUNCATE CASCADE
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "ledger_entries",
        "wallets",
        "commission_entries",
        "payonce_ledger",
        "MySystemNode",
        "autopool_nodes",
        "MemberIdCard",
        "vouchers",
        "withdrawals",
        "setukosh_nodes",
        "setukosh_counters",
        "tds_ledger",
        "vendor_sales",
        "vendor_settlements",
        "vendor_referral_bonus",
        "vendors",
        "activation_pins",
        "audit_logs",
        "members",
        "system_counters",
        "platform_settings",
        "admin_users"
      CASCADE;
    `);

    const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash("TestPass123", 10);

    // Create member with 0 initial balance
    member = await prisma.member.create({
      data: {
        memberCode: "BB90001",
        name: "Ledger Test User",
        mobile: "9876543210",
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: {
          create: {
            balancePaise: 0
          }
        }
      },
      include: { mainWallet: true }
    });

    const card = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "BB90001",
        type: "MAIN",
        acbStatus: true
      }
    });

    memberToken = jwt.sign(
      { id: member.id, loginCardId: card.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. Direct prisma.wallet.update without ledger entry must fail with LEDGER_INTEGRITY_VIOLATION", async () => {
    // Attempting direct wallet mutation (bypassing walletService)
    await expect(
      prisma.wallet.update({
        where: { id: member.mainWallet.id },
        data: { balancePaise: 50000 } // Direct unauthorized balance injection
      })
    ).rejects.toThrow(/LEDGER_INTEGRITY_VIOLATION/i);

    // Verify wallet balance remained 0
    const wallet = await prisma.wallet.findUnique({ where: { id: member.mainWallet.id } });
    expect(wallet.balancePaise).toBe(0);
  });

  it("2. Direct UPDATE or DELETE on any LedgerEntry row must fail with LEDGER_IMMUTABLE", async () => {
    // First, create a valid ledger entry via walletService
    const creditResult = await prisma.$transaction(async (tx) => {
      return await walletService.credit(tx, member.id, 100000, "TOPUP", "TOPUP-01", "Legitimate credit");
    });

    const ledgerEntryId = creditResult.ledger.id;
    expect(ledgerEntryId).toBeDefined();

    // 2a. Attempting UPDATE on ledger_entries
    await expect(
      prisma.ledgerEntry.update({
        where: { id: ledgerEntryId },
        data: { amountPaise: 200000 }
      })
    ).rejects.toThrow(/LEDGER_IMMUTABLE/i);

    // 2b. Attempting DELETE on ledger_entries
    await expect(
      prisma.ledgerEntry.delete({
        where: { id: ledgerEntryId }
      })
    ).rejects.toThrow(/LEDGER_IMMUTABLE/i);
  });

  it("3. Authorized walletService.credit and debit must succeed with zero reconciliation variance", async () => {
    // Perform authorized debit
    await prisma.$transaction(async (tx) => {
      await walletService.debit(tx, member.id, 40000, "WITHDRAWAL", "WD-01", "Legitimate withdrawal");
    });

    const wallet = await prisma.wallet.findUnique({
      where: { id: member.mainWallet.id },
      include: { ledgerEntries: true }
    });

    // 100,000 - 40,000 = 60,000 paise (₹600)
    expect(wallet.balancePaise).toBe(60000);

    const credits = wallet.ledgerEntries.filter(e => e.type === "CREDIT").reduce((s, e) => s + e.amountPaise, 0);
    const debits = wallet.ledgerEntries.filter(e => e.type === "DEBIT").reduce((s, e) => s + e.amountPaise, 0);
    const delta = wallet.balancePaise - (credits - debits);

    expect(delta).toBe(0);
  });

  it("4. End-to-end PIN purchase transaction must execute atomically with triggers live", async () => {
    // Member has 60,000 paise (₹600) -> buys 1 PIN (cost ₹600)
    const pin = await pinService.generatePin(member.id, 1);

    expect(pin).toBeDefined();
    expect(pin.pinCode).toMatch(/^PIN-[A-F0-9]{8}$/);
    expect(pin.status).toBe("AVAILABLE");

    // Verify member wallet balance is now 0
    const wallet = await prisma.wallet.findUnique({
      where: { id: member.mainWallet.id },
      include: { ledgerEntries: true }
    });
    expect(wallet.balancePaise).toBe(0);

    // Verify company reserve wallet received the credit
    const companyWallet = await prisma.wallet.findUnique({
      where: { memberId: "COMPANY_WALLET" },
      include: { ledgerEntries: true }
    });
    expect(companyWallet.balancePaise).toBe(60000);

    // Verify both wallets maintain zero ledger divergence
    const memberCredits = wallet.ledgerEntries.filter(e => e.type === "CREDIT").reduce((s, e) => s + e.amountPaise, 0);
    const memberDebits = wallet.ledgerEntries.filter(e => e.type === "DEBIT").reduce((s, e) => s + e.amountPaise, 0);
    expect(wallet.balancePaise - (memberCredits - memberDebits)).toBe(0);

    const compCredits = companyWallet.ledgerEntries.filter(e => e.type === "CREDIT").reduce((s, e) => s + e.amountPaise, 0);
    const compDebits = companyWallet.ledgerEntries.filter(e => e.type === "DEBIT").reduce((s, e) => s + e.amountPaise, 0);
    expect(companyWallet.balancePaise - (compCredits - compDebits)).toBe(0);
  });
});
