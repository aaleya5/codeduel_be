const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addCalendarDays,
  calculateStreaksFromResults,
  dateKeyForDatabaseDate,
  dateKeyForInstant,
  getDayBoundsInTimeZone,
  isDateKey,
} = require("../src/utils/challenge-date");

test("maps instants to the configured challenge calendar day", () => {
  assert.equal(
    dateKeyForInstant("2026-10-24T18:29:59.999Z", "Asia/Kolkata"),
    "2026-10-24"
  );
  assert.equal(
    dateKeyForInstant("2026-10-24T18:30:00.000Z", "Asia/Kolkata"),
    "2026-10-25"
  );
});

test("calculates local-day bounds without relying on the server time zone", () => {
  const { start, end } = getDayBoundsInTimeZone(
    "2026-04-02",
    "Asia/Kolkata"
  );
  assert.equal(start.toISOString(), "2026-04-01T18:30:00.000Z");
  assert.equal(end.toISOString(), "2026-04-02T18:30:00.000Z");
});

test("uses calendar-day bounds across daylight-saving transitions", () => {
  const { start, end } = getDayBoundsInTimeZone(
    "2026-03-08",
    "America/New_York"
  );
  assert.equal(start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(end.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(end.getTime() - start.getTime(), 23 * 60 * 60 * 1000);
});

test("validates and advances calendar keys across leap and year boundaries", () => {
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(isDateKey("2025-02-29"), false);
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-12-31", 1), "2025-01-01");
});

test("keeps database date-only values stable under different server time zones", () => {
  assert.equal(
    dateKeyForDatabaseDate(new Date("2026-01-01T00:00:00.000Z")),
    "2026-01-01"
  );
});

test("deduplicates cross-challenge daily results before calculating streaks", () => {
  const daily = (date, completed) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    completed,
  });
  const results = [
    daily("2026-04-04", true),
    daily("2026-04-05", false),
    daily("2026-04-05", true),
    daily("2026-04-06", true),
  ];

  assert.deepEqual(
    calculateStreaksFromResults(results, new Date("2026-04-07T06:00:00.000Z")),
    { currentStreak: 3, longestStreak: 3 }
  );
});

test("breaks streaks at missed days and expires a stale current streak", () => {
  const daily = (date, completed) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    completed,
  });

  assert.deepEqual(
    calculateStreaksFromResults(
      [
        daily("2026-04-04", true),
        daily("2026-04-05", false),
        daily("2026-04-06", true),
      ],
      new Date("2026-04-06T06:00:00.000Z")
    ),
    { currentStreak: 1, longestStreak: 1 }
  );
  assert.deepEqual(
    calculateStreaksFromResults(
      [daily("2026-04-04", true)],
      new Date("2026-04-06T06:00:00.000Z")
    ),
    { currentStreak: 0, longestStreak: 1 }
  );
});
