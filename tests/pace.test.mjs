/**
 * Lot 0 — pacing (audit of 2026-11-26, defects 22–23): the scan under the mouse and the highlight redraw no longer run once per
 * event. The rules are in core/pace.mjs; the last test plays the highlight's hooks on the fake Foundry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { throttleLatest, coalesce } from "../module/scripts/core/pace.mjs";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("throttleLatest — the scan under the mouse (defect 22)", () => {
  it("runs at once, then at most once per window, with the latest arguments", () => {
    const seen = [];
    const scan = throttleLatest(x => seen.push(x), 40);
    for ( let x = 1; x <= 30; x++ ) scan(x);          // thirty mouse moves in the same instant
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(40);
    expect(seen).toEqual([1, 30]);                    // the last position is not lost
  });

  it("a hundred moves over 400 ms: about ten scans, not a hundred", () => {
    let scans = 0;
    const scan = throttleLatest(() => scans++, 40);
    for ( let i = 0; i < 100; i++ ) { scan(i); vi.advanceTimersByTime(4); }
    vi.advanceTimersByTime(40);
    expect(scans).toBeGreaterThanOrEqual(9);
    expect(scans).toBeLessThanOrEqual(12);
  });

  it("a lone move after a pause runs immediately", () => {
    const seen = [];
    const scan = throttleLatest(x => seen.push(x), 40);
    scan("a");
    vi.advanceTimersByTime(200);
    scan("b");
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("coalesce — the highlight redraw (defect 23)", () => {
  it("a burst of updates gives one redraw", () => {
    let redraws = 0;
    const later = coalesce(() => redraws++, 50);
    for ( let i = 0; i < 40; i++ ) later();
    expect(redraws).toBe(0);
    vi.advanceTimersByTime(50);
    expect(redraws).toBe(1);
  });

  it("a steady stream of updates cannot postpone the redraw for ever", () => {
    let redraws = 0;
    const later = coalesce(() => redraws++, 50);
    for ( let i = 0; i < 30; i++ ) { later(); vi.advanceTimersByTime(10); }   // 300 ms of updates, one every 10 ms
    expect(redraws).toBeGreaterThanOrEqual(5);
  });
});
