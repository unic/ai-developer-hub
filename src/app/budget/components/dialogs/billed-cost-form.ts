export interface BilledCostFormState {
  amountDollars: string;
  invoiceDate: string;
  description: string;
  vendorReference: string;
}

export function makeEmptyBilledCostForm(): BilledCostFormState {
  return {
    amountDollars: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    description: "",
    vendorReference: "",
  };
}
