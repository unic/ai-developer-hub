"use client";

import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

const toggleBtnClass =
  "inline-flex items-center gap-0.5 hover:bg-muted rounded px-0.5 -ml-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) {
    return <span className="text-muted-foreground italic">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-ink font-medium">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-foreground font-medium">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-muted-foreground">&quot;{value}&quot;</span>;
  }
  if (Array.isArray(value)) {
    return <JsonArray items={value} depth={depth} />;
  }
  if (typeof value === "object") {
    return <JsonObject data={value as Record<string, unknown>} depth={depth} />;
  }
  return <span>{String(value)}</span>;
}

function JsonArray({ items, depth }: { items: unknown[]; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  if (items.length === 0) {
    return <span className="text-muted-foreground">[]</span>;
  }

  if (!expanded) {
    return (
      <div className="inline">
        <button
          type="button"
          onClick={toggle}
          className={toggleBtnClass}
          aria-label={`Expand array (${items.length} items)`}
          aria-expanded={false}
        >
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
        <span className="text-muted-foreground">
          [{items.length} {items.length === 1 ? "item" : "items"}]
        </span>
      </div>
    );
  }

  return (
    <div className="inline">
      <button
        type="button"
        onClick={toggle}
        className={toggleBtnClass}
        aria-label={`Collapse array (${items.length} items)`}
        aria-expanded={true}
      >
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      {"["}
      <div className="pl-4 border-l border-border ml-1">
        {items.map((item, i) => (
          <div key={i}>
            <JsonValue value={item} depth={depth + 1} />
            {i < items.length - 1 && <span className="text-muted-foreground">,</span>}
          </div>
        ))}
      </div>
      {"]"}
    </div>
  );
}

function JsonObject({
  data,
  depth,
}: {
  data: Record<string, unknown>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);
  const keys = Object.keys(data);

  if (keys.length === 0) {
    return <span className="text-muted-foreground">{"{}"}</span>;
  }

  if (!expanded) {
    return (
      <div className="inline">
        <button
          type="button"
          onClick={toggle}
          className={toggleBtnClass}
          aria-label={`Expand object (${keys.length} keys)`}
          aria-expanded={false}
        >
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
        <span className="text-muted-foreground">
          {"{"}
          {keys.length} {keys.length === 1 ? "key" : "keys"}
          {"}"}
        </span>
      </div>
    );
  }

  return (
    <div className="inline">
      <button
        type="button"
        onClick={toggle}
        className={toggleBtnClass}
        aria-label={`Collapse object (${keys.length} keys)`}
        aria-expanded={true}
      >
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      {"{"}
      <div className="pl-4 border-l border-border ml-1">
        {keys.map((key, i) => (
          <div key={key}>
            <span className="text-foreground font-medium">&quot;{key}&quot;</span>
            <span className="text-muted-foreground">: </span>
            <JsonValue value={data[key]} depth={depth + 1} />
            {i < keys.length - 1 && <span className="text-muted-foreground">,</span>}
          </div>
        ))}
      </div>
      {"}"}
    </div>
  );
}

export function JsonViewer({ data }: { data: unknown }) {
  return (
    <div className="text-sm font-mono whitespace-pre overflow-auto rounded-md bg-muted/50 p-4">
      <JsonValue value={data} depth={0} />
    </div>
  );
}
