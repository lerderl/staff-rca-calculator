import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  // Users, sessions, and sign-in accounts managed by @convex-dev/auth.
  ...authTables,

  // Master personnel database
  personnel: defineTable({
    rankRate: v.string(),
    svcNo: v.string(),
    bankName: v.string(),
    sortCode: v.string(),
    name: v.string(),
    accountNo: v.string(),
  })
    .index("by_svc_no", ["svcNo"])
    .index("by_bank", ["bankName"]),

  // Monthly processing runs
  monthlyRuns: defineTable({
    month: v.number(), // 1-12
    year: v.number(),
    label: v.string(), // e.g. "September 2025"
    rcaRate: v.number(), // 3000
    daysInMonth: v.number(),
    rcaPerPerson: v.number(), // rate * days
    status: v.union(v.literal("processing"), v.literal("ready"), v.literal("exported")),
    totalMatched: v.number(),
    unmatchedSvcNos: v.array(v.string()),
  }).index("by_year_month", ["year", "month"]),

  // Personnel in a monthly run (matched)
  runPersonnel: defineTable({
    runId: v.id("monthlyRuns"),
    svcNo: v.string(),
    rankRate: v.string(),
    name: v.string(),
    bankName: v.string(),
    sortCode: v.string(),
    accountNo: v.string(),
    amount: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_bank", ["runId", "bankName"]),
});
