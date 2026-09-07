import { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import {
  CalendarCheck, AlertTriangle, CheckCircle2, Trash2,
  ChevronDown, ChevronUp, FileUp, ArrowRight, X, FileText, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { useNavigate } from "react-router-dom";
import { usePaginatedQuery } from "convex/react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 1 + i);

// Process Svc Nos in batches of this size to respect Convex limits
const BATCH_SIZE = 150;

type UploadedFile = { name: string; svcNos: string[] };

export default function ProcessingPage() {
  const navigate = useNavigate();
  const runs = useQuery(api.runs.list);
  const createRun = useMutation(api.runs.create);
  const initProcessRun = useMutation(api.runs.initProcessRun);
  const processBatch = useMutation(api.runs.processBatch);
  const finalizeRun = useMutation(api.runs.finalizeRun);
  const deleteRun = useMutation(api.runs.deleteRun);

  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [creating, setCreating] = useState(false);
  const [activeRunId, setActiveRunId] = useState<Id<"monthlyRuns"> | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [deleteRunId, setDeleteRunId] = useState<Id<"monthlyRuns"> | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);
  const [pendingCreate, setPendingCreate] = useState(false);

  const activeRun = useQuery(
    api.runs.getById,
    activeRunId ? { id: activeRunId } : "skip"
  );

  const existingRun = useQuery(
    api.runs.findExistingRun,
    { month: Number(month), year: Number(year) }
  );

  const { results: matchedResults, status: resultsStatus, loadMore } = usePaginatedQuery(
    api.runs.getRunPersonnel,
    activeRunId && showResults ? { runId: activeRunId } : "skip",
    { initialNumItems: 50 }
  );

  // Deduplicated Svc Nos across all uploaded files
  const allSvcNos = [...new Set(uploadedFiles.flatMap((f) => f.svcNos))];

  const handleCreateRun = async (force = false) => {
    if (!force && existingRun) {
      setOverwriteConfirm(true);
      setPendingCreate(true);
      return;
    }
    setCreating(true);
    try {
      // If overwriting, delete the existing run first
      if (existingRun) {
        await deleteRun({ runId: existingRun._id });
      }
      const id = await createRun({ month: Number(month), year: Number(year) });
      setActiveRunId(id);
      setUploadedFiles([]);
      setShowResults(false);
      toast.success(`Run created for ${MONTHS[Number(month) - 1]} ${year}`);
    } catch {
      toast.error("Failed to create run");
    }
    setCreating(false);
    setPendingCreate(false);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    let loaded = 0;
    acceptedFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          // cellText:true + raw:false returns the formatted display string
          // so leading zeros in account numbers and svc nos are preserved
          const wb = XLSX.read(data, { cellText: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }) as unknown[][];
          const svcNos: string[] = [];

          // Find the header row — first non-empty row
          let headerRowIdx = -1;
          let svcColIdx = -1;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            // Look for a cell containing "svc" in this row
            for (let j = 0; j < row.length; j++) {
              const cell = String(row[j] ?? "").toLowerCase().trim();
              if (cell.includes("svc")) {
                headerRowIdx = i;
                svcColIdx = j;
                break;
              }
            }
            if (headerRowIdx >= 0) break;
          }

          // If no "svc" header found, fall back to column index 1 (original behaviour)
          if (svcColIdx < 0) {
            svcColIdx = 1;
            headerRowIdx = 0; // treat first row as header to skip
          }

          // Read data rows (everything after the header row)
          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length <= svcColIdx) continue;
            const raw = String(row[svcColIdx] ?? "").trim();
            if (!raw) continue;
            svcNos.push(raw);
          }

          setUploadedFiles((prev) => {
            // Replace if same filename, otherwise append
            const idx = prev.findIndex((f) => f.name === file.name);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { name: file.name, svcNos };
              return updated;
            }
            return [...prev, { name: file.name, svcNos }];
          });
        } catch {
          toast.error(`Failed to read ${file.name}`);
        }
        loaded++;
        if (loaded === acceptedFiles.length) {
          toast.success(`${acceptedFiles.length} file(s) loaded`);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [],
      "application/vnd.ms-excel": [],
    },
    multiple: true,
    disabled: !activeRunId,
  });

  const removeFile = (name: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleProcess = async () => {
    if (!activeRunId || allSvcNos.length === 0) return;
    setProcessing(true);
    setProcessProgress(0);
    setShowResults(false);

    try {
      // Step 1: clear previous data
      await initProcessRun({ runId: activeRunId });

      // Step 2: process in batches
      const allMatched: string[] = [];
      const allUnmatched: string[] = [];
      const batches = [];
      for (let i = 0; i < allSvcNos.length; i += BATCH_SIZE) {
        batches.push(allSvcNos.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const result = await processBatch({ runId: activeRunId, svcNos: batches[i] });
        allMatched.push(...result.matched);
        allUnmatched.push(...result.unmatched);
        setProcessProgress(Math.round(((i + 1) / batches.length) * 100));
      }

      // Step 3: finalise
      await finalizeRun({
        runId: activeRunId,
        totalMatched: allMatched.length,
        unmatchedSvcNos: allUnmatched,
      });

      toast.success(
        `Done. ${allMatched.length} matched, ${allUnmatched.length} unmatched.`
      );
      setShowResults(true);
    } catch (err) {
      toast.error("Processing failed. Please try again.");
      console.error(err);
    }
    setProcessing(false);
    setProcessProgress(0);
  };

  const handleDelete = async () => {
    if (!deleteRunId) return;
    try {
      await deleteRun({ runId: deleteRunId });
      if (activeRunId === deleteRunId) {
        setActiveRunId(null);
        setUploadedFiles([]);
        setShowResults(false);
      }
      toast.success("Run deleted");
    } catch {
      toast.error("Failed to delete");
    }
    setDeleteRunId(null);
  };

  const totalSvcNos = allSvcNos.length;
  const duplicatesRemoved =
    uploadedFiles.flatMap((f) => f.svcNos).length - totalSvcNos;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarCheck size={20} className="text-primary" />
          Monthly Processing
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Select the month, upload branch complement files, and match Svc Nos against the master database.
        </p>
      </div>

      {/* Step 1 — Select Month */}
      <div className="border border-border rounded-xl p-5 space-y-4 bg-card">
        <StepHeader n={1} title="Select Month & Year" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Month</label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Year</label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => handleCreateRun(false)} disabled={creating} className="cursor-pointer">
            Create Run
          </Button>
        </div>

        {/* Existing run warning */}
        {existingRun && !activeRunId && (
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
            <AlertTriangle size={15} />
            A run already exists for {MONTHS[Number(month) - 1]} {year} ({existingRun.totalMatched} matched). Creating a new run will replace it.
          </div>
        )}

        {activeRun && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-2">
            <CheckCircle2 size={15} />
            <span>
              Active run: <strong>{activeRun.label}</strong> —{" "}
              <strong>₦{activeRun.rcaPerPerson.toLocaleString()}</strong> per person
              <span className="text-xs ml-1 opacity-70">({activeRun.daysInMonth} days × ₦3,000)</span>
            </span>
          </div>
        )}
      </div>

      {/* Step 2 — Upload Files */}
      <div className={`border border-border rounded-xl p-5 space-y-4 bg-card transition-opacity ${!activeRunId ? "opacity-40 pointer-events-none" : ""}`}>
        <StepHeader n={2} title="Upload Branch Complement Files" />

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <FileUp size={22} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">
            {isDragActive ? "Drop files here..." : "Drop branch files here, or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Multiple files allowed · Svc No auto-detected by column header · Excel (.xlsx / .xls)
          </p>
        </div>

        {/* File list */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-2">
            {uploadedFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <FileText size={15} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{f.svcNos.length} Svc Nos</span>
                <button
                  onClick={() => removeFile(f.name)}
                  className="text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
                  aria-label="Remove file"
                >
                  <X size={14} />
                </button>
              </div>
            ))}

            {/* Summary */}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
              <span className="font-semibold text-foreground">{totalSvcNos} unique Svc Nos</span>
              {duplicatesRemoved > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-0.5">
                  {duplicatesRemoved} duplicate(s) removed
                </span>
              )}
              <button
                onClick={() => setUploadedFiles([])}
                className="text-xs text-muted-foreground hover:text-destructive cursor-pointer ml-auto"
              >
                Clear all files
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 3 — Process */}
      <div className={`border border-border rounded-xl p-5 space-y-4 bg-card transition-opacity ${(!activeRunId || totalSvcNos === 0) ? "opacity-40 pointer-events-none" : ""}`}>
        <StepHeader n={3} title="Process & Match" />
        <p className="text-sm text-muted-foreground">
          Match <strong>{totalSvcNos}</strong> Svc Nos against the master database and calculate RCA of{" "}
          <strong>₦{activeRun?.rcaPerPerson.toLocaleString() ?? "..."}</strong> per person.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={handleProcess}
            disabled={processing || totalSvcNos === 0 || !activeRunId}
            className="cursor-pointer"
          >
            {processing ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                Processing... {processProgress > 0 ? `${processProgress}%` : ""}
              </>
            ) : (
              <>
                Process Run
                <ArrowRight size={15} />
              </>
            )}
          </Button>
          {activeRun?.status === "ready" && !processing && (
            <span className="text-xs text-muted-foreground">
              Last processed: {activeRun.totalMatched} matched
            </span>
          )}
        </div>

        {/* Progress bar */}
        {processing && processProgress > 0 && (
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${processProgress}%` }}
            />
          </div>
        )}

        {/* Results after processing */}
        {activeRun?.status === "ready" && (
          <div className="space-y-3">
            {/* Success banner */}
            <div className="flex flex-wrap items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-2.5">
              <CheckCircle2 size={15} />
              <span>
                <strong>{activeRun.totalMatched}</strong> personnel matched and ready.
                Total RCA: <strong>₦{(activeRun.totalMatched * activeRun.rcaPerPerson).toLocaleString()}</strong>
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto cursor-pointer text-xs"
                onClick={() => navigate("/schedules")}
              >
                Go to Schedules <ArrowRight size={13} />
              </Button>
            </div>

            {/* Unmatched warning */}
            {activeRun.unmatchedSvcNos.length > 0 && (
              <div className="border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                <button
                  className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 cursor-pointer w-full text-left"
                  onClick={() => setShowUnmatched(!showUnmatched)}
                >
                  <AlertTriangle size={15} />
                  {activeRun.unmatchedSvcNos.length} Svc No(s) not found in master database
                  <span className="ml-auto">
                    {showUnmatched ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {showUnmatched && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {activeRun.unmatchedSvcNos.map((svc) => (
                      <Badge key={svc} variant="secondary" className="font-mono text-xs">
                        {svc}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Matched results preview */}
            <div className="border border-border rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-sm font-medium text-left"
                onClick={() => setShowResults(!showResults)}
              >
                <span>Preview matched personnel</span>
                <span className="ml-auto">
                  {showResults ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>

              {showResults && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs">#</th>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs">Svc No</th>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs">Name</th>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs">Rank/Rate</th>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs">Bank</th>
                          <th className="text-right px-4 py-2.5 text-muted-foreground font-semibold text-xs">Amount (₦)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {resultsStatus === "LoadingFirstPage" ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <tr key={i}>
                              {Array.from({ length: 6 }).map((_, j) => (
                                <td key={j} className="px-4 py-2.5">
                                  <Skeleton className="h-3.5 w-full" />
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          matchedResults?.map((row, idx) => (
                            <tr key={row._id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                              <td className="px-4 py-2 font-mono text-xs">{row.svcNo}</td>
                              <td className="px-4 py-2 text-xs font-medium">{row.name}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{row.rankRate}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{row.bankName}</td>
                              <td className="px-4 py-2 text-right text-xs font-medium">
                                {row.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {resultsStatus === "CanLoadMore" && (
                    <div className="border-t border-border p-3 text-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadMore(50)}
                        className="cursor-pointer"
                      >
                        Load more
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Previous runs */}
      {runs && runs.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-widest">
            Previous Runs
          </h3>
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run._id}
                className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{run.label}</span>
                  <span className="text-muted-foreground text-xs ml-3">
                    {run.totalMatched} matched · ₦{run.rcaPerPerson.toLocaleString()}/person
                  </span>
                </div>
                <Badge
                  variant={run.status === "ready" || run.status === "exported" ? "default" : "secondary"}
                  className="text-xs shrink-0"
                >
                  {run.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer text-xs shrink-0"
                  onClick={() => {
                    setActiveRunId(run._id);
                    setUploadedFiles([]);
                    setShowResults(run.status === "ready");
                  }}
                >
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive cursor-pointer shrink-0"
                  onClick={() => setDeleteRunId(run._id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overwrite confirm dialog */}
      <AlertDialog open={overwriteConfirm} onOpenChange={setOverwriteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing run?</AlertDialogTitle>
            <AlertDialogDescription>
              A run for {MONTHS[Number(month) - 1]} {year} already exists with{" "}
              {existingRun?.totalMatched ?? 0} matched records. Creating a new run will permanently
              delete the existing one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" onClick={() => setPendingCreate(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white cursor-pointer"
              onClick={() => { setOverwriteConfirm(false); handleCreateRun(true); }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete run dialog */}
      <AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              All processed data for this run will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white cursor-pointer"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-primary text-primary-foreground text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">
        {n}
      </span>
      <h3 className="font-semibold">{title}</h3>
    </div>
  );
}
