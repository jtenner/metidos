/**
 * @file src/bun/metidos-tool-load-benchmark.test.ts
 * @description Test file for the Metidos tool load benchmark.
 */

import { describe, expect, it } from "bun:test";

import {
  parseArgs,
  runMetidosToolLoadBenchmark,
} from "./metidos-tool-load-benchmark";

describe("metidos tool load benchmark", () => {
  it("parses numeric options and json mode", () => {
    const parsed = parseArgs([
      "--json",
      "--concurrency",
      "5",
      "--hold-ms=12",
      "--iterations",
      "9",
    ]);

    expect(parsed).toEqual({
      concurrency: 5,
      help: false,
      holdMs: 12,
      iterations: 9,
      json: true,
    });
  });

  it("reports stricter unsafe saturation and sandbox backpressure", async () => {
    const report = await runMetidosToolLoadBenchmark({
      concurrency: 4,
      help: false,
      holdMs: 5,
      iterations: 8,
      json: false,
    });

    expect(report.scenarios).toHaveLength(7);
    expect(report.referenceTime).toBe("2026-04-12T20:30:00.000Z");

    const threadComparison = report.comparisons.find(
      (entry) => entry.family === "new_thread",
    );
    const newCronComparison = report.comparisons.find(
      (entry) => entry.family === "new_cron",
    );
    const updateCronComparison = report.comparisons.find(
      (entry) => entry.family === "update_cron",
    );
    const sandboxScenario = report.scenarios.find(
      (entry) => entry.name === "run_untrusted_js",
    );

    expect(threadComparison).toBeDefined();
    expect(newCronComparison).toBeDefined();
    expect(updateCronComparison).toBeDefined();
    expect(sandboxScenario).toBeDefined();

    expect(threadComparison?.safeCompleted ?? 0).toBeGreaterThan(
      threadComparison?.unsafeCompleted ?? 0,
    );
    expect(threadComparison?.unsafeSaturationCount ?? 0).toBeGreaterThan(
      threadComparison?.safeSaturationCount ?? 0,
    );
    expect(newCronComparison?.safeCompleted ?? 0).toBeGreaterThan(
      newCronComparison?.unsafeCompleted ?? 0,
    );
    expect(newCronComparison?.unsafeSaturationCount ?? 0).toBeGreaterThan(
      newCronComparison?.safeSaturationCount ?? 0,
    );
    expect(updateCronComparison?.safeCompleted ?? 0).toBeGreaterThan(
      updateCronComparison?.unsafeCompleted ?? 0,
    );
    expect(updateCronComparison?.unsafeSaturationCount ?? 0).toBeGreaterThan(
      updateCronComparison?.safeSaturationCount ?? 0,
    );
    expect(sandboxScenario?.saturationCount ?? 0).toBeGreaterThan(0);
    const sandboxBudget =
      sandboxScenario?.metidosTools.budgets?.byBudget.sandbox_runs;
    expect(sandboxBudget).toBeDefined();
    expect(sandboxBudget?.saturationEvents ?? 0).toBeGreaterThan(0);
  });
});
