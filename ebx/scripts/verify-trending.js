#!/usr/bin/env node
const assert = require("assert");
const {
  seedsForPeriod,
  periodKey,
  isBlockedTrendTitle,
  NICHE_POOL,
} = require("../trending-engine");

const dayA = seedsForPeriod("day", new Date("2026-08-07T12:00:00Z"), "FR");
const dayB = seedsForPeriod("day", new Date("2026-08-08T12:00:00Z"), "FR");
assert.equal(dayA.length, 18, "18 niches / jour");
assert.notDeepEqual(dayA, dayB, "rotation jour à jour");

const week = seedsForPeriod("week", new Date("2026-08-07T12:00:00Z"), "FR");
assert.ok(week.length >= 8 && week.length <= 10, "8–10 niches / semaine");

const usSeeds = seedsForPeriod("day", new Date("2026-08-07T12:00:00Z"), "US");
assert.ok(usSeeds.some((s) => /phone|led|usb|case/i.test(s)), "niches US en anglais");
assert.notDeepEqual(usSeeds, dayA, "US ≠ FR");

const deSeeds = seedsForPeriod("day", new Date("2026-08-07T12:00:00Z"), "DE");
assert.ok(deSeeds.some((s) => /handy|led|usb|silikon/i.test(s)), "niches DE en allemand");

assert.ok(NICHE_POOL.length >= 30, "pool niches large");
assert.ok(isBlockedTrendTitle("Coque Stone Island iPhone 15"));
assert.ok(isBlockedTrendTitle("Butter stick slime rose"));
assert.ok(!isBlockedTrendTitle("Bande LED RGB 5m WiFi Alexa"));

assert.ok(/^day-/.test(periodKey("day")));
assert.ok(/^week-/.test(periodKey("week")));
assert.ok(/^month-/.test(periodKey("month")));

const { peekTrendingCache, nichePoolForMarket } = require("../trending-engine");
assert.strictEqual(peekTrendingCache({ period: "day", marketplace: "FR" }), null, "pas de cache au départ OK");
assert.ok(nichePoolForMarket("US").length >= 30);
assert.ok(nichePoolForMarket("DE").length >= 30);

console.log("OK trending-engine verify");
console.log("  day FR:", dayA.slice(0, 3).join(" | "));
console.log("  day US:", usSeeds.slice(0, 3).join(" | "));
console.log("  day DE:", deSeeds.slice(0, 3).join(" | "));
