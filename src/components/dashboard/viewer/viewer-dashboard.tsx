import { getViewerDashboardData } from "@/actions/dashboard";
import { IdentityCard } from "./identity-card";
import { MyUsageCard } from "./my-usage-card";
import { PersonalKpis } from "./personal-kpis";
import { MyToolsTable } from "./my-tools-table";
import { PersonalActivity } from "./personal-activity";
import { CatalogLinkCard } from "./catalog-link-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export async function ViewerDashboard({ userId }: { userId: number }) {
  if (!Number.isFinite(userId) || userId <= 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Unable to load your dashboard. Please sign in again.
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = await getViewerDashboardData(userId);

  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Unable to load your dashboard data.
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasApiKey = data.tools.some((t) => t.isAnthropic && t.hasApiKey);
  const hasAssignments = data.tools.length > 0;
  const activeTools = data.tools.filter((t) => t.status === "active");
  const activeToolCount = new Set(activeTools.map((t) => t.id)).size;
  const activeLicenseCount = activeTools.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            My workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
            Hi {data.profile.name?.split(" ")[0] || "there"} —
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s on your account this month.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/profile">View profile</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IdentityCard
          profile={data.profile}
          toolCount={activeToolCount}
          activeLicenseCount={activeLicenseCount}
          sync={data.sync}
          hasApiKey={hasApiKey}
        />
        <div className="lg:col-span-2">
          {hasApiKey ? (
            <MyUsageCard
              cost={data.cost}
              modelTotals={data.modelTotals}
              totalInputTokens={data.totalInputTokens}
              totalOutputTokens={data.totalOutputTokens}
              cacheReadTokens={data.cacheReadTokens}
              uncachedInputTokens={data.uncachedInputTokens}
              cacheSavingsCents={data.cacheSavingsCents}
            />
          ) : (
            <NoApiKeyHero />
          )}
        </div>
      </div>

      <PersonalKpis
        cost={data.cost}
        modelTotals={data.modelTotals}
        totalInputTokens={data.totalInputTokens}
        totalOutputTokens={data.totalOutputTokens}
        toolCount={activeToolCount}
        toolNames={activeTools.slice(0, 4).map((t) => t.toolName)}
        hasApiKey={hasApiKey}
      />

      {hasAssignments ? (
        <MyToolsTable tools={data.tools} />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            You don&apos;t have any tools assigned yet. Browse the{" "}
            <Link href="/tools" className="underline">
              tool catalog
            </Link>{" "}
            and ask your lead for access.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PersonalActivity activity={data.activity} />
        </div>
        <CatalogLinkCard availableToolCount={data.availableToolCount} />
      </div>
    </div>
  );
}

function NoApiKeyHero() {
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-base font-semibold">Claude API not configured</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have a Claude API key assigned to you. Once your admin
          configures one, your usage and costs will appear here.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href="/profile">Open profile →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
