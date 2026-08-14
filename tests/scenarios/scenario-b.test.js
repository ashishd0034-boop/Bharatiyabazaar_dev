const prisma = require("../../src/lib/prisma");
const { purchaseIds } = require("../../src/services/idCardService");
const withdrawalService = require("../../src/services/withdrawalService");

describe("Scenario B: Wallet & Ledger Integration", () => {
  let member;
  let mainCard;
  const testMobile = "9999999992";

  beforeAll(async () => {
    await cleanDb();
    
    member = await prisma.member.create({
      data: {
        name: "Test Member B",
        mobile: testMobile,
        kycStatus: "VERIFIED"
      }
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.withdrawal.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.commissionEntry.deleteMany({});
    await prisma.payOnceLedger.deleteMany({});
    await prisma.autoPoolNode.deleteMany({});
    await prisma.mySystemNode.deleteMany({});
    await prisma.memberIdCard.deleteMany({});
    await prisma.member.deleteMany({ where: { mobile: testMobile } });
  }

  it("should sweep unlocked commissions into wallet, update ledger, and allow withdrawal", async () => {
    // 1. Purchase 3 IDs. Triggers AutoPool (30000) and ACB unlocks it -> Credits Wallet
    const cards = await purchaseIds(member.id, 3);
    mainCard = cards.find(c => c.type === "MAIN");

    // 2. Verify Wallet Balance
    const wallet = await prisma.wallet.findUnique({
      where: { memberId: member.id },
      include: { ledgerEntries: true }
    });
    
    expect(wallet).toBeDefined();
    expect(wallet.balancePaise).toBe(30000);
    expect(wallet.ledgerEntries).toHaveLength(1);

    const creditEntry = wallet.ledgerEntries[0];
    expect(creditEntry.type).toBe("CREDIT");
    expect(creditEntry.amountPaise).toBe(30000);
    expect(creditEntry.balanceBeforePaise).toBe(0);
    expect(creditEntry.balanceAfterPaise).toBe(30000);
    expect(creditEntry.source).toBe("AUTOPOOL");

    // 3. Request Withdrawal
    const withdrawal = await withdrawalService.requestWithdrawal(
      member.id,
      mainCard.id,
      "BANK",
      30000
    );

    expect(withdrawal.grossPaise).toBe(30000);
    expect(withdrawal.status).toBe("REQUESTED");

    // 4. Process Withdrawal (Approve)
    await withdrawalService.processWithdrawal(withdrawal.id, "APPROVE");

    // 5. Verify final wallet and ledger
    const finalWallet = await prisma.wallet.findUnique({
      where: { memberId: member.id },
      include: { 
        ledgerEntries: { orderBy: { createdAt: 'asc' } }
      }
    });

    expect(finalWallet.balancePaise).toBe(0);
    expect(finalWallet.ledgerEntries).toHaveLength(2);

    const debitEntry = finalWallet.ledgerEntries[1];
    expect(debitEntry.type).toBe("DEBIT");
    expect(debitEntry.amountPaise).toBe(30000);
    expect(debitEntry.balanceBeforePaise).toBe(30000);
    expect(debitEntry.balanceAfterPaise).toBe(0);
    expect(debitEntry.source).toBe("WITHDRAWAL");
  });

  it("should fail when withdrawing more than balance", async () => {
    // Request a withdrawal of 5000 paise (wallet is currently 0)
    const withdrawal = await withdrawalService.requestWithdrawal(
      member.id,
      mainCard.id,
      "BANK",
      5000
    );
    
    // Approving should fail with Insufficient funds
    await expect(
      withdrawalService.processWithdrawal(withdrawal.id, "APPROVE")
    ).rejects.toThrow(/Insufficient funds/);
  });
});
