import { formatDateOnly } from "@/lib/utils";

export interface BilledCostFormState {
  amountDollars: string;
  invoiceDate: string;
  description: string;
  vendorReference: string;
}

export function makeEmptyBilledCostForm(): BilledCostFormState {
  return {
    amountDollars: "",
    invoiceDate: formatDateOnly(new Date()),
    description: "",
    vendorReference: "",
  };
}
