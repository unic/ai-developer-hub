import { getBudgetReportData } from "@/actions/reports";
import { BudgetReport } from "@/components/reports/budget/budget-report";

export default async function ReportsBudgetPage() {
  const data = await getBudgetReportData();
  return <BudgetReport data={data} />;
}
