export interface TrendDataPoint {
  date: string;
  suggestions: number;
  acceptances: number;
  activeUsers: number;
  acceptanceRate: number;
}

export function isUsageTrendSparse(data: TrendDataPoint[]): boolean {
  if (data.length < 2) return true;
  return data.every(
    (d) => d.suggestions === 0 && d.acceptances === 0 && d.activeUsers === 0
  );
}
