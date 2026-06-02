"use client";

import { useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createInvoiceSchema } from "@/lib/validators";
import type { CreateInvoiceInput, InvoiceExtractionResult } from "@/lib/validators";
import {
  extractInvoiceFieldsAction,
  saveInvoice,
  checkInvoiceDuplicate,
  cleanupBlob,
  overwriteInvoice,
} from "@/actions/invoices";
import { cn, formatCurrency } from "@/lib/utils";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import type { UseFormRegisterReturn } from "react-hook-form";

type UploadState = "idle" | "uploading" | "extracting" | "extracted" | "error";

type ConfidenceLevel = "high" | "medium" | "low";

type DuplicateInfo = {
  isDuplicate: boolean;
  existingInvoice?: {
    id: number;
    invoiceNumber: string;
    invoiceDate: string;
    amountCents: number;
    vendor: string | null;
    linkedBilledCostId: number | null;
  };
};

const ARIA_STATUS: Record<UploadState, string> = {
  idle: "",
  uploading: "Uploading PDF\u2026",
  extracting: "Extracting invoice fields\u2026",
  extracted: "Extraction complete. Please review the form.",
  error: "Extraction failed. Please enter fields manually.",
};

function isLowConfidence(
  confidence: ConfidenceLevel | undefined,
  value: string | null | undefined
): boolean {
  return confidence === "low" || value === null || value === undefined || value === "";
}

type ConfidenceInputProps = {
  id: string;
  label: string;
  placeholder: string;
  type?: string;
  registerProps: UseFormRegisterReturn;
  confidence: ConfidenceLevel | undefined;
  watchedValue: string | null | undefined;
  error?: string;
  step?: string;
  min?: string;
  onBlur?: () => void;
};

