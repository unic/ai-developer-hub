"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  deleteCreditPurchase,
  linkCreditPurchaseInvoice,
  recordCreditPurchase,
  type CreditPurchaseOverview,
} from "@/actions/credits";
import { parseCreditAmountCents } from "@/lib/credits";
import { formatCurrency } from "@/lib/utils";

// Radix Select forbids `value=""`, so "no invoice" needs a sentinel.
const NO_INVOICE = "__none__";

export function todayLocal(): string {
  // en-CA formats as YYYY-MM-DD in the admin's own timezone.
  return new Date().toLocaleDateString("en-CA");
}

type CreditPurchasesProps = {
  toolId: number;
  overview: CreditPurchaseOverview;
  /** The opening balance's as-of date; purchases on or before it don't count. */
  openingAt: string | null;
};

/**
 * Spec 045 — record a prepaid credit top-up (cash paid for credits, never the
 * cost of the month it lands in) and list the ones already on file.
 */
export function CreditPurchases({
  toolId,
  overview,
  openingAt,
}: CreditPurchasesProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(todayLocal);
  const [invoiceId, setInvoiceId] = useState(NO_INVOICE);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const formStatus = useInlineStatus();
  const listStatus = useInlineStatus();
  const linkStatus = useInlineStatus();
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkInvoiceId, setLinkInvoiceId] = useState("");
  const linking = overview.purchases.find((p) => p.id === linkingId) ?? null;

  const amountCents = parseCreditAmountCents(amount);

  function reset() {
    setAmount("");
    setPurchasedAt(todayLocal());
    setInvoiceId(NO_INVOICE);
    setNote("");
  }

  function handleInvoiceChange(value: string) {
    setInvoiceId(value);
    // Prefill from the invoice, but only into empty fields — never overwrite
    // what the admin already typed.
    const invoice = overview.linkableInvoices.find(
      (i) => String(i.id) === value,
    );
    if (invoice && amount.trim() === "") {
      setAmount((invoice.amountCents / 100).toFixed(2));
    }
  }

  function handleSubmit() {
    if (amountCents === null) {
      formStatus.error("Enter a positive amount, e.g. 610.43");
      return;
    }
    startTransition(async () => {
      const result = await recordCreditPurchase({
        toolId,
        purchasedAt,
        amountCents,
        invoiceId: invoiceId === NO_INVOICE ? undefined : Number(invoiceId),
        note: note.trim() === "" ? undefined : note.trim(),
      });
      if (result.success) {
        setOpen(false);
        reset();
        listStatus.ok("Top-up recorded");
        router.refresh();
      } else {
        formStatus.error(result.error);
      }
    });
  }

  function handleLink() {
    if (linkingId === null || linkInvoiceId === "") return;
    startTransition(async () => {
      const result = await linkCreditPurchaseInvoice({
        id: linkingId,
        invoiceId: Number(linkInvoiceId),
      });
      if (result.success) {
        setLinkingId(null);
        listStatus.ok("Invoice linked");
        router.refresh();
      } else {
        linkStatus.error(result.error);
      }
    });
  }

  function handleDelete(id: number) {
    startTransition(async () => {
      const result = await deleteCreditPurchase(id);
      if (result.success) {
        listStatus.ok("Top-up deleted");
        router.refresh();
      } else {
        listStatus.error(result.error);
      }
    });
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Credit top-ups
        </p>
        <div className="flex items-center gap-2">
          <StatusText status={listStatus.status} />
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Record top-up
          </Button>
        </div>
      </div>

      {overview.purchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No top-ups recorded yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {overview.purchases.map((p) => {
            // Already inside the opening balance, so the derived figure
            // doesn't include it either way (C4).
            const coveredByOpening =
              openingAt !== null && p.purchasedAt <= openingAt;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="font-medium tabular-nums">
                    {formatCurrency(p.amountCents)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    on {p.purchasedAt}
                    {p.invoiceNumber && <> · invoice {p.invoiceNumber}</>}
                    {p.note && <> · {p.note}</>}
                  </span>
                  {coveredByOpening && (
                    <span className="block text-xs text-warning">
                      On or before the opening balance date ({openingAt}), so
                      treated as already included in it.
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.invoiceNumber === null &&
                    overview.linkableInvoices.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => {
                          setLinkInvoiceId("");
                          setLinkingId(p.id);
                        }}
                      >
                        Link invoice
                      </Button>
                    )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        aria-label={`Delete top-up of ${formatCurrency(p.amountCents)} on ${p.purchasedAt}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this top-up?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {coveredByOpening
                            ? `${formatCurrency(p.amountCents)} on ${p.purchasedAt} is on or before the opening balance date, so the derived balance already leaves it out — deleting it won't change the balance.`
                            : `${formatCurrency(p.amountCents)} on ${p.purchasedAt} will no longer count towards the credit balance.`}
                          {p.invoiceNumber &&
                            ` Invoice ${p.invoiceNumber} will count as period cost again.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(p.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={linkingId !== null}
        onOpenChange={(next) => {
          if (!next) setLinkingId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link invoice</DialogTitle>
            <DialogDescription>
              {linking &&
                `Attach the invoice for the ${formatCurrency(linking.amountCents)} top-up on ${linking.purchasedAt}. The invoice then stops counting as period cost; the credit balance is unchanged.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="link-invoice">Invoice</Label>
            <Select value={linkInvoiceId} onValueChange={setLinkInvoiceId}>
              <SelectTrigger id="link-invoice" className="w-full">
                <SelectValue placeholder="Pick an invoice" />
              </SelectTrigger>
              <SelectContent>
                {overview.linkableInvoices.map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>
                    {i.invoiceNumber} · {i.invoiceDate} ·{" "}
                    {formatCurrency(i.amountCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <StatusText status={linkStatus.status} className="sm:mr-auto" />
            <Button
              variant="outline"
              onClick={() => setLinkingId(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleLink}
              disabled={isPending || linkInvoiceId === ""}
            >
              {isPending ? "Saving…" : "Link invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record credit top-up</DialogTitle>
            <DialogDescription>
              Cash paid for prepaid credits. It adds to the credit balance and
              is never counted as the cost of the month it lands in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="credit-amount">
                  Amount ($) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="credit-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-date">
                  Purchase date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="credit-date"
                  type="date"
                  value={purchasedAt}
                  onChange={(e) => setPurchasedAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit-invoice">
                Invoice{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select value={invoiceId} onValueChange={handleInvoiceChange}>
                <SelectTrigger id="credit-invoice" className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INVOICE}>None</SelectItem>
                  {overview.linkableInvoices.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.invoiceNumber} · {i.invoiceDate} ·{" "}
                      {formatCurrency(i.amountCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Linking the top-up&apos;s invoice stops it counting as period
                cost. If the invoice hasn&apos;t arrived yet, record without one
                and use &ldquo;Link invoice&rdquo; on the top-up once it has.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit-note">
                Note <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="credit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. Console top-up"
              />
            </div>
          </div>

          <DialogFooter>
            <StatusText status={formStatus.status} className="sm:mr-auto" />
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || amountCents === null || !purchasedAt}
            >
              {isPending ? "Saving…" : "Record top-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
