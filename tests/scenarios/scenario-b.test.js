const { truncateDb } = require("../helpers/cleanDb");
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
    expect(finalWallet.ledgerEntries.length).toBeGreaterThanOrEqual(2);
  });

  it("should fail when withdrawing more than balance", async () => {
    // Request a withdrawal of 10000 paise (wallet is currently 0)
    await expect(
      withdrawalService.requestWithdrawal(
        member.id,
        mainCard.id,
        "BANK",
        10000
      )
    ).rejects.toThrow(/Insufficient funds/);
  });
});
