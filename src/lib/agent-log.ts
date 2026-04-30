export interface AgentRequestLog {
  pathname: string;
  method: string;
  status: number;
  userId?: string;
  reason?: string;
}

/**
 * Emits one structured JSON line per agent-authenticated request. Captured by
 * Vercel runtime logs. Edge-runtime safe — no DB, no fs.
 */
export function logAgentRequest(entry: AgentRequestLog): void {
  console.log(
    JSON.stringify({
      event: "agent_request",
      timestamp: new Date().toISOString(),
      ...entry,
    })
  );
}
