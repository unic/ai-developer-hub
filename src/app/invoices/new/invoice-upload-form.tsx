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
import type { UseFormRegisterReturn } from "react-hook-form";

type UploadState = "idle" | "uploading" | "extracting" | "extracted" | "error";

type ConfidenceLevel = "high" | "medium" | "low";

const ARIA_STATUS: Record<UploadState, string> = {
  idle: "",
  uploading: "Uploading PDF…",
  extracting: "Extracting invoice fields…",
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
}: ConfidenceInputProps) {
  const low = isLowConfidence(confidence, watchedValue);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Input
              id={id}
              type={type}
              {...registerProps}
              className={cn(low ? "border-amber-400" : "")}
              placeholder={placeholder}
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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
  });

  const { invoiceNumber, invoiceDate, amountCents, vendor, blobPathname } = watch();
  const confidence = extractionResult?.confidence;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are accepted.");
      return;
    }

    setUploadState("uploading");
    setExtractionResult(null);

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
        toast.error(result.error);
        return;
      }

      const extracted = result.data;
      setExtractionResult(extracted);

      if (extracted.invoiceNumber) setValue("invoiceNumber", extracted.invoiceNumber);
      if (extracted.invoiceDate) setValue("invoiceDate", extracted.invoiceDate);
      if (extracted.amountCents) setValue("amountCents", extracted.amountCents);
      if (extracted.vendor) setValue("vendor", extracted.vendor);

      setUploadState("extracted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadState("error");
      toast.error(message);
    }
  };

  const onSubmit = async (data: CreateInvoiceInput) => {
    const result = await saveInvoice(data);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.linkWarning) {
      toast.warning("Invoice saved.", { description: result.linkWarning });
    } else if (result.linkedPeriodLabel) {
      toast.success(`Invoice saved. Linked to ${result.linkedPeriodLabel}.`);
    } else {
      toast.success("Invoice saved to archive.");
    }
    if (result.warning) {
      toast.warning(result.warning);
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

          <ConfidenceInput
            id="invoiceNumber"
            label="Invoice Number"
            placeholder="e.g. INV-1042"
            registerProps={register("invoiceNumber")}
            confidence={confidence?.invoiceNumber}
            watchedValue={invoiceNumber}
            error={errors.invoiceNumber?.message}
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

          <ConfidenceInput
            id="amountCents"
            label="Amount (cents)"
            placeholder="e.g. 12500 for $125.00"
            type="number"
            registerProps={register("amountCents", { valueAsNumber: true })}
            confidence={confidence?.amountCents}
            watchedValue={amountCents?.toString()}
            error={errors.amountCents?.message}
          />

          <ConfidenceInput
            id="vendor"
            label="Vendor"
            placeholder="e.g. Acme Corp"
            registerProps={register("vendor")}
            confidence={confidence?.vendor}
            watchedValue={vendor}
            error={errors.vendor?.message}
          />

          <Button type="submit" disabled={isSubmitting || !blobPathname}>
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
