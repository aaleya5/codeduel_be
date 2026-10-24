const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const demoUsers = [
  {
    email: "alex@codeduel.demo",
    username: "alexdemo",
    leetcodeUsername: "alexdemo",
    password: "Demo123!",
  },
  {
    email: "sarah@codeduel.demo",
    username: "sarahdemo",
    leetcodeUsername: "sarahdemo",
    password: "Demo123!",
  },
  {
    email: "mike@codeduel.demo",
    username: "mikedemo",
    leetcodeUsername: "mikedemo",
    password: "Demo123!",
  },
];

const day = (offset) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
};

const buildDailyResult = (memberId, challengeId, offset, config) => {
  const date = day(offset);
  const { completed, submissionsCount, problemsSolved } = config;

  return {
    challengeId,
    memberId,
    date,
    completed,
    submissionsCount,
    problemsSolved,
    evaluatedAt: date,
    metadata: {
      source: "seed-demo-data",
      note: completed ? "Accepted today" : "Missed target",
    },
  };
};

async function main() {
  const passwordHash = await bcrypt.hash("Demo123!", 10);

  const users = await Promise.all(
    demoUsers.map((user) =>
      prisma.user.upsert({
        where: { email: user.email },
        update: {
          username: user.username,
          leetcodeUsername: user.leetcodeUsername,
          password: passwordHash,
        },
        create: {
          email: user.email,
          username: user.username,
          leetcodeUsername: user.leetcodeUsername,
          password: passwordHash,
        },
      })
    )
  );

  const owner = users[0];
  const challenge = await prisma.challenge.findFirst({
    where: {
      name: "Weekend Sprint",
      ownerId: owner.id,
    },
  });

  const startDate = day(18);
  const endDate = day(-1);

  const createdChallenge = challenge
    ? await prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          startDate,
          endDate,
          status: "ACTIVE",
          description: "A short demo challenge for showcasing dashboards, streaks and submissions.",
          minSubmissionsPerDay: 1,
          difficultyFilter: ["Easy", "Medium"],
          uniqueProblemConstraint: true,
          penaltyAmount: 25,
        },
      })
    : await prisma.challenge.create({
        data: {
          name: "Weekend Sprint",
          description: "A short demo challenge for showcasing dashboards, streaks and submissions.",
          ownerId: owner.id,
          startDate,
          endDate,
          status: "ACTIVE",
          minSubmissionsPerDay: 1,
          difficultyFilter: ["Easy", "Medium"],
          uniqueProblemConstraint: true,
          penaltyAmount: 25,
        },
      });

  const memberPatterns = [
    {
      username: "alexdemo",
      currentStreak: 4,
      longestStreak: 8,
      progress: [
        { offset: 0, completed: true, submissionsCount: 2, problemsSolved: ["two-sum", "best-time-to-buy-and-sell-stock"] },
        { offset: 1, completed: true, submissionsCount: 3, problemsSolved: ["valid-anagram", "contains-duplicate", "merge-two-sorted-lists"] },
        { offset: 2, completed: true, submissionsCount: 4, problemsSolved: ["top-k-frequent-elements", "product-of-array-except-self", "valid-palindrome", "binary-search"] },
        { offset: 3, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 4, completed: true, submissionsCount: 2, problemsSolved: ["linked-list-cycle", "meeting-rooms"] },
        { offset: 5, completed: true, submissionsCount: 3, problemsSolved: ["group-anagrams", "find-median-from-data-stream", "spiral-matrix"] },
        { offset: 6, completed: true, submissionsCount: 2, problemsSolved: ["three-sum", "two-sum-ii-input-array-is-sorted"] },
        { offset: 7, completed: true, submissionsCount: 2, problemsSolved: ["merge-intervals", "minimum-window-substring"] },
        { offset: 8, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 9, completed: true, submissionsCount: 1, problemsSolved: ["word-break"] },
        { offset: 10, completed: true, submissionsCount: 3, problemsSolved: ["minimum-path-sum", "coin-change", "jump-game"] },
        { offset: 11, completed: true, submissionsCount: 2, problemsSolved: ["longest-substring-without-repeating-characters", "climbing-stairs"] },
        { offset: 12, completed: true, submissionsCount: 2, problemsSolved: ["longest-palindromic-substring", "decode-ways"] },
        { offset: 13, completed: true, submissionsCount: 1, problemsSolved: ["max-area-of-island"] },
      ],
    },
    {
      username: "sarahdemo",
      currentStreak: 3,
      longestStreak: 6,
      progress: [
        { offset: 0, completed: true, submissionsCount: 2, problemsSolved: ["reverse-words-in-a-string", "valid-parentheses"] },
        { offset: 1, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 2, completed: true, submissionsCount: 2, problemsSolved: ["best-time-to-buy-and-sell-stock", "two-sum"] },
        { offset: 3, completed: true, submissionsCount: 1, problemsSolved: ["plus-one"] },
        { offset: 4, completed: true, submissionsCount: 3, problemsSolved: ["binary-tree-level-order-traversal", "kth-largest-element-in-array", "same-tree"] },
        { offset: 5, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 6, completed: true, submissionsCount: 2, problemsSolved: ["max-subarray", "palindrome-number"] },
        { offset: 7, completed: true, submissionsCount: 2, problemsSolved: ["remove-duplicates-from-sorted-array", "longest-common-prefix"] },
        { offset: 8, completed: true, submissionsCount: 1, problemsSolved: ["merge-two-sorted-lists"] },
        { offset: 9, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 10, completed: true, submissionsCount: 2, problemsSolved: ["search-in-rotated-sorted-array", "container-with-most-water"] },
        { offset: 11, completed: true, submissionsCount: 2, problemsSolved: ["first-bad-version", "roman-to-integer"] },
        { offset: 12, completed: true, submissionsCount: 1, problemsSolved: ["word-pattern"] },
        { offset: 13, completed: true, submissionsCount: 2, problemsSolved: ["lowest-common-ancestor-of-a-binary-tree", "invert-binary-tree"] },
      ],
    },
    {
      username: "mikedemo",
      currentStreak: 1,
      longestStreak: 4,
      progress: [
        { offset: 0, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 1, completed: true, submissionsCount: 1, problemsSolved: ["majority-element"] },
        { offset: 2, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 3, completed: true, submissionsCount: 1, problemsSolved: ["missing-number"] },
        { offset: 4, completed: true, submissionsCount: 2, problemsSolved: ["single-number", "move-zeroes"] },
        { offset: 5, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 6, completed: true, submissionsCount: 2, problemsSolved: ["isomorphic-strings", "add-two-numbers"] },
        { offset: 7, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 8, completed: true, submissionsCount: 1, problemsSolved: ["fizz-buzz"] },
        { offset: 9, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 10, completed: true, submissionsCount: 2, problemsSolved: ["subtree-of-another-tree", "path-sum"] },
        { offset: 11, completed: false, submissionsCount: 0, problemsSolved: [] },
        { offset: 12, completed: true, submissionsCount: 1, problemsSolved: ["reverse-linked-list"] },
        { offset: 13, completed: true, submissionsCount: 2, problemsSolved: ["set-matrix-zeroes", "happy-number"] },
      ],
    },
  ];

  for (const pattern of memberPatterns) {
    const user = users.find((item) => item.username === pattern.username);
    if (!user) continue;

    const member = await prisma.challengeMember.upsert({
      where: {
        challengeId_userId: {
          challengeId: createdChallenge.id,
          userId: user.id,
        },
      },
      update: {
        currentStreak: pattern.currentStreak,
        longestStreak: pattern.longestStreak,
        isActive: true,
      },
      create: {
        challengeId: createdChallenge.id,
        userId: user.id,
        currentStreak: pattern.currentStreak,
        longestStreak: pattern.longestStreak,
        totalPenalties: 0,
        totalPaid: 0,
        isActive: true,
      },
    });

    for (const entry of pattern.progress) {
      const record = buildDailyResult(
        member.id,
        createdChallenge.id,
        entry.offset,
        entry
      );

      await prisma.dailyResult.upsert({
        where: {
          challengeId_memberId_date: {
            challengeId: createdChallenge.id,
            memberId: member.id,
            date: record.date,
          },
        },
        update: {
          completed: record.completed,
          submissionsCount: record.submissionsCount,
          problemsSolved: record.problemsSolved,
          evaluatedAt: record.evaluatedAt,
          metadata: record.metadata,
        },
        create: record,
      });
    }

    await prisma.penaltyLedger.deleteMany({
      where: {
        memberId: member.id,
        reason: { startsWith: "Demo seed penalty:" },
      },
    });

    const missedDays = pattern.progress.filter((entry) => !entry.completed);
    for (const entry of missedDays) {
      const hasDemoDispute =
        pattern.username === "sarahdemo" && entry.offset === 5;

      await prisma.penaltyLedger.create({
        data: {
          memberId: member.id,
          amount: 25,
          reason: `Demo seed penalty: Missed daily target (${day(entry.offset).toISOString().slice(0, 10)})`,
          date: day(entry.offset),
          ...(hasDemoDispute && {
            disputed: true,
            disputeReason:
              "I submitted an accepted solution, but this day was marked as missed.",
            disputeStatus: "PENDING",
          }),
        },
      });
    }

    await prisma.payment.deleteMany({
      where: {
        memberId: member.id,
        note: { startsWith: "Demo seed payment:" },
      },
    });

    if (pattern.username === "sarahdemo") {
      await prisma.payment.create({
        data: {
          memberId: member.id,
          amount: 25,
          currency: "INR",
          status: "PAID",
          method: "MANUAL",
          recordedBy: owner.id,
          note: "Demo seed payment: partial settlement",
        },
      });
    }

    const [penaltyTotals, paymentTotals] = await Promise.all([
      prisma.penaltyLedger.aggregate({
        where: { memberId: member.id },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { memberId: member.id, status: "PAID" },
        _sum: { amount: true },
      }),
    ]);

    await prisma.challengeMember.update({
      where: { id: member.id },
      data: {
        totalPenalties: penaltyTotals._sum.amount || 0,
        totalPaid: paymentTotals._sum.amount || 0,
      },
    });
  }

  console.log(`Seed complete: created ${users.length} demo users and one active challenge titled "Weekend Sprint".`);
}

main()
  .catch((error) => {
    console.error("Demo seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
