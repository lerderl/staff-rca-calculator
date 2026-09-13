import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FileSpreadsheet, Download, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle2, Building2, Users, Banknote, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { AttributionFooter } from "@/components/attribution-footer.tsx";

const FOOTNOTE = "Conceived and Implemented by Capt (NN) YM Jazuli";
const MAX_PER_SCHEDULE = 950;

type RunPersonnel = {
  _id: Id<"runPersonnel">;
  runId: Id<"monthlyRuns">;
  svcNo: string;
  rankRate: string;
  name: string;
  bankName: string;
  sortCode: string;
  accountNo: string;
  amount: number;
};

type Schedule = {
  index: number;
  banks: string[];
  rows: RunPersonnel[];
  total: number;
};

/** Pack banks into schedules ≤950, keeping each bank intact where possible. */
function buildSchedules(personnel: RunPersonnel[]): Schedule[] {
  // Group by bank, preserving insertion order
  const bankGroups = new Map<string, RunPersonnel[]>();
  for (const p of personnel) {
    const list = bankGroups.get(p.bankName) ?? [];
    list.push(p);
    bankGroups.set(p.bankName, list);
  }

  const schedules: Schedule[] = [];
  let current: RunPersonnel[] = [];
  let currentBanks: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    schedules.push({
      index: schedules.length + 1,
      banks: [...currentBanks],
      rows: [...current],
      total: current.reduce((s, r) => s + r.amount, 0),
    });
    current = [];
    currentBanks = [];
  };

  for (const [bankName, people] of bankGroups) {
    if (people.length > MAX_PER_SCHEDULE) {
      // Bank exceeds limit — flush current, then split this bank into own schedules
      flush();
      for (let i = 0; i < people.length; i += MAX_PER_SCHEDULE) {
        const chunk = people.slice(i, i + MAX_PER_SCHEDULE);
        schedules.push({
          index: schedules.length + 1,
          banks: [bankName],
          rows: chunk,
          total: chunk.reduce((s, r) => s + r.amount, 0),
        });
      }
    } else if (current.length + people.length > MAX_PER_SCHEDULE) {
      flush();
      current = [...people];
      currentBanks = [bankName];
    } else {
      current.push(...people);
      currentBanks.push(bankName);
    }
  }
  flush();
  return schedules;
}

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** Format YYYY-MM-DD as "DD MMMM YYYY" (spaces, month in words, uppercase) */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const monthWord = MONTH_NAMES[parseInt(m, 10) - 1] ?? m;
  return `${d} ${monthWord} ${y}`;
}

/** Force cells in a column to text so leading zeros are preserved */
function forceTextColumn(ws: XLSX.WorkSheet, colLetter: string, fromRow: number, toRow: number) {
  for (let r = fromRow; r <= toRow; r++) {
    const ref = `${colLetter}${r}`;
    const cell = ws[ref];
    if (!cell) continue;
    ws[ref] = { t: "s", v: String(cell.v ?? ""), z: "@" };
  }
}

/** Apply bold style to cells in a worksheet */
function applyBold(ws: XLSX.WorkSheet, cellRefs: string[]) {
  for (const ref of cellRefs) {
    if (!ws[ref]) ws[ref] = { t: "s", v: "" };
    ws[ref].s = { ...(ws[ref].s ?? {}), font: { bold: true } };
  }
}

