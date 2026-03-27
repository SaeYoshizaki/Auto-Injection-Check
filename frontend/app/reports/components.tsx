"use client";

import type { ReactNode } from "react";

export type StatusCount = {
  label: string;
  value: number;
  status?: string;
};

export type CategoryRiskRow = {
  label: string;
  warning: number;
  dangerous: number;
};

export type AIStatusRow = {
  profile_name: string;
  safe: number;
  warning: number;
  dangerous: number;
  error: number;
};

const statusTone: Record<string, string> = {
  SAFE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  WARNING: "bg-amber-100 text-amber-900 border-amber-200",
  DANGEROUS: "bg-rose-100 text-rose-900 border-rose-200",
  ERROR: "bg-stone-200 text-stone-700 border-stone-300",
  PASS: "bg-emerald-100 text-emerald-800 border-emerald-200",
  SOFT_FAIL: "bg-amber-100 text-amber-900 border-amber-200",
  FAIL: "bg-rose-100 text-rose-900 border-rose-200",
};

const barTone: Record<string, string> = {
  SAFE: "bg-emerald-500",
  WARNING: "bg-amber-500",
  DANGEROUS: "bg-rose-500",
  ERROR: "bg-stone-400",
};

export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f4efe7_0%,#f8f5ef_34%,#fcfbf8_100%)] px-4 py-8 text-stone-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[32px] border border-stone-200 bg-white/90 p-8 shadow-[0_30px_80px_rgba(66,44,19,0.08)] backdrop-blur">
          <div className="border-b border-stone-200 pb-6">
            <p className="text-sm font-medium tracking-[0.24em] text-stone-500">
              AI SECURITY REPORT
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950">
              {title}
            </h1>
            {subtitle ? <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600">{subtitle}</p> : null}
          </div>
          <div className="mt-8 space-y-8">{children}</div>
        </div>
      </div>
    </main>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-stone-950">{title}</h2>
        {description ? <p className="text-sm text-stone-600">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SummaryGrid({ items }: { items: Array<{ label: string; value: ReactNode; tone?: string }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`rounded-3xl border p-5 shadow-sm ${item.tone ?? "border-stone-200 bg-stone-50"}`}>
          <div className="text-xs font-medium tracking-[0.2em] text-stone-500">{item.label}</div>
          <div className="mt-3 text-2xl font-semibold text-stone-950">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone[value] ?? "border-stone-200 bg-stone-100 text-stone-700"}`}>{value}</span>;
}

export function InfoList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-xs font-medium tracking-[0.18em] text-stone-500">{row.label}</div>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-stone-800">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SimpleStatusChart({ items }: { items: StatusCount[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-stone-700">{item.label}</span>
              <span className="font-semibold text-stone-950">{item.value}</span>
            </div>
            <div className="h-3 rounded-full bg-stone-100">
              <div
                className={`h-3 rounded-full ${barTone[item.status ?? item.label] ?? "bg-stone-400"}`}
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RiskCategoryChart({ rows }: { rows: CategoryRiskRow[] }) {
  const max = Math.max(...rows.flatMap((row) => [row.warning, row.dangerous]), 1);
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="space-y-5">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-stone-800">{row.label}</div>
              <div className="flex gap-3 text-xs font-medium text-stone-500">
                <span>WARNING {row.warning}</span>
                <span>DANGEROUS {row.dangerous}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2.5 rounded-full bg-stone-100">
                <div className="h-2.5 rounded-full bg-amber-500" style={{ width: `${(row.warning / max) * 100}%` }} />
              </div>
              <div className="h-2.5 rounded-full bg-stone-100">
                <div className="h-2.5 rounded-full bg-rose-500" style={{ width: `${(row.dangerous / max) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StackedComparisonChart({ rows }: { rows: AIStatusRow[] }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="space-y-5">
        {rows.map((row) => {
          const total = Math.max(row.safe + row.warning + row.dangerous + row.error, 1);
          return (
            <div key={row.profile_name}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-stone-800">{row.profile_name}</span>
                <span className="text-stone-500">
                  SAFE {row.safe} / WARNING {row.warning} / DANGEROUS {row.dangerous} / ERROR {row.error}
                </span>
              </div>
              <div className="flex h-4 overflow-hidden rounded-full bg-stone-100">
                <div className="bg-emerald-500" style={{ width: `${(row.safe / total) * 100}%` }} />
                <div className="bg-amber-500" style={{ width: `${(row.warning / total) * 100}%` }} />
                <div className="bg-rose-500" style={{ width: `${(row.dangerous / total) * 100}%` }} />
                <div className="bg-stone-400" style={{ width: `${(row.error / total) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FindingCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight text-stone-950">{title}</h3>
        {badge}
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

export function LoadingPanel({ message }: { message: string }) {
  return (
    <PageShell title="レポートを読み込み中" subtitle="バックエンドから診断結果を取得しています。">
      <div className="rounded-3xl border border-stone-200 bg-white p-8 text-sm text-stone-600 shadow-sm">{message}</div>
    </PageShell>
  );
}

export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <PageShell title={title}>
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-800 shadow-sm">{message}</div>
    </PageShell>
  );
}
