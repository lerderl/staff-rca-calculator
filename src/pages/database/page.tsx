import { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Upload, Plus, Search, Trash2, Pencil, Database, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { paginationOptsValidator } from "convex/server";
import { usePaginatedQuery } from "convex/react";
import { Badge } from "@/components/ui/badge.tsx";

type PersonnelRecord = {
  rankRate: string;
  svcNo: string;
  bankName: string;
  sortCode: string;
  name: string;
  accountNo: string;
};

type EditingRecord = PersonnelRecord & { _id: Id<"personnel"> };

const EMPTY_FORM: PersonnelRecord = {
  rankRate: "", svcNo: "", bankName: "", sortCode: "", name: "", accountNo: "",
};

export default function DatabasePage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EditingRecord | null>(null);
  const [form, setForm] = useState<PersonnelRecord>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<Id<"personnel"> | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const { results, status, loadMore } = usePaginatedQuery(
    api.personnel.list,
    { search: search || undefined },
    { initialNumItems: 50 }
  );

  const count = useQuery(api.personnel.getCount);
  const upsertOne = useMutation(api.personnel.upsertOne);
  const updateOne = useMutation(api.personnel.updateOne);
  const deleteOne = useMutation(api.personnel.deleteOne);
  const bulkImport = useMutation(api.personnel.bulkImport);
  const clearAll = useMutation(api.personnel.clearAll);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const data = await file.arrayBuffer();
      // cellText:true makes XLSX store the formatted display string in cell.w
      const wb = XLSX.read(data, { cellText: true, cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];

      // raw:false returns the formatted text (cell.w) instead of the raw numeric value.
      // This preserves leading zeros in account numbers, sort codes, svc nos, etc.
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }) as unknown[][];

      // Expected columns: Serial · Rank/Rate · Svc No · Bank Name · Sort Code · Name · Account No
      const records: PersonnelRecord[] = [];
      const seen = new Set<string>();

      // Find the header row by looking for a row that contains "svc" in any cell
      let headerRowIdx = -1;
      let svcColIdx = -1;
      let rankColIdx = -1;
      let bankColIdx = -1;
      let sortColIdx = -1;
      let nameColIdx = -1;
      let accountColIdx = -1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        // Check if this looks like a header row (has "svc" somewhere)
        const hasSvc = row.some((c) => String(c ?? "").toLowerCase().includes("svc"));
        if (hasSvc) {
          headerRowIdx = i;
          // Map each column by header keyword
          row.forEach((cell, j) => {
            const h = String(cell ?? "").toLowerCase().trim();
            if (h.includes("svc")) svcColIdx = j;
            else if (h.includes("rank") || h.includes("rate")) rankColIdx = j;
            else if (h.includes("bank")) bankColIdx = j;
            else if (h.includes("sort")) sortColIdx = j;
            else if (h.includes("name") || h.includes("nm")) nameColIdx = j;
            else if (h.includes("account") || h.includes("acct") || h.includes("acc")) accountColIdx = j;
          });
          break;
        }
      }

      // Fall back to fixed positions if header detection failed:
      // Serial(0), Rank/Rate(1), Svc No(2), Bank Name(3), Sort Code(4), Name(5), Account No(6)
      if (headerRowIdx < 0) {
        headerRowIdx = 0;
        rankColIdx = 1; svcColIdx = 2; bankColIdx = 3;
        sortColIdx = 4; nameColIdx = 5; accountColIdx = 6;
      }

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;

        const rankRate = rankColIdx >= 0 ? String(row[rankColIdx] ?? "").trim() : "";
        const svcNo = svcColIdx >= 0 ? String(row[svcColIdx] ?? "").trim() : "";
        const bankName = bankColIdx >= 0 ? String(row[bankColIdx] ?? "").trim() : "";
        const sortCode = sortColIdx >= 0 ? String(row[sortColIdx] ?? "").trim() : "";
        const name = nameColIdx >= 0 ? String(row[nameColIdx] ?? "").trim() : "";
        const accountNo = accountColIdx >= 0 ? String(row[accountColIdx] ?? "").trim() : "";

        if (!svcNo || seen.has(svcNo)) continue;
        seen.add(svcNo);
        records.push({ rankRate, svcNo, bankName, sortCode, name, accountNo });
      }

      if (records.length === 0) {
        toast.error("No valid records found in file");
        return;
      }

      // Process in batches of 100
      let totalInserted = 0;
      let totalUpdated = 0;
      const BATCH = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const result = await bulkImport({ records: batch });
        totalInserted += result.inserted;
        totalUpdated += result.updated;
      }

      setImportResult({ inserted: totalInserted, updated: totalUpdated });
      toast.success(`Imported ${totalInserted + totalUpdated} records`);
    } catch (err) {
      toast.error("Failed to read file. Please check the format.");
      console.error(err);
    } finally {
      setImporting(false);
    }
  }, [bulkImport]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [], "application/vnd.ms-excel": [] },
    multiple: false,
  });

  const openAdd = () => {
    setEditRecord(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (rec: EditingRecord) => {
    setEditRecord(rec);
    setForm({ rankRate: rec.rankRate, svcNo: rec.svcNo, bankName: rec.bankName, sortCode: rec.sortCode, name: rec.name, accountNo: rec.accountNo });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.svcNo || !form.name) {
      toast.error("Svc No and Name are required");
      return;
    }
    try {
      if (editRecord) {
        await updateOne({ id: editRecord._id, ...form });
        toast.success("Record updated");
      } else {
        await upsertOne(form);
        toast.success("Record saved");
      }
      setDialogOpen(false);
    } catch {
      toast.error("Failed to save record");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteOne({ id: deleteId });
      toast.success("Record deleted");
    } catch {
      toast.error("Failed to delete");
    }
    setDeleteId(null);
  };

  const handleClearAll = async () => {
    try {
      await clearAll();
      toast.success("Database cleared");
    } catch {
      toast.error("Failed to clear database");
    }
    setClearConfirm(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database size={20} className="text-primary" />
            Master Personnel Database
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {count !== undefined ? `${count.toLocaleString()} records` : "Loading..."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => setClearConfirm(true)} className="text-destructive hover:text-destructive cursor-pointer">
            <Trash2 size={14} /> Clear All
          </Button>
          <Button size="sm" onClick={openAdd} className="cursor-pointer">
            <Plus size={14} /> Add Record
          </Button>
        </div>
      </div>

      {/* Import area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <input {...getInputProps()} />
        <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">
          {importing ? "Importing..." : "Drop Excel database file here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Columns: Serial · Rank/Rate · Svc No · Bank Name · Sort Code · Name · Account No
        </p>
        {importResult && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 size={14} />
            {importResult.inserted} inserted, {importResult.updated} updated
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by Svc No, Name, or Bank..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground w-12">Serial</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Rank/Rate</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Svc No</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Bank Name</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Sort Code</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Account No</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {results === undefined || status === "LoadingFirstPage" ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No records found. Import an Excel file or add records manually.
                  </td>
                </tr>
              ) : (
                results.map((rec, idx) => (
                  <tr key={rec._id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rec.rankRate}</td>
                    <td className="px-4 py-3 font-mono font-medium">{rec.svcNo}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rec.bankName}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{rec.sortCode}</td>
                    <td className="px-4 py-3 font-medium">{rec.name}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{rec.accountNo}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 cursor-pointer"
                          onClick={() => openEdit(rec as EditingRecord)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive cursor-pointer"
                          onClick={() => setDeleteId(rec._id as Id<"personnel">)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {status === "CanLoadMore" && (
          <div className="p-4 border-t border-border text-center">
            <Button variant="secondary" size="sm" onClick={() => loadMore(50)} className="cursor-pointer">
              Load more
            </Button>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRecord ? "Edit Record" : "Add Personnel Record"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Rank/Rate</Label>
              <Input value={form.rankRate} onChange={(e) => setForm({ ...form, rankRate: e.target.value })} placeholder="e.g. CPO" />
            </div>
            <div className="space-y-1.5">
              <Label>Svc No *</Label>
              <Input value={form.svcNo} onChange={(e) => setForm({ ...form, svcNo: e.target.value })} placeholder="e.g. NN12345" />
            </div>
            <div className="space-y-1.5">
              <Label>Bank Name</Label>
              <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. GTBank" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort Code</Label>
              <Input value={form.sortCode} onChange={(e) => setForm({ ...form, sortCode: e.target.value })} placeholder="e.g. 058" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Account No</Label>
              <Input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} placeholder="10-digit account number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleSave} className="cursor-pointer">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete record?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white cursor-pointer">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear all confirm */}
      <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear entire database?</AlertDialogTitle>
            <AlertDialogDescription>
              All {count} personnel records will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-white cursor-pointer">Clear All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