/** Build an Excel worksheet for one schedule using the bank mandate format */
function buildSheet(
  schedule: Schedule,
  totalSchedules: number,
  periodLabel: string,
  debitAccount: string,
  valueDate: string,
  paymentLabel: string
): XLSX.WorkSheet {
  const narration = `BEING PAYMENT OF ${periodLabel} ${paymentLabel.toUpperCase()}`;
  const valueDateFormatted = fmtDate(valueDate);

  // ── Column headers ────────────────────────────────────────────────────────
  const colHeaders = [
    "SERIAL",
    "BANK NAME",
    "BANK CODE/MDA ACCOUNT",
    "BENEFICIARY NAME",
    "BENEFICIARY ACCOUNT NUMBER",
    "AMOUNT",
    "DR/CR",
    "DEBIT NARRATION",
    "CREDIT NARRATION",
    "VALUE DATE",
  ];

  const rows: (string | number)[][] = [colHeaders];

  // ── Credit rows (one per person) ──────────────────────────────────────────
  schedule.rows.forEach((row, idx) => {
    rows.push([
      idx + 1,             // SERIAL
      row.bankName,        // BANK NAME
      row.sortCode,        // BANK CODE/MDA ACCOUNT (sort code)
      row.name,            // BENEFICIARY NAME
      row.accountNo,       // BENEFICIARY ACCOUNT NUMBER
      row.amount,          // AMOUNT
      "CR",                // DR/CR — credit for all personnel rows
      narration,           // DEBIT NARRATION
      narration,           // CREDIT NARRATION
      valueDateFormatted,  // VALUE DATE
    ]);
  });

  // ── Final debit row (CBN / debit account) ─────────────────────────────────
  rows.push([
    schedule.rows.length + 1,  // SERIAL
    "",                        // BANK NAME (blank for debit row)
    "",                        // BANK CODE/MDA ACCOUNT
    "CBN",                     // BENEFICIARY NAME
    debitAccount,              // BENEFICIARY ACCOUNT NUMBER (debit account)
    schedule.total,            // AMOUNT (total of all credits)
    "DR",                      // DR/CR — debit on last row
    narration,                 // DEBIT NARRATION
    narration,                 // CREDIT NARRATION
    valueDateFormatted,        // VALUE DATE
  ]);

  // ── Footnote ───────────────────────────────────────────────────────────────
  rows.push([]);
  rows.push(["", "", "", "", FOOTNOTE]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // ── Force BENEFICIARY ACCOUNT NUMBER column (E) to text ──────────────────
  // This preserves leading zeros in account numbers and sort codes
  // Data rows start at row 2 (row 1 is the header); last row is the DR row,
  // followed by 2 footnote rows which are excluded here
  const dataEnd = rows.length - 2;
  forceTextColumn(ws, "C", 2, dataEnd); // BANK CODE/MDA ACCOUNT (sort code)
  forceTextColumn(ws, "E", 2, dataEnd); // BENEFICIARY ACCOUNT NUMBER

  // ── Column widths ─────────────────────────────────────────────────────────
  ws["!cols"] = [
    { wch: 8 },   // SERIAL
    { wch: 24 },  // BANK NAME
    { wch: 24 },  // BANK CODE/MDA ACCOUNT
    { wch: 34 },  // BENEFICIARY NAME
    { wch: 28 },  // BENEFICIARY ACCOUNT NUMBER
    { wch: 16 },  // AMOUNT
    { wch: 8 },   // DR/CR
    { wch: 44 },  // DEBIT NARRATION
    { wch: 44 },  // CREDIT NARRATION
    { wch: 20 },  // VALUE DATE
  ];

  // ── Freeze header row ─────────────────────────────────────────────────────
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  // ── Bold header row ───────────────────────────────────────────────────────
  const colLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  applyBold(ws, colLetters.map((c) => `${c}1`));

  // ── Bold the debit (last) row ─────────────────────────────────────────────
  const drRow = rows.length - 2; // 1-based, before the 2 footnote rows
  applyBold(ws, colLetters.map((c) => `${c}${drRow}`));

  return ws;
}

export default function SchedulesPage() {
  const runs = useQuery(api.runs.list);
  const markExported = useMutation(api.runs.markExported);

  const [selectedRunId, setSelectedRunId] = useState<Id<"monthlyRuns"> | "">("");
  const [debitAccount, setDebitAccount] = useState("");
  const [valueDate, setValueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expandedSchedule, setExpandedSchedule] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingIndex, setExportingIndex] = useState<number | null>(null);

  const selectedRun = useQuery(
    api.runs.getById,
    selectedRunId ? { id: selectedRunId as Id<"monthlyRuns"> } : "skip"
  );

  const allPersonnel = useQuery(
    api.runs.getAllRunPersonnel,
    selectedRunId ? { runId: selectedRunId as Id<"monthlyRuns"> } : "skip"
  );

  const schedules = allPersonnel ? buildSchedules(allPersonnel) : null;
  const grandTotal = schedules ? schedules.reduce((s, sch) => s + sch.total, 0) : 0;

  // Derived values from selected run
  const paymentLabel = selectedRun?.paymentLabel ?? "RCA";
  const periodLabel = selectedRun
    ? `${MONTH_NAMES[(selectedRun.month ?? 1) - 1]} ${selectedRun.year ?? ""}`
    : "";

  // Banks that appear in more than one schedule (forced split)
  const bankCounts = new Map<string, number>();
  schedules?.forEach((s) => s.banks.forEach((b) => bankCounts.set(b, (bankCounts.get(b) ?? 0) + 1)));
  const splitBanks = [...bankCounts.entries()].filter(([, c]) => c > 1).map(([b]) => b);

  // Bank breakdown for the summary panel
  const bankBreakdown = new Map<string, { count: number; total: number }>();
  allPersonnel?.forEach((p) => {
    const entry = bankBreakdown.get(p.bankName) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += p.amount;
    bankBreakdown.set(p.bankName, entry);
  });
  const sortedBanks = [...bankBreakdown.entries()].sort((a, b) => b[1].count - a[1].count);

  const readyRuns = runs?.filter((r) => r.status === "ready" || r.status === "exported") ?? [];

  const guardExport = (): boolean => {
    if (!schedules || schedules.length === 0) return false;
    if (!debitAccount.trim()) {
      toast.error("Enter a debit account before exporting");
      return false;
    }
    if (!valueDate) {
      toast.error("Enter a value date before exporting");
      return false;
    }
    return true;
  };

  /** Export all schedules + summary sheet */
  const exportAll = async () => {
    if (!guardExport()) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      schedules!.forEach((schedule) => {
        const ws = buildSheet(schedule, schedules!.length, periodLabel, debitAccount, valueDate, paymentLabel);
        XLSX.utils.book_append_sheet(wb, ws, `Schedule ${schedule.index}`);
      });

      // Summary sheet
      const summaryRows: (string | number)[][] = [
        [`NIGERIAN NAVY — ${paymentLabel.toUpperCase()} PAYMENT SUMMARY`],
        [`Period: ${periodLabel}`],
        [`Debit Account: ${debitAccount}`],
        [`Value Date: ${fmtDate(valueDate)}`],
        [`Total Personnel: ${selectedRun?.totalMatched ?? 0}`],
        [`Grand Total: ₦${grandTotal.toLocaleString()}`],
        [],
        ["Schedule No.", "Banks", "No. of Records", "Total Amount (₦)"],
        ...schedules!.map((s) => [s.index, s.banks.join(", "), s.rows.length, s.total]),
        [],
        ["", "", "GRAND TOTAL", grandTotal],
        [],
        ["Bank Breakdown"],
        ["Bank Name", "No. of Personnel", "Total Amount (₦)"],
        ...sortedBanks.map(([bank, info]) => [bank, info.count, info.total]),
        [],
        [FOOTNOTE],
      ];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
      summaryWs["!cols"] = [{ wch: 16 }, { wch: 44 }, { wch: 20 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

      const filePrefix = paymentLabel.replace(/\s+/g, "_");
      const filePeriod = periodLabel.replace(/\s+/g, "_");
      const filename = `${filePrefix}_${filePeriod}_Schedules.xlsx`;
      XLSX.writeFile(wb, filename);

      if (selectedRunId) {
        await markExported({ runId: selectedRunId as Id<"monthlyRuns"> });
      }
      toast.success(`Exported ${schedules!.length} schedule(s) to ${filename}`);
    } catch (err) {
      toast.error("Export failed. Please try again.");
      console.error(err);
    }
    setExporting(false);
  };

  /** Export a single schedule */
  const exportOne = (schedule: Schedule) => {
    if (!guardExport()) return;
    setExportingIndex(schedule.index);
    try {
      const wb = XLSX.utils.book_new();
      const ws = buildSheet(schedule, schedules!.length, periodLabel, debitAccount, valueDate, paymentLabel);
      XLSX.utils.book_append_sheet(wb, ws, `Schedule ${schedule.index}`);
      const filePrefix = paymentLabel.replace(/\s+/g, "_");
      const filePeriod = periodLabel.replace(/\s+/g, "_");
      const filename = `${filePrefix}_${filePeriod}_Schedule_${schedule.index}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Schedule ${schedule.index} exported`);
    } catch {
      toast.error("Export failed");
    }
    setExportingIndex(null);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileSpreadsheet size={20} className="text-primary" />
          Bank Payment Schedules
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate bank schedules (max {MAX_PER_SCHEDULE} per schedule, banks kept together) and export to Excel.
        </p>
      </div>

      {/* Configuration */}
      <div className="border border-border rounded-xl p-5 space-y-4 bg-card">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Monthly Run</Label>
            <Select
              value={selectedRunId}
              onValueChange={(v) => {
                setSelectedRunId(v as Id<"monthlyRuns">);
                setExpandedSchedule(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select processed run..." />
              </SelectTrigger>
              <SelectContent>
                {runs === undefined ? (
                  <SelectItem value="loading" disabled>Loading...</SelectItem>
                ) : readyRuns.length === 0 ? (
                  <SelectItem value="none" disabled>No completed runs — process a month first</SelectItem>
                ) : (
                  readyRuns.map((r) => {
                    const rLabel = r.paymentLabel ?? "RCA";
                    return (
                      <SelectItem key={r._id} value={r._id}>
                        {r.label} · {r.totalMatched} records · {rLabel}
                        {r.status === "exported" ? " ✓" : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Debit Account <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Account number to debit"
              value={debitAccount}
              onChange={(e) => setDebitAccount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Value Date</Label>
            <Input
              type="date"
              value={valueDate}
              onChange={(e) => setValueDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {allPersonnel === undefined && selectedRunId && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {/* Populated state */}
      {schedules && schedules.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16} />} label="Total Personnel" value={selectedRun?.totalMatched.toLocaleString() ?? "—"} />
            <StatCard icon={<Hash size={16} />} label="Schedules" value={String(schedules.length)} />
            <StatCard icon={<Banknote size={16} />} label="Grand Total" value={`₦${grandTotal.toLocaleString()}`} accent />
            <StatCard icon={<Building2 size={16} />} label="Banks" value={String(bankBreakdown.size)} />
          </div>

          {/* Value date / debit account confirmation strip */}
          <div className="rounded-xl border border-border bg-muted/30 px-5 py-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Payment: <strong className="text-foreground">{paymentLabel}</strong>
            </span>
            <span className="text-muted-foreground">
              Debit Account: <strong className="text-foreground">{debitAccount || <span className="text-destructive">Not entered</span>}</strong>
            </span>
            <span className="text-muted-foreground">
              Value Date: <strong className="text-foreground">{valueDate ? fmtDate(valueDate) : "—"}</strong>
            </span>
            <span className="text-muted-foreground">
              Period: <strong className="text-foreground">{selectedRun?.label}</strong>
            </span>
          </div>

          {/* Split bank warning */}
          {splitBanks.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <strong>Bank split notice:</strong> The following bank(s) exceed {MAX_PER_SCHEDULE} records and are split across multiple schedules:{" "}
                {splitBanks.join(", ")}.
              </div>
            </div>
          )}

          {/* Export all button + bank breakdown toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">
              {schedules.length} Schedule{schedules.length !== 1 ? "s" : ""}
            </h3>
            <Button
              onClick={exportAll}
              disabled={exporting || !debitAccount.trim()}
              className="cursor-pointer"
            >
              <Download size={15} />
              {exporting ? "Exporting..." : "Export All to Excel"}
            </Button>
          </div>

          {/* Individual schedules */}
          <div className="space-y-3">
            {schedules.map((schedule) => {
              const isExpanded = expandedSchedule === schedule.index;
              return (
                <div key={schedule.index} className="border border-border rounded-xl overflow-hidden bg-card">
                  {/* Schedule header row */}
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <button
                      className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left"
                      onClick={() => setExpandedSchedule(isExpanded ? null : schedule.index)}
                    >
                      <span className="bg-primary/10 text-primary font-bold text-xs px-2.5 py-1 rounded-md shrink-0">
                        Schedule {schedule.index}
                      </span>
                      <span className="text-sm text-muted-foreground truncate">
                        {schedule.banks.join(" · ")}
                      </span>
                      <span className="ml-auto shrink-0 text-sm font-medium text-muted-foreground">
                        {schedule.rows.length} records
                      </span>
                      <span className="shrink-0 text-sm font-bold text-primary">
                        ₦{schedule.total.toLocaleString()}
                      </span>
                      {isExpanded ? <ChevronUp size={15} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={15} className="shrink-0 text-muted-foreground" />}
                    </button>
                    {/* Per-schedule export button */}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="cursor-pointer shrink-0 text-xs"
                      disabled={!debitAccount.trim() || exportingIndex === schedule.index}
                      onClick={(e) => { e.stopPropagation(); exportOne(schedule); }}
                    >
                      <Download size={13} />
                      {exportingIndex === schedule.index ? "..." : "Export"}
                    </Button>
                  </div>

                  {/* Expanded schedule detail */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* Meta info strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 px-5 py-3 bg-muted/30 text-xs text-muted-foreground">
                        <span>Debit Account: <strong className="text-foreground">{debitAccount || "—"}</strong></span>
                        <span>Value Date: <strong className="text-foreground">{valueDate ? fmtDate(valueDate) : "—"}</strong></span>
                        <span>Records: <strong className="text-foreground">{schedule.rows.length}</strong></span>
                        <span>Total Debit: <strong className="text-foreground">₦{schedule.total.toLocaleString()}</strong></span>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 border-y border-border">
                            <tr>
                              {["S/N", "Rank/Rate", "Svc No", "Name", "Bank", "Sort Code", "Account No", "Amount (₦)"].map((h, i) => (
                                <th
                                  key={h}
                                  className={`px-4 py-2.5 text-muted-foreground font-semibold text-xs whitespace-nowrap ${i === 7 ? "text-right" : "text-left"}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {schedule.rows.slice(0, 100).map((row, idx) => (
                              <tr key={row._id} className="hover:bg-muted/20 transition-colors">
                                <td className="px-4 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                                <td className="px-4 py-2 text-xs">{row.rankRate}</td>
                                <td className="px-4 py-2 font-mono text-xs">{row.svcNo}</td>
                                <td className="px-4 py-2 text-xs font-medium">{row.name}</td>
                                <td className="px-4 py-2 text-xs text-muted-foreground">{row.bankName}</td>
                                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.sortCode}</td>
                                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.accountNo}</td>
                                <td className="px-4 py-2 text-right text-xs font-medium">{row.amount.toLocaleString()}</td>
                              </tr>
                            ))}
                            {schedule.rows.length > 100 && (
                              <tr>
                                <td colSpan={8} className="px-4 py-3 text-center text-xs text-muted-foreground italic">
                                  Showing first 100 of {schedule.rows.length} records — export to Excel to see all.
                                </td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot className="bg-muted/40 border-t border-border">
                            <tr>
                              <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-right text-muted-foreground">
                                Schedule Total
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm font-bold text-primary">
                                ₦{schedule.total.toLocaleString()}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bank breakdown table */}
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <Building2 size={16} className="text-primary" />
              <span className="font-semibold text-sm">Bank Breakdown</span>
              <span className="text-xs text-muted-foreground ml-1">({bankBreakdown.size} banks)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-xs text-muted-foreground font-semibold">Bank Name</th>
                    <th className="text-right px-5 py-2.5 text-xs text-muted-foreground font-semibold">Personnel</th>
                    <th className="text-right px-5 py-2.5 text-xs text-muted-foreground font-semibold">Total Amount (₦)</th>
                    <th className="text-right px-5 py-2.5 text-xs text-muted-foreground font-semibold">Schedules</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedBanks.map(([bank, info]) => (
                    <tr key={bank} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-2.5 text-sm font-medium">{bank}</td>
                      <td className="px-5 py-2.5 text-right text-sm">{info.count.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right text-sm font-mono">{info.total.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right text-sm">
                        {bankCounts.get(bank) ?? 1}
                        {(bankCounts.get(bank) ?? 1) > 1 && (
                          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(split)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border">
                  <tr>
                    <td className="px-5 py-2.5 text-xs font-bold">TOTAL</td>
                    <td className="px-5 py-2.5 text-right text-xs font-bold">{selectedRun?.totalMatched.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right text-xs font-bold">₦{grandTotal.toLocaleString()}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Already-exported notice */}
          {selectedRun?.status === "exported" && (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-xl px-4 py-3">
              <CheckCircle2 size={15} />
              This run has been exported to Excel. You can export it again if needed.
            </div>
          )}
        </>
      )}

      {/* Empty / prompt states */}
      {!selectedRunId && (
        <div className="text-center py-16 text-muted-foreground text-sm space-y-1">
          <FileSpreadsheet size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Select a completed monthly run above</p>
          <p className="text-xs">Runs processed in Monthly Processing will appear in the dropdown.</p>
        </div>
      )}

      {selectedRunId && allPersonnel !== undefined && allPersonnel.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No personnel found for this run. Go to Monthly Processing and process the run first.
        </div>
      )}

      <AttributionFooter />
    </div>
  );
}

function StatCard({
  icon, label, value, accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`border rounded-xl px-4 py-4 space-y-1 ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
