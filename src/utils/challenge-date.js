const { config } = require("../config/env");
const CHALLENGE_TIME_ZONE = config.challengeTimeZone;

const getDateParts = (value, timeZone = CHALLENGE_TIME_ZONE) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Invalid date");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
};

const dateKeyForInstant = (value, timeZone = CHALLENGE_TIME_ZONE) => {
  const parts = getDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isDateKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const dateKeyForDatabaseDate = (value) => {
  if (typeof value === "string" && isDateKey(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid database date");
  return date.toISOString().slice(0, 10);
};

const databaseDateForKey = (dateKey) => {
  if (!isDateKey(dateKey)) {
    throw new RangeError("Date must be a valid YYYY-MM-DD calendar date");
  }
  return new Date(`${dateKey}T00:00:00.000Z`);
};

const addCalendarDays = (dateKey, days) => {
  if (!isDateKey(dateKey) || !Number.isInteger(days)) {
    throw new RangeError("A valid date key and whole number of days are required");
  }
  const date = databaseDateForKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getOffsetAt = (instant, timeZone) => {
  const parts = getDatePartsWithTime(instant, timeZone);
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return localAsUtc - Math.floor(instant / 1000) * 1000;
};

const getDatePartsWithTime = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
};

const startOfDayInTimeZone = (dateKey, timeZone = CHALLENGE_TIME_ZONE) => {
  const utcMidnight = databaseDateForKey(dateKey).getTime();
  let start = utcMidnight - getOffsetAt(utcMidnight, timeZone);

  // Re-evaluate the offset at the estimated local midnight (handles DST zones).
  start = utcMidnight - getOffsetAt(start, timeZone);
  return new Date(start);
};

const getDayBoundsInTimeZone = (dateKey, timeZone = CHALLENGE_TIME_ZONE) => {
  const start = startOfDayInTimeZone(dateKey, timeZone);
  const nextStart = startOfDayInTimeZone(
    addCalendarDays(dateKey, 1),
    timeZone
  );
  return { start, end: nextStart };
};

const getTodayDateKey = (now = new Date(), timeZone = CHALLENGE_TIME_ZONE) =>
  dateKeyForInstant(now, timeZone);

const getYesterdayDateKey = (
  now = new Date(),
  timeZone = CHALLENGE_TIME_ZONE
) => addCalendarDays(getTodayDateKey(now, timeZone), -1);

const calculateStreaksFromResults = (results, now = new Date()) => {
  const completionByDate = new Map();
  for (const result of results) {
    const dateKey = dateKeyForDatabaseDate(result.date);
    completionByDate.set(
      dateKey,
      (completionByDate.get(dateKey) ?? false) || Boolean(result.completed)
    );
  }

  const days = [...completionByDate]
    .map(([date, completed]) => ({ date, completed }))
    .sort((left, right) => left.date.localeCompare(right.date));

  let longestStreak = 0;
  let runningStreak = 0;
  let previousDate = null;

  for (const day of days) {
    if (!day.completed) {
      runningStreak = 0;
    } else {
      runningStreak =
        previousDate && addCalendarDays(previousDate, 1) === day.date
          ? runningStreak + 1
          : 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    }
    previousDate = day.date;
  }

  const latest = days[days.length - 1];
  const today = getTodayDateKey(now);
  const yesterday = getYesterdayDateKey(now);
  if (
    !latest?.completed ||
    (latest.date !== today && latest.date !== yesterday)
  ) {
    return { currentStreak: 0, longestStreak };
  }

  let currentStreak = 1;
  for (let index = days.length - 2; index >= 0; index -= 1) {
    if (
      !days[index].completed ||
      addCalendarDays(days[index].date, 1) !== days[index + 1].date
    ) {
      break;
    }
    currentStreak += 1;
  }

  return { currentStreak, longestStreak };
};

module.exports = {
  CHALLENGE_TIME_ZONE,
  dateKeyForInstant,
  dateKeyForDatabaseDate,
  databaseDateForKey,
  isDateKey,
  addCalendarDays,
  startOfDayInTimeZone,
  getDayBoundsInTimeZone,
  getTodayDateKey,
  getYesterdayDateKey,
  calculateStreaksFromResults,
};
