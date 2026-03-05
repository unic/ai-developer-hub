"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createInvoiceSchema } from "@/lib/validators";
import type { CreateInvoiceInput, InvoiceExtractionResult } from "@/lib/validators";
import { extractInvoiceFieldsAction, saveInvoice } from "@/actions/invoices";
import { cn } from "@/lib/utils";

type UploadState =
  | "idle"
  | "uploading"
  | "extracting"
  | "extracted"
  | "error";

type ConfidenceLevel = "high" | "medium" | "low";

function isLowConfidence(
  confidence: ConfidenceLevel | undefined,
  value: string | null | undefined
): boolean {
  return confidence === "low" || value === null || value === undefined || value === "";
}

export function InvoiceUploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [ariaStatus, setAriaStatus] = useState("");
  const [extractionResult, setExtractionResult] =
    useState<InvoiceExtractionResult | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are accepted.");
      return;
    }

    setUploadState("uploading");
    setAriaStatus("Uploading PDF…");
    setExtractionResult(null);
    setDuplicateWarning(null);

    try {
      // Get presigned upload URL
      const urlRes = await fetch("/api/invoices/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "application/pdf" }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json();
        throw new Error(err.error ?? "Failed to get upload URL");
      }
      const { uploadUrl, objectKey, blobUrl } = await urlRes.json();

      // Upload directly to R2
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/pdf" },
      });
      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to storage");
      }

      setValue("blobPathname", objectKey);
      setValue("blobUrl", blobUrl);

      setUploadState("extracting");
      setAriaStatus("Extracting invoice fields…");

      // Extract fields via Server Action
      const result = await extractInvoiceFieldsAction({ objectKey });
      if (!result.success) {
        setUploadState("error");
        setAriaStatus("Extraction failed. Please enter fields manually.");
        toast.error(result.error);
        return;
      }

      const extracted = result.data;
      setExtractionResult(extracted);

      // Pre-fill form fields
      if (extracted.invoiceNumber) setValue("invoiceNumber", extracted.invoiceNumber);
      if (extracted.invoiceDate) setValue("invoiceDate", extracted.invoiceDate);
      if (extracted.amountCents) setValue("amountCents", extracted.amountCents);

      setUploadState("extracted");
      setAriaStatus("Extraction complete. Please review the form.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadState("error");
      setAriaStatus("Extraction failed. Please enter fields manually.");
      toast.error(message);
    }
  };

  const onSubmit = async (data: CreateInvoiceInput) => {
    setDuplicateWarning(null);
    const result = await saveInvoice(data);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.warning) {
      setDuplicateWarning(result.warning);
      return;
    }
    toast.success("Invoice saved to archive.");
    router.push("/invoices");
  };

  const showForm = uploadState === "extracted" || uploadState === "error";
  const confidence = extractionResult?.confidence;

  return (
    <div className="space-y-6">
      {/* ARIA live region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {ariaStatus}
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
                {uploadState === "uploading" ? "Uploading…" : "Extracting…"}
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
        </div>
      </div>

      {/* Confirmation form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <input type="hidden" {...register("blobPathname")} />
          <input type="hidden" {...register("blobUrl")} />

          {/* Invoice Number */}
          <div className="space-y-1">
            <Label htmlFor="invoiceNumber">Invoice Number</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    id="invoiceNumber"
                    {...register("invoiceNumber")}
                    className={cn(
                      isLowConfidence(confidence?.invoiceNumber, watch("invoiceNumber"))
                        ? "border-amber-400"
                        : ""
                    )}
                    placeholder="e.g. INV-1042"
                  />
                </TooltipTrigger>
                {isLowConfidence(confidence?.invoiceNumber, watch("invoiceNumber")) && (
                  <TooltipContent>Low confidence — please verify</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {errors.invoiceNumber && (
              <p className="text-sm text-destructive">{errors.invoiceNumber.message}</p>
            )}
          </div>

          {/* Invoice Date */}
          <div className="space-y-1">
            <Label htmlFor="invoiceDate">Invoice Date</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    id="invoiceDate"
                    {...register("invoiceDate")}
                    className={cn(
                      isLowConfidence(confidence?.invoiceDate, watch("invoiceDate"))
                        ? "border-amber-400"
                        : ""
                    )}
                    placeholder="YYYY-MM-DD"
                  />
                </TooltipTrigger>
                {isLowConfidence(confidence?.invoiceDate, watch("invoiceDate")) && (
                  <TooltipContent>Low confidence — please verify</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {errors.invoiceDate && (
              <p className="text-sm text-destructive">{errors.invoiceDate.message}</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label htmlFor="amountCents">Amount (cents)</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    id="amountCents"
                    type="number"
                    {...register("amountCents", { valueAsNumber: true })}
                    className={cn(
                      isLowConfidence(
                        confidence?.amountCents,
                        watch("amountCents")?.toString()
                      )
                        ? "border-amber-400"
                        : ""
                    )}
                    placeholder="e.g. 12500 for $125.00"
                  />
                </TooltipTrigger>
                {isLowConfidence(
                  confidence?.amountCents,
                  watch("amountCents")?.toString()
                ) && (
                  <TooltipContent>Low confidence — please verify</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {errors.amountCents && (
              <p className="text-sm text-destructive">{errors.amountCents.message}</p>
            )}
          </div>

          {/* Duplicate warning */}
          {duplicateWarning && (
            <Alert>
              <AlertDescription>
                {duplicateWarning} Saving will create a duplicate.
              </AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !watch("blobPathname")}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save to Archive"
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
