#!/usr/bin/env node
const assert = require("assert");
const {
  seedsForPeriod,
  periodKey,
  isBlockedTrendTitle,
  NICHE_POOL,
} = require("../trending-engine");

const dayA = seedsForPeriod("day", new Date("2026-08-07T12:00:00Z"));
const dayB = seedsForPeriod("day", new Date("2026-08-08T12:00:00Z"));
assert.equal(dayA.length, 6, "6 niches / jour");
assert.notDeepEqual(dayA, dayB, "rotation jour à jour");

const week = seedsForPeriod("week", new Date("2026-08-07T12:00:00Z"));
assert.ok(week.length >= 8 && week.length <= 10, "8–10 niches / semaine");

assert.ok(NICHE_POOL.length >= 30, "pool niches large");
assert.ok(isBlockedTrendTitle("Coque Stone Island iPhone 15"));
assert.ok(isBlockedTrendTitle("Butter stick slime rose"));
assert.ok(!isBlockedTrendTitle("Bande LED RGB 5m WiFi Alexa"));

assert.ok(/^day-/.test(periodKey("day")));
assert.ok(/^week-/.test(periodKey("week")));
assert.ok(/^month-/.test(periodKey("month")));

const { peekTrendingCache } = require("../trending-engine");
assert.strictEqual(peekTrendingCache({ period: "day" }), null, "pas de cache au départ OK");

console.log("OK trending-engine verify");
console.log("  day niches:", dayA.join(" | "));
