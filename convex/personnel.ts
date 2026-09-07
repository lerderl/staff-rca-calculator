import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

export const list = query({
  args: {
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("personnel").order("asc");
    const results = await q.paginate(args.paginationOpts);
    if (args.search && args.search.trim()) {
      const term = args.search.toLowerCase();
      return {
        ...results,
        page: results.page.filter(
          (p) =>
            p.svcNo.toLowerCase().includes(term) ||
            p.name.toLowerCase().includes(term) ||
            p.bankName.toLowerCase().includes(term)
        ),
      };
    }
    return results;
  },
});

export const getCount = query({
  args: {},
  handler: async (ctx) => {
    // Use a bounded take to estimate count (up to 10000)
    const items = await ctx.db.query("personnel").take(10001);
    return items.length;
  },
});

export const getBySvcNo = query({
  args: { svcNo: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("personnel")
      .withIndex("by_svc_no", (q) => q.eq("svcNo", args.svcNo))
      .unique();
  },
});

export const upsertOne = mutation({
  args: {
    rankRate: v.string(),
    svcNo: v.string(),
    bankName: v.string(),
    sortCode: v.string(),
    name: v.string(),
    accountNo: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("personnel")
      .withIndex("by_svc_no", (q) => q.eq("svcNo", args.svcNo))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rankRate: args.rankRate,
        bankName: args.bankName,
        sortCode: args.sortCode,
        name: args.name,
        accountNo: args.accountNo,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("personnel", args);
    }
  },
});

export const updateOne = mutation({
  args: {
    id: v.id("personnel"),
    rankRate: v.string(),
    svcNo: v.string(),
    bankName: v.string(),
    sortCode: v.string(),
    name: v.string(),
    accountNo: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...data } = args;
    await ctx.db.replace(id, data);
  },
});

export const deleteOne = mutation({
  args: { id: v.id("personnel") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Bulk import - accepts array of records, upserts by svcNo
export const bulkImport = mutation({
  args: {
    records: v.array(
      v.object({
        rankRate: v.string(),
        svcNo: v.string(),
        bankName: v.string(),
        sortCode: v.string(),
        name: v.string(),
        accountNo: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    for (const rec of args.records) {
      const existing = await ctx.db
        .query("personnel")
        .withIndex("by_svc_no", (q) => q.eq("svcNo", rec.svcNo))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          rankRate: rec.rankRate,
          bankName: rec.bankName,
          sortCode: rec.sortCode,
          name: rec.name,
          accountNo: rec.accountNo,
        });
        updated++;
      } else {
        await ctx.db.insert("personnel", rec);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    let batch = await ctx.db.query("personnel").take(500);
    while (batch.length > 0) {
      for (const doc of batch) {
        await ctx.db.delete(doc._id);
      }
      batch = await ctx.db.query("personnel").take(500);
    }
  },
});
