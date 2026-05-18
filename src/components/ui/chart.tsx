"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"
import { formatChartValue, type ChartNumberFormat } from "@/lib/chart-format"

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme || config.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

type TooltipPayloadItem = {
  value?: number | string
  name?: string
  dataKey?: string | number
  color?: string
  payload?: Record<string, unknown> & { fill?: string }
  type?: string
}

type ValueFormatter = (
  value: number | string,
  item: TooltipPayloadItem,
) => React.ReactNode

type SecondaryFormatter = (
  value: number | string,
  item: TooltipPayloadItem,
  total: number,
) => React.ReactNode

type FooterRow = {
  label: React.ReactNode
  value: React.ReactNode
}

type LegacyFormatter = (
  v: unknown,
  n: unknown,
  it: unknown,
  i: number,
  p: unknown,
) => React.ReactNode

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  valueFormatter,
  numberFormat,
  showTotal,
  totalLabel = "Total",
  secondaryFormatter,
  sort,
  footer,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<"div"> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: "line" | "dot" | "dashed"
    nameKey?: string
    labelKey?: string
    /** Format a value while keeping the color swatch + name row layout. */
    valueFormatter?: ValueFormatter
    /** Built-in numeric format preset. Used when valueFormatter isn't provided. */
    numberFormat?: ChartNumberFormat
    /** Show stack total as the first row. */
    showTotal?: boolean
    /** Label for the total row. Default "Total". */
    totalLabel?: React.ReactNode
    /** Secondary line under each row (e.g. "28% of total"). */
    secondaryFormatter?: SecondaryFormatter
    /** Sort rows in the tooltip. Default: keep payload order. */
    sort?: "desc" | "asc" | "none"
    /** Footer row appended after series rows (e.g. "Budget cap $1,500"). */
    footer?: FooterRow | null
  }) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null
    }

    const [item] = payload
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    const value =
      !labelKey && typeof label === "string"
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      )
    }

    if (!value) {
      return null
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>
  }, [
    label,
    labelFormatter,
    payload,
    hideLabel,
    labelClassName,
    config,
    labelKey,
  ])

  if (!active || !payload?.length) {
    return null
  }

  const visiblePayload = (payload as TooltipPayloadItem[]).filter(
    (item) => item.type !== "none",
  )

  const needsTotal = showTotal || Boolean(secondaryFormatter)
  const numericTotal = needsTotal
    ? visiblePayload.reduce((acc, item) => {
        const n =
          typeof item.value === "number" ? item.value : Number(item.value)
        return Number.isFinite(n) ? acc + n : acc
      }, 0)
    : 0

  const sortedPayload =
    sort && sort !== "none"
      ? [...visiblePayload].sort((a, b) => {
          const av = Number(a.value)
          const bv = Number(b.value)
          const aFinite = Number.isFinite(av)
          const bFinite = Number.isFinite(bv)
          if (!aFinite && !bFinite) return 0
          if (!aFinite) return 1
          if (!bFinite) return -1
          return sort === "desc" ? bv - av : av - bv
        })
      : visiblePayload

  const renderValue = (item: TooltipPayloadItem): React.ReactNode => {
    const v = item.value
    if (v === undefined || v === null) return "—"
    if (valueFormatter) return valueFormatter(v, item)
    if (numberFormat) return formatChartValue(v, numberFormat)
    return typeof v === "number" ? v.toLocaleString() : String(v)
  }

  const totalNode: React.ReactNode = valueFormatter
    ? valueFormatter(numericTotal, {
        value: numericTotal,
        name: typeof totalLabel === "string" ? totalLabel : "total",
        dataKey: "total",
      })
    : numberFormat
      ? formatChartValue(numericTotal, numberFormat)
      : numericTotal.toLocaleString()

  const nestLabel = sortedPayload.length === 1 && indicator !== "dot"
  const usingNewRow = Boolean(
    valueFormatter || numberFormat || showTotal || secondaryFormatter || footer,
  )

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}

      {showTotal && (
        <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
          <span className="text-muted-foreground">{totalLabel}</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {totalNode}
          </span>
        </div>
      )}

      <div className="grid gap-1.5">
        {sortedPayload.map((item, index) => {
          const key = `${nameKey || item.name || item.dataKey || "value"}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)
          const indicatorColor = color || item.payload?.fill || item.color
          const seriesLabel = itemConfig?.label ?? item.name

          // Back-compat path: legacy `formatter` prop replaces the whole row.
          // Only honored when no new-shape props were passed.
          if (formatter && !usingNewRow && item?.value !== undefined && item.name) {
            return (
              <div
                key={item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center"
                )}
              >
                {(formatter as unknown as LegacyFormatter)(
                  item.value,
                  item.name,
                  item,
                  index,
                  item.payload,
                )}
              </div>
            )
          }

          return (
            <div
              key={item.dataKey}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                indicator === "dot" && "items-center"
              )}
            >
              {itemConfig?.icon ? (
                <itemConfig.icon />
              ) : (
                !hideIndicator && (
                  <div
                    className={cn(
                      "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                      {
                        "h-2.5 w-2.5": indicator === "dot",
                        "w-1": indicator === "line",
                        "w-0 border-[1.5px] border-dashed bg-transparent":
                          indicator === "dashed",
                        "my-0.5": nestLabel && indicator === "dashed",
                      }
                    )}
                    style={
                      {
                        "--color-bg": indicatorColor,
                        "--color-border": indicatorColor,
                      } as React.CSSProperties
                    }
                  />
                )
              )}
              <div
                className={cn(
                  "flex flex-1 justify-between leading-none",
                  nestLabel ? "items-end" : "items-center"
                )}
              >
                <div className="grid gap-1.5">
                  {nestLabel ? tooltipLabel : null}
                  <span className="text-muted-foreground">{seriesLabel}</span>
                </div>
                {item.value !== undefined && item.value !== null && (() => {
                  const secondary = secondaryFormatter
                    ? secondaryFormatter(item.value, item, numericTotal)
                    : null
                  return (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {renderValue(item)}
                      </span>
                      {secondary != null && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {secondary}
                        </span>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )
        })}
      </div>

      {footer && (
        <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">{footer.label}</span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {footer.value}
          </span>
        </div>
      )}
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> &
  Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
    hideIcon?: boolean
    nameKey?: string
  }) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => {
          const key = `${nameKey || item.dataKey || "value"}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              key={item.value}
              className={cn(
                "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          )
        })}
    </div>
  )
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}
