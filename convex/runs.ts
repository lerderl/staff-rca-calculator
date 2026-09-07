import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("monthlyRuns").order("desc").take(50);
  },
});

export const getById = query({
  args: { id: v.id("monthlyRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const daysInMonth = new Date(args.year, args.month, 0).getDate();
    const rcaRate = 3000;
    return await ctx.db.insert("monthlyRuns", {
      month: args.month,
      year: args.year,
      label: `${months[args.month - 1]} ${args.year}`,
      rcaRate,
      daysInMonth,
      rcaPerPerson: rcaRate * daysInMonth,
      status: "processing",
      totalMatched: 0,
      unmatchedSvcNos: [],
    });
  },
});

export const getRunPersonnel = query({
  args: {
    runId: v.id("monthlyRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runPersonnel")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .paginate(args.paginationOpts);
  },
});

export const getAllRunPersonnel = query({
  args: { runId: v.id("monthlyRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runPersonnel")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

// Step 1: Clear previous results and reset run to "processing"
export const initProcessRun = mutation({
  args: { runId: v.id("monthlyRuns") },
  handler: async (ctx, args) => {
    // Clear existing runPersonnel in batches
    let batch = await ctx.db
      .query("runPersonnel")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500);
    while (batch.length > 0) {
      for (const e of batch) await ctx.db.delete(e._id);
      batch = await ctx.db
        .query("runPersonnel")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .take(500);
    }
    await ctx.db.patch(args.runId, { status: "processing", totalMatched: 0, unmatchedSvcNos: [] });
  },
});

// Step 2: Process a batch of Svc Nos (call multiple times for large datasets)
export const processBatch = mutation({
  args: {
    runId: v.id("monthlyRuns"),
    svcNos: v.array(v.string()), // max ~200 per batch
  },
  handler: async (ctx, args): Promise<{ matched: string[]; unmatched: string[] }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const svcNo of args.svcNos) {
      const person = await ctx.db
        .query("personnel")
        .withIndex("by_svc_no", (q) => q.eq("svcNo", svcNo))
        .unique();
      if (person) {
        await ctx.db.insert("runPersonnel", {
          runId: args.runId,
          svcNo: person.svcNo,
          rankRate: person.rankRate,
          name: person.name,
          bankName: person.bankName,
          sortCode: person.sortCode,
          accountNo: person.accountNo,
          amount: run.rcaPerPerson,
        });
        matched.push(svcNo);
      } else {
        unmatched.push(svcNo);
      }
    }
    return { matched, unmatched };
  },
});

// Step 3: Finalise the run with totals and unmatched list
export const finalizeRun = mutation({
  args: {
    runId: v.id("monthlyRuns"),
    totalMatched: v.number(),
    unmatchedSvcNos: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "ready",
      totalMatched: args.totalMatched,
      unmatchedSvcNos: args.unmatchedSvcNos,
    });
  },
});

// Legacy single-call version (kept for backwards compatibility)
export const processRun = mutation({
  args: {
    runId: v.id("monthlyRuns"),
    svcNos: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ matched: number; unmatched: number }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    let batch = await ctx.db
      .query("runPersonnel")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500);
    while (batch.length > 0) {
      for (const e of batch) await ctx.db.delete(e._id);
      batch = await ctx.db
        .query("runPersonnel")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .take(500);
    }

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const svcNo of args.svcNos) {
      const person = await ctx.db
        .query("personnel")
        .withIndex("by_svc_no", (q) => q.eq("svcNo", svcNo))
        .unique();
      if (person) {
        await ctx.db.insert("runPersonnel", {
          runId: args.runId,
          svcNo: person.svcNo,
          rankRate: person.rankRate,
          name: person.name,
          bankName: person.bankName,
          sortCode: person.sortCode,
          accountNo: person.accountNo,
          amount: run.rcaPerPerson,
        });
        matched.push(svcNo);
      } else {
        unmatched.push(svcNo);
      }
    }

    await ctx.db.patch(args.runId, {
      status: "ready",
      totalMatched: matched.length,
      unmatchedSvcNos: unmatched,
    });

    return { matched: matched.length, unmatched: unmatched.length };
  },
});

// Check if a run already exists for a given month/year
export const findExistingRun = query({
  args: { month: v.number(), year: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("monthlyRuns")
      .withIndex("by_year_month", (q) => q.eq("year", args.year).eq("month", args.month))
      .first();
  },
});

export const markExported = mutation({
  args: { runId: v.id("monthlyRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { status: "exported" });
  },
});

export const deleteRun = mutation({
  args: { runId: v.id("monthlyRuns") },
  handler: async (ctx, args) => {
    // Delete all run personnel first
    const personnel = await ctx.db
      .query("runPersonnel")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    for (const p of personnel) {
      await ctx.db.delete(p._id);
    }
    await ctx.db.delete(args.runId);
  },
});
