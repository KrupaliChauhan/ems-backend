import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProjectTimeLimitInput,
  parseProjectTimeLimit,
  resolveProjectEndDate
} from "../services/projectService";

test("parseProjectTimeLimit supports common abbreviations and compact formats", () => {
  assert.deepEqual(parseProjectTimeLimit("3months"), { amount: 3, unit: "month" });
  assert.deepEqual(parseProjectTimeLimit("2 wks"), { amount: 2, unit: "week" });
  assert.deepEqual(parseProjectTimeLimit("1 yr"), { amount: 1, unit: "year" });
});

test("normalizeProjectTimeLimitInput stores canonical singular/plural values", () => {
  assert.equal(normalizeProjectTimeLimitInput("1yr"), "1 year");
  assert.equal(normalizeProjectTimeLimitInput("2 months"), "2 months");
  assert.equal(normalizeProjectTimeLimitInput(" 30day "), "30 days");
  assert.equal(normalizeProjectTimeLimitInput("custom timeline"), "custom timeline");
});

test("resolveProjectEndDate works with normalized compact time limit input", () => {
  const endDate = resolveProjectEndDate(new Date("2026-04-01T00:00:00.000Z"), "2wks");
  assert.ok(endDate);
  assert.equal(endDate?.toISOString().slice(0, 10), "2026-04-15");
});
