const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { requestWithdrawal, processWithdrawal } = require("../../src/services/withdrawalService");
const walletService = require("../../src/services/walletService");

describe("Scenario D: Withdrawal, Escrow, TDS, and Rejection", () => {
  const testMobile = "9999999994";
  let member;
  let idCard;

  beforeAll(async () => {
    await cleanDb();
    
    member = await prisma.member.create({
      data: {
        name: "Test Member D",
        mobile: testMobile,
        kycStatus: "VERIFIED"
      }
    });

    idCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "BB55555",
        type: "MAIN",
        acbStatus: true,
        status: "ACTIVE"
      }
    });

    await prisma.wallet.create({
      data: {
        memberId: member.id,
        balancePaise: 0
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

  it("should enforce minimum withdrawal limit", async () => {
    await expect(
      requestWithdrawal(member.id, idCard.id, "BANK", 5000)
    ).rejects.toThrow("Minimum withdrawal amount is Rs. 100");
  });

  it("should fail to request withdrawal if balance is insufficient", async () => {
    // Wallet is currently empty (0 balance).
    await expect(
      requestWithdrawal(member.id, idCard.id, "BANK", 50000)
    ).rejects.toThrow(`Insufficient funds for member ${member.id}`);
  });

  it("should deduct wallet (escrow) on successful request and restore on rejection", async () => {
    // 1. Credit wallet with Rs. 1000 (100,000 paise)
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 100000, "COMMISSION");
    });

    const w1 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    expect(w1.balancePaise).toBe(100000);

    // 2. Request Rs. 600 (60,000 paise)
    const withdrawal = await requestWithdrawal(member.id, idCard.id, "BANK", 60000);
    
    // Wallet should be 40,000
    const w2 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    expect(w2.balancePaise).toBe(40000);

    // 3. Reject the withdrawal
    await processWithdrawal(withdrawal.id, "REJECT", "Invalid bank details");

    // Wallet should be restored to 100,000
    const w3 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    expect(w3.balancePaise).toBe(100000);
    
    // Status should be REJECTED
    const wRecord = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    expect(wRecord.status).toBe("REJECTED");
  });

  it("should calculate zero TDS if below Rs. 20,000 FY threshold", async () => {
    // Request Rs. 15,000 (1,500,000 paise)
    // We already have Rs. 1000 in wallet. Let's add Rs. 14,000 more.
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 1400000, "COMMISSION");
    });
    // Wallet is now Rs. 15,000 (1,500,000 paise)

    const withdrawal = await requestWithdrawal(member.id, idCard.id, "BANK", 1500000);
    
    const w2 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    expect(w2.balancePaise).toBe(0);

    await processWithdrawal(withdrawal.id, "APPROVE");

    const record = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    
    expect(record.status).toBe("COMPLETED");
    expect(record.grossPaise).toBe(1500000);
    expect(record.tdsPaise).toBe(0); // Under 20k threshold
    
    // Admin Charge for BANK is 10%. (15,000 - 0) * 10% = 1,500 (150,000 paise)
    expect(record.adminChargePaise).toBe(150000);
    
    // Net Payable: 15,000 - 0 - 1,500 = 13,500 (1,350,000 paise)
    expect(record.netPaise).toBe(1350000);

    // Wallet balance should be exactly 0
    const w3 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    expect(w3.balancePaise).toBe(0);
  });

  it("should apply marginal TDS when crossing the Rs. 20,000 threshold", async () => {
    // Current FY accumulated: Rs. 15,000.
    // Request: Rs. 10,000 (1,000,000 paise).
    // Total FY will be Rs. 25,000.
    // Threshold is Rs. 20,000.
    // Marginal taxable amount = Rs. 5,000 (500,000 paise).
    // TDS (3% since KYC VERIFIED) = Rs. 150 (15,000 paise).
    
    // The previous test created a completed withdrawal of Rs. 15,000 for this member.
    // So priorGrossPaise is already 1,500,000.
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 1000000, "COMMISSION");
    });
    
    const withdrawal = await requestWithdrawal(member.id, idCard.id, "BANK", 1000000);
    await processWithdrawal(withdrawal.id, "APPROVE");

    const record = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    
    expect(record.status).toBe("COMPLETED");
    expect(record.grossPaise).toBe(1000000);
    
    // Taxable is 5,000 (500,000 paise) * 0.03 = 15,000 paise
    expect(record.tdsPaise).toBe(15000);
    
    // Admin Charge is 10% of Post-TDS.
    // Post-TDS = 1,000,000 - 15,000 = 985,000 paise
    // 985,000 * 0.10 = 98,500 paise
    expect(record.adminChargePaise).toBe(98500);
    
    // Net Payable = 985,000 - 98,500 = 886,500 paise
    expect(record.netPaise).toBe(886500);

    // Verify Ledger Math Assertion via database entries
    const w3 = await prisma.wallet.findUnique({ where: { memberId: member.id } });
    const ledgers = await prisma.ledgerEntry.findMany({
      where: { walletId: w3.id }, // find by wallet instead
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    // Expected ledgers (last 5 for this wallet):
    // 1. ADMIN_FEE (Debit 98500)
    // 2. TDS_DEDUCTED (Debit 15000)
    // 3. WITHDRAWAL_PAYOUT (Debit 886500)
    // 4. ESCROW_RELEASED (Credit 1000000)
    // 5. WITHDRAWAL_ESCROW (Debit 1000000)
    expect(ledgers.length).toBe(5);
    
    const escrow = ledgers.find(l => l.source === "WITHDRAWAL_ESCROW");
    const released = ledgers.find(l => l.source === "ESCROW_RELEASED");
    const payout = ledgers.find(l => l.source === "WITHDRAWAL_PAYOUT");
    const tds = ledgers.find(l => l.source === "TDS_DEDUCTED");
    const admin = ledgers.find(l => l.source === "ADMIN_FEE");
    
    expect(escrow.amountPaise).toBe(1000000);
    expect(escrow.type).toBe("DEBIT");
    
    expect(released.amountPaise).toBe(1000000);
    expect(released.type).toBe("CREDIT");
    
    expect(payout.amountPaise).toBe(886500);
    expect(tds.amountPaise).toBe(15000);
    expect(admin.amountPaise).toBe(98500);

    // Check TdsLedger table
    const tdsEntry = await prisma.tdsLedger.findFirst({
      where: { referenceId: withdrawal.id }
    });
    expect(tdsEntry.amountPaise).toBe(15000);
    expect(tdsEntry.status).toBe("DEPOSITED");
    expect(tdsEntry.section).toBe("SECTION_194H");
  });
  
  it("should apply full TDS when completely over threshold", async () => {
    // Current FY accumulated: Rs. 25,000.
    // Request: Rs. 5,000 (500,000 paise).
    // Entire amount is taxable.
    // TDS (3%) = Rs. 150 (15,000 paise).
    
    // The previous tests created completed withdrawals of Rs. 15,000 and Rs. 10,000.
    // So priorGrossPaise is already 2,500,000 (which is > 2,000,000).
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 500000, "COMMISSION");
    });
    
    const withdrawal = await requestWithdrawal(member.id, idCard.id, "BANK", 500000);
    await processWithdrawal(withdrawal.id, "APPROVE");

    const record = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    
    expect(record.status).toBe("COMPLETED");
    expect(record.grossPaise).toBe(500000);
    expect(record.tdsPaise).toBe(15000);
    
    // Post-TDS = 500,000 - 15,000 = 485,000 paise
    // Admin = 485,000 * 0.10 = 48,500 paise
    expect(record.adminChargePaise).toBe(48500);
    
    // Net Payable = 485,000 - 48,500 = 436,500 paise
    expect(record.netPaise).toBe(436500);
  });
  
  it("should apply 20% TDS if KYC is not verified", async () => {
    // Create new member without PAN (KYC unverified)
    const unverifiedMember = await prisma.member.create({
      data: {
        name: "Unverified D",
        mobile: "9999999995",
        kycStatus: "PENDING"
      }
    });
    
    const idCard2 = await prisma.memberIdCard.create({
      data: {
        memberId: unverifiedMember.id,
        cardNumber: "BB55556",
        type: "MAIN",
        acbStatus: true,
        status: "ACTIVE"
      }
    });
    
    // Give them Rs. 30,000 (crosses 20k threshold fully)
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, unverifiedMember.id, 3000000, "COMMISSION");
    });
    
    const withdrawal = await requestWithdrawal(unverifiedMember.id, idCard2.id, "BANK", 3000000);
    await processWithdrawal(withdrawal.id, "APPROVE");

    const record = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    
    expect(record.grossPaise).toBe(3000000);
    
    // Taxable = 30k - 20k = Rs. 10,000 (1,000,000 paise)
    // TDS = 20% of 1,000,000 = 200,000 paise (Rs. 2,000)
    expect(record.tdsPaise).toBe(200000);
  });
});