function ConfidenceInput({
  id,
  label,
  placeholder,
  type,
  registerProps,
  confidence,
  watchedValue,
  error,
  step,
  min,
  onBlur,
}: ConfidenceInputProps) {
  const low = isLowConfidence(confidence, watchedValue);

  // Merge the external onBlur with registerProps.onBlur
  const mergedRegisterProps = onBlur
    ? {
        ...registerProps,
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          registerProps.onBlur(e);
          onBlur();
        },
      }
    : registerProps;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Input
              id={id}
              type={type}
              {...mergedRegisterProps}
              className={cn(low ? "border-warning" : "")}
              placeholder={placeholder}
              step={step}
              min={min}
            />
          </TooltipTrigger>
          {low && <TooltipContent>Low confidence — please verify</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function InvoiceUploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [extractionResult, setExtractionResult] =
    useState<InvoiceExtractionResult | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const status = useInlineStatus();
  const dupStatus = useInlineStatus();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
  });

  const { invoiceNumber, invoiceDate, vendor, blobPathname } = watch();
  // Separate state for the dollars display value (T017/T018)
  const [amountDollars, setAmountDollars] = useState("");
  const confidence = extractionResult?.confidence;

  const runDuplicateCheck = useCallback(async (invNumber: string) => {
    if (!invNumber || invNumber.trim() === "") {
      setDuplicateInfo(null);
      return;
    }
    const result = await checkInvoiceDuplicate(invNumber.trim());
    if (result.success) {
      setDuplicateInfo(result.data);
      if (result.data.isDuplicate) {
        setDuplicateDialogOpen(true);
      }
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      status.error("PDF only");
      return;
    }

    setUploadState("uploading");
    setExtractionResult(null);
    setDuplicateInfo(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/invoices/upload-url", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error ?? "Failed to upload file");
      }
      const { objectKey, blobUrl } = await uploadRes.json();

      setValue("blobPathname", objectKey);
      setValue("blobUrl", blobUrl);

      setUploadState("extracting");

      const result = await extractInvoiceFieldsAction({ objectKey });
      if (!result.success) {
        setUploadState("error");
        status.error(result.error);
        return;
      }

      const extracted = result.data;
      setExtractionResult(extracted);

      if (extracted.invoiceNumber) setValue("invoiceNumber", extracted.invoiceNumber);
      if (extracted.invoiceDate) setValue("invoiceDate", extracted.invoiceDate);
      if (extracted.amountCents) {
        // T018: Convert cents to dollars for display
        const dollars = (extracted.amountCents / 100).toFixed(2);
        setAmountDollars(dollars);
        setValue("amountCents", extracted.amountCents);
      }
      if (extracted.vendor) setValue("vendor", extracted.vendor);

      setUploadState("extracted");

      // T006: Run duplicate check after extraction
      if (extracted.invoiceNumber) {
        await runDuplicateCheck(extracted.invoiceNumber);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadState("error");
      status.error(message);
    }
  };

  // T008: Skip (cancel upload) action
  const handleSkipDuplicate = async () => {
    const currentBlobPathname = watch().blobPathname;
    if (currentBlobPathname) {
      await cleanupBlob(currentBlobPathname);
    }
    reset();
    setAmountDollars("");
    setUploadState("idle");
    setExtractionResult(null);
    setDuplicateInfo(null);
    setDuplicateDialogOpen(false);
    dupStatus.clear();
    status.info("Skipped");
  };

  // T009: Overwrite existing action
  const handleOverwriteDuplicate = async () => {
    if (!duplicateInfo?.existingInvoice) return;

    setIsOverwriting(true);
    try {
      const formValues = watch();
      const parsedAmount = parseFloat(amountDollars);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        dupStatus.error("Invalid amount");
        setIsOverwriting(false);
        return;
      }
      const amountCents = Math.round(parsedAmount * 100);

      const result = await overwriteInvoice({
        existingInvoiceId: duplicateInfo.existingInvoice.id,
        invoiceNumber: formValues.invoiceNumber,
        invoiceDate: formValues.invoiceDate,
        amountCents,
        vendor: formValues.vendor || undefined,
        blobUrl: formValues.blobUrl,
        blobPathname: formValues.blobPathname,
      });

      if (!result.success) {
        dupStatus.error(result.error);
        return;
      }

      // Surface the budget-link caveat on the page-level status (the dialog is
      // closing in `finally`) rather than losing it on navigation.
      if (result.linkWarning) {
        status.set("info", result.linkWarning, { autoClearMs: 0 });
        return;
      }
      // Clean overwrite navigates to /invoices — navigation is the feedback.
      router.push("/invoices");
    } catch {
      dupStatus.error("Overwrite failed");
    } finally {
      setIsOverwriting(false);
      setDuplicateDialogOpen(false);
    }
  };

  // T010: Re-check on invoice number blur
  const handleInvoiceNumberBlur = () => {
    const currentInvoiceNumber = watch().invoiceNumber;
    if (currentInvoiceNumber) {
      runDuplicateCheck(currentInvoiceNumber);
    }
  };

  const onSubmit = async (data: CreateInvoiceInput) => {
    // T018: Convert dollars to cents before saving
    const amountCents = Math.round(parseFloat(amountDollars) * 100);
    const submitData = { ...data, amountCents };

    const result = await saveInvoice(submitData);
    if (!result.success) {
      status.error(result.error);
      return;
    }
    // Surface budget-link / filter caveats inline (the toast that used to carry
    // these was removed in the redesign) and stay on the page so the notice is
    // read instead of lost on navigation. A clean save navigates — navigation
    // is the feedback.
    const notice = result.linkWarning ?? result.filterWarning;
    if (notice) {
      status.set("info", notice, { autoClearMs: 0 });
      return;
    }
    router.push("/invoices");
  };

  const showForm = uploadState === "extracted" || uploadState === "error";

  return (
    <div className="space-y-6">
      {/* ARIA live region */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {ARIA_STATUS[uploadState]}
      </div>

      {/* File upload area */}
      <div className="space-y-2">
        <Label htmlFor="pdf-upload">PDF Invoice</Label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadState === "uploading" || uploadState === "extracting"}
          >
            {uploadState === "uploading" || uploadState === "extracting" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {uploadState === "uploading" ? "Uploading\u2026" : "Extracting\u2026"}
              </>
            ) : (
              <>
                <Upload className="mr-2 size-4" />
                Choose PDF
              </>
            )}
          </Button>
          <input
            id="pdf-upload"
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          {!showForm && <StatusText status={status.status} />}
        </div>
      </div>

      {/* Confirmation form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <input type="hidden" {...register("blobPathname")} />
          <input type="hidden" {...register("blobUrl")} />

          <ConfidenceInput
            id="invoiceNumber"
            label="Invoice Number"
            placeholder="e.g. INV-1042"
            registerProps={register("invoiceNumber")}
            confidence={confidence?.invoiceNumber}
            watchedValue={invoiceNumber}
            error={errors.invoiceNumber?.message}
            onBlur={handleInvoiceNumberBlur}
          />

          <ConfidenceInput
            id="invoiceDate"
            label="Invoice Date"
            placeholder="YYYY-MM-DD"
            registerProps={register("invoiceDate")}
            confidence={confidence?.invoiceDate}
            watchedValue={invoiceDate}
            error={errors.invoiceDate?.message}
          />

          {/* T017: Amount in dollars display */}
          <div className="space-y-1">
            <Label htmlFor="amountDollars">Amount ($)</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    id="amountDollars"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={amountDollars}
                    onChange={(e) => {
                      setAmountDollars(e.target.value);
                      // Keep the hidden amountCents in sync for validation
                      const cents = Math.round(parseFloat(e.target.value || "0") * 100);
                      setValue("amountCents", isNaN(cents) ? 0 : cents);
                    }}
                    className={cn(
                      isLowConfidence(
                        confidence?.amountCents,
                        amountDollars || undefined
                      )
                        ? "border-warning"
                        : ""
                    )}
                  />
                </TooltipTrigger>
                {isLowConfidence(
                  confidence?.amountCents,
                  amountDollars || undefined
                ) && <TooltipContent>Low confidence — please verify</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
            {errors.amountCents?.message && (
              <p className="text-sm text-destructive">{errors.amountCents.message}</p>
            )}
            {/* Hidden field to keep react-hook-form validation working */}
            <input type="hidden" {...register("amountCents", { valueAsNumber: true })} />
          </div>

          <ConfidenceInput
            id="vendor"
            label="Vendor"
            placeholder="e.g. Acme Corp"
            registerProps={register("vendor")}
            confidence={confidence?.vendor}
            watchedValue={vendor}
            error={errors.vendor?.message}
          />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting || !blobPathname || !!duplicateInfo?.isDuplicate}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save to Archive"
              )}
            </Button>
            <StatusText status={status.status} />
          </div>
        </form>
      )}

      {/* T007: Duplicate resolution dialog */}
      <AlertDialog open={duplicateDialogOpen} onOpenChange={(open) => { if (!open) return; setDuplicateDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate Invoice Detected</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  An invoice with this number already exists in the archive:
                </p>
                {duplicateInfo?.existingInvoice && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Number:</dt>
                    <dd>{duplicateInfo.existingInvoice.invoiceNumber}</dd>
                    <dt className="font-medium">Date:</dt>
                    <dd>{duplicateInfo.existingInvoice.invoiceDate}</dd>
                    <dt className="font-medium">Amount:</dt>
                    {/* T020: Display amount using formatCurrency */}
                    <dd>{formatCurrency(duplicateInfo.existingInvoice.amountCents)}</dd>
                    <dt className="font-medium">Vendor:</dt>
                    <dd>{duplicateInfo.existingInvoice.vendor ?? "—"}</dd>
                  </dl>
                )}
                <p>
                  Would you like to skip this upload or overwrite the existing invoice?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="items-center">
            <StatusText status={dupStatus.status} className="mr-auto" />
            <AlertDialogCancel onClick={handleSkipDuplicate} disabled={isOverwriting}>
              Skip (Cancel Upload)
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleOverwriteDuplicate}
              disabled={isOverwriting}
            >
              {isOverwriting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Overwriting…
                </>
              ) : (
                "Overwrite Existing"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
