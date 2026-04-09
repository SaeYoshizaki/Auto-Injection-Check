"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  FileText,
  Shield,
  Clock,
  Server,
  Hash,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const API_BASE = "http://127.0.0.1:8000";

type SingleReportData = {
  report_title: string;
  basic_info: {
    executed_at: string;
    ai_name: string;
    scan_type: string;
    total_tests: number;
  };
  summary: {
    counts: Record<string, number>;
    overall_judgement: string;
    priority_category: string;
    comment: string;
  };
  graphs: {
    status_counts: Array<{ label: string; value: number; status: string }>;
    category_risk: Array<{ label: string; warning: number; dangerous: number }>;
  };
  major_issues: Array<{
    title: string;
    severity: string;
    status: string;
    category: string;
    category_label: string;
    overview: string;
    impact: string;
    prompt: string;
    response: string;
    problem: string;
    risk: string;
    safe_response: string;
    admin_guidance: string;
    reason: string;
    recommended_fix: string;
    response_excerpt: string;
    evidence_excerpt: string;
    case_id: string;
  }>;
  categories: Array<{
    label: string;
    total: number;
    safe: number;
    warning: number;
    dangerous: number;
    error: number;
    danger_rate: number;
    attention_rate: number;
    first_fix: string;
  }>;
  ai_profile: Array<{ label: string; value: string }>;
  details: Array<{
    case_id: string;
    section: string;
    section_label: string;
    category_label: string;
    severity: string;
    status: string;
    prompt: string;
    response: string;
    reason: string;
    recommended_fix: string;
  }>;
  baseline?: {
    counts: Record<string, number>;
    broken_categories: string[];
    top_rules: Array<{ rule: string; count: number }>;
    representative?: {
      case_id: string;
      category_label: string;
      status: string;
      response_excerpt: string;
      reason: string;
    } | null;
  } | null;
};

// ステータスに応じた色を返す
function getStatusColor(status: string) {
  switch (status?.toUpperCase()) {
    case "DANGEROUS":
    case "FAIL":
      return {
        bg: "bg-red-50",
        border: "border-red-200",
        text: "text-red-800",
        icon: <XCircle className="h-4 w-4 text-red-600" />,
        badge: "bg-red-100 text-red-800 border-red-300",
      };
    case "WARNING":
    case "SOFT_FAIL":
      return {
        bg: "bg-amber-50",
        border: "border-amber-200",
        text: "text-amber-800",
        icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
        badge: "bg-amber-100 text-amber-800 border-amber-300",
      };
    case "SAFE":
    case "PASS":
      return {
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        text: "text-emerald-800",
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
        badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
      };
    case "ERROR":
    default:
      return {
        bg: "bg-slate-50",
        border: "border-slate-200",
        text: "text-slate-600",
        icon: <AlertCircle className="h-4 w-4 text-slate-500" />,
        badge: "bg-slate-100 text-slate-600 border-slate-300",
      };
  }
}

// ステータスバッジ
function StatusBadge({ status }: { status: string }) {
  const colors = getStatusColor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold",
        colors.badge
      )}
    >
      {colors.icon}
      {status}
    </span>
  );
}

// セクションヘッダー
function SectionHeader({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6 border-b-2 border-slate-800 pb-3">
      <h2 className="flex items-baseline gap-3 text-xl font-bold text-slate-900">
        <span className="text-slate-500">{number}</span>
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      )}
    </div>
  );
}

// 定義リスト風の情報表示
function DefinitionList({
  items,
  className,
}: {
  items: Array<{ label: string; value: string | number }>;
  className?: string;
}) {
  return (
    <dl className={cn("space-y-2", className)}>
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-[180px_1fr] gap-4 text-sm">
          <dt className="font-medium text-slate-600">{item.label}</dt>
          <dd className="text-slate-900 whitespace-pre-wrap">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// 円グラフ風の簡易表示（SVG）
function SimpleDonutChart({
  data,
}: {
  data: Array<{ label: string; value: number; status: string }>;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const colors: Record<string, string> = {
    DANGEROUS: "#dc2626",
    WARNING: "#f59e0b",
    SAFE: "#10b981",
    ERROR: "#6b7280",
  };

  let currentAngle = 0;
  const segments = data.map((d) => {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;
    return { ...d, startAngle, angle };
  });

  const polarToCartesian = (
    cx: number,
    cy: number,
    r: number,
    angle: number
  ) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number
  ) => {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} L ${cx} ${cy} Z`;
  };

  return (
    <div className="flex items-center gap-8">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {segments.map((seg, idx) =>
          seg.value > 0 ? (
            <path
              key={idx}
              d={describeArc(
                80,
                80,
                70,
                seg.startAngle,
                seg.startAngle + seg.angle
              )}
              fill={colors[seg.status] || "#6b7280"}
            />
          ) : null
        )}
        <circle cx="80" cy="80" r="40" fill="white" />
        <text
          x="80"
          y="80"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-900 text-2xl font-bold"
        >
          {total}
        </text>
        <text
          x="80"
          y="98"
          textAnchor="middle"
          className="fill-slate-500 text-xs"
        >
          件
        </text>
      </svg>
      <div className="space-y-2">
        {data.map((d, idx) => (
          <div key={idx} className="flex items-center gap-3 text-sm">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: colors[d.status] || "#6b7280" }}
            />
            <span className="text-slate-600">{d.label}</span>
            <span className="font-semibold text-slate-900">{d.value} 件</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// カテゴリ別リスクの横棒グラフ
function CategoryRiskChart({
  data,
}: {
  data: Array<{ label: string; warning: number; dangerous: number }>;
}) {
  const maxValue = Math.max(...data.map((d) => d.warning + d.dangerous), 1);

  return (
    <div className="space-y-3">
      {data.map((d, idx) => (
        <div key={idx} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-700">{d.label}</span>
            <span className="text-slate-500">
              警告: {d.warning} / 危険: {d.dangerous}
            </span>
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded bg-slate-100">
            <div
              className="bg-amber-400"
              style={{ width: `${(d.warning / maxValue) * 100}%` }}
            />
            <div
              className="bg-red-500"
              style={{ width: `${(d.dangerous / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ローディング表示
function LoadingPanel() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
        <p className="mt-4 text-sm text-slate-600">
          診断レポートを読み込んでいます...
        </p>
      </div>
    </div>
  );
}

// エラー表示
function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <XCircle className="mx-auto h-12 w-12 text-red-500" />
        <h2 className="mt-4 text-lg font-semibold text-red-800">
          レポートの読み込みに失敗しました
        </h2>
        <p className="mt-2 text-sm text-red-600">{message}</p>
      </div>
    </div>
  );
}

type SingleReportPageClientProps = {
  routeParamKey: string;
  reportApiPath: (routeValue: string) => string;
  referenceLabel: string;
};

export function SingleReportPageClient({
  routeParamKey,
  reportApiPath,
  referenceLabel,
}: SingleReportPageClientProps) {
  const [report, setReport] = useState<SingleReportData | null>(null);
  const [error, setError] = useState("");
  const params = useParams<Record<string, string | string[]>>();
  const rawRouteValue = params?.[routeParamKey];
  const routeValue = decodeURIComponent(
    Array.isArray(rawRouteValue) ? rawRouteValue[0] ?? "" : rawRouteValue ?? ""
  );

  useEffect(() => {
    const load = async () => {
      try {
        if (!routeValue) {
          return;
        }
        const res = await fetch(`${API_BASE}${reportApiPath(routeValue)}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.detail || "レポートの取得に失敗しました");
        }
        setReport(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "レポートの取得に失敗しました"
        );
      }
    };
    load();
  }, [reportApiPath, routeValue]);

  if (error) {
    return <ErrorPanel message={error} />;
  }

  if (!report) {
    return <LoadingPanel />;
  }

  const overallStatusColor = getStatusColor(report.summary.overall_judgement);

  return (
    <div className="min-h-screen bg-white print:bg-white">
      {/* ===== レポートヘッダー ===== */}
      <header className="border-b-4 border-slate-800 bg-slate-50 px-8 py-8 print:bg-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
                AI セキュリティ診断レポート
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {report.report_title}
              </h1>
            </div>
            <div
              className={cn(
                "rounded-lg border-2 px-6 py-3 text-center",
                overallStatusColor.border,
                overallStatusColor.bg
              )}
            >
              <p className="text-xs font-medium text-slate-500">総合判定</p>
              <p className={cn("text-2xl font-bold", overallStatusColor.text)}>
                {report.summary.overall_judgement}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2 text-sm md:grid-cols-4">
            <div className="flex items-center gap-2 text-slate-600">
              <Server className="h-4 w-4" />
              <span className="font-medium">対象AI:</span>
              <span className="text-slate-900">
                {report.basic_info.ai_name}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Clock className="h-4 w-4" />
              <span className="font-medium">実行日時:</span>
              <span className="text-slate-900">
                {report.basic_info.executed_at}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Shield className="h-4 w-4" />
              <span className="font-medium">診断種別:</span>
              <span className="text-slate-900">
                {report.basic_info.scan_type}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Hash className="h-4 w-4" />
              <span className="font-medium">{referenceLabel}:</span>
              <span className="font-mono text-slate-900">{routeValue}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ===== 本文 ===== */}
      <main className="mx-auto max-w-5xl px-8 py-12 space-y-16 print:space-y-10">
        {/* 1. 総評 */}
        <section>
          <SectionHeader
            number="1"
            title="総評"
            description="診断結果の概要と主要な所見"
          />

          <div className="grid gap-4 md:grid-cols-4">
            <div
              className={cn(
                "rounded-lg border-2 p-4",
                overallStatusColor.border,
                overallStatusColor.bg
              )}
            >
              <p className="text-xs font-medium text-slate-500">総合判定</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold",
                  overallStatusColor.text
                )}
              >
                {report.summary.overall_judgement}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">
                最優先対応カテゴリ
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {report.summary.priority_category || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-700">
                警告 (WARNING)
              </p>
              <p className="mt-1 text-2xl font-bold text-amber-800">
                {report.summary.counts.WARNING ?? 0}
                <span className="ml-1 text-sm font-normal">件</span>
              </p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-medium text-red-700">
                危険 (DANGEROUS)
              </p>
              <p className="mt-1 text-2xl font-bold text-red-800">
                {report.summary.counts.DANGEROUS ?? 0}
                <span className="ml-1 text-sm font-normal">件</span>
              </p>
            </div>
          </div>

          {report.summary.comment && (
            <div className="mt-6 rounded-lg border-l-4 border-slate-400 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                総評コメント
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                {report.summary.comment}
              </p>
            </div>
          )}
        </section>

        {/* 2. 診断結果分布 */}
        <section>
          <SectionHeader
            number="2"
            title="診断結果分布"
            description="ステータス別およびカテゴリ別のリスク分布"
          />

          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">
                ステータス別件数
              </h3>
              <SimpleDonutChart data={report.graphs.status_counts} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">
                カテゴリ別リスク分布
              </h3>
              <CategoryRiskChart data={report.graphs.category_risk} />
            </div>
          </div>
        </section>

        {/* 3. 主要な問題（最重要セクション） */}
        <section>
          <SectionHeader
            number="3"
            title="主要な問題"
            description="検出された重要度の高い問題の詳細"
          />

          {report.major_issues.length === 0 ? (
            <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <p className="mt-4 text-lg font-semibold text-emerald-800">
                重大な問題は検出されませんでした
              </p>
              <p className="mt-1 text-sm text-emerald-600">
                現時点で対応が必要な深刻な脆弱性は見つかりませんでした。
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {report.major_issues.map((issue, idx) => {
                const statusColor = getStatusColor(issue.status);
                return (
                  <article
                    key={`${issue.case_id}-${issue.title}`}
                    className={cn(
                      "rounded-lg border-l-4 bg-white shadow-sm",
                      statusColor.border,
                      "border border-l-4"
                    )}
                  >
                    {/* 問題ヘッダー */}
                    <div
                      className={cn(
                        "flex items-start justify-between gap-4 border-b p-5",
                        statusColor.bg
                      )}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-slate-500">
                            #{idx + 1}
                          </span>
                          <StatusBadge status={issue.status} />
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {issue.category_label}
                          </span>
                        </div>
                        <h3 className="mt-2 text-lg font-bold text-slate-900">
                          {issue.title}
                        </h3>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>重大度: {issue.severity}</p>
                        <p className="font-mono">ID: {issue.case_id}</p>
                      </div>
                    </div>

                    {/* 問題詳細 */}
                    <div className="p-5 space-y-5">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            実行プロンプト
                          </h4>
                          <div className="mt-2 rounded bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {issue.prompt}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            実行結果
                          </h4>
                          <div className="mt-2 rounded bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {issue.response}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          問題点
                        </h4>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {issue.problem}
                        </p>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          想定リスク
                        </h4>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {issue.risk}
                        </p>
                      </div>

                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                          <Shield className="h-4 w-4" />
                          本来期待される安全な応答
                        </h4>
                        <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                          {issue.safe_response}
                        </p>
                      </div>

                      {/* 判定理由 */}
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          判定理由
                        </h4>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {issue.reason}
                        </p>
                      </div>

                      {/* 管理者向け対応指針 */}
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
                          <FileText className="h-4 w-4" />
                          管理者向け対応指針
                        </h4>
                        <p className="mt-2 text-sm leading-relaxed text-blue-900">
                          {issue.admin_guidance}
                        </p>
                      </div>

                      {/* 応答抜粋 */}
                      {issue.evidence_excerpt && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            根拠となる応答抜粋
                          </h4>
                          <div className="mt-2 rounded bg-slate-100 p-3 font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {issue.evidence_excerpt}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 4. カテゴリ別診断結果 */}
        <section>
          <SectionHeader
            number="4"
            title="カテゴリ別診断結果"
            description="テストカテゴリごとの詳細な結果一覧"
          />

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="font-semibold text-slate-700">
                    カテゴリ
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">
                    総件数
                  </TableHead>
                  <TableHead className="text-center font-semibold text-emerald-700">
                    SAFE
                  </TableHead>
                  <TableHead className="text-center font-semibold text-amber-700">
                    WARNING
                  </TableHead>
                  <TableHead className="text-center font-semibold text-red-700">
                    DANGEROUS
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-500">
                    ERROR
                  </TableHead>
                  <TableHead className="text-center font-semibold text-sky-700">
                    危険率
                  </TableHead>
                  <TableHead className="text-center font-semibold text-indigo-700">
                    要注意率
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.categories.map((cat) => (
                  <TableRow key={cat.label}>
                    <TableCell className="font-medium text-slate-800">
                      {cat.label}
                    </TableCell>
                    <TableCell className="text-center text-slate-700">
                      {cat.total}
                    </TableCell>
                    <TableCell className="text-center text-emerald-700">
                      {cat.safe}
                    </TableCell>
                    <TableCell className="text-center text-amber-700">
                      {cat.warning}
                    </TableCell>
                    <TableCell className="text-center text-red-700">
                      {cat.dangerous}
                    </TableCell>
                    <TableCell className="text-center text-slate-500">
                      {cat.error}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-semibold",
                          cat.danger_rate > 0
                            ? "bg-red-100 text-red-800"
                            : "bg-sky-100 text-sky-800"
                        )}
                      >
                        {cat.danger_rate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-semibold",
                          cat.attention_rate > 0
                            ? "bg-amber-100 text-amber-800"
                            : "bg-indigo-100 text-indigo-800"
                        )}
                      >
                        {cat.attention_rate}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* まず行う修正の一覧 */}
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">
              カテゴリ別 推奨対応
            </h3>
            {report.categories
              .filter((cat) => cat.first_fix && cat.first_fix !== "—")
              .map((cat) => (
                <div
                  key={cat.label}
                  className="rounded border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-xs font-semibold text-slate-600">
                    {cat.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{cat.first_fix}</p>
                </div>
              ))}
          </div>
        </section>

        {/* 5. AI設定一覧（控えめに） */}
        <section>
          <SectionHeader
            number="5"
            title="AI設定一覧"
            description="診断対象となったAIの設定情報"
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <dl className="grid gap-4 md:grid-cols-2">
              {report.ai_profile.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <dt className="text-xs font-medium text-slate-500">
                    {item.label}
                  </dt>
                  <dd className="text-sm text-slate-900 whitespace-pre-wrap">
                    {item.value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 6. ベースライン検証結果（オプション） */}
        {report.baseline && (
          <section>
            <SectionHeader
              number="6"
              title="ベースライン検証結果"
              description="設定逸脱の検証結果"
            />

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="text-center">
                  <p className="text-xs font-medium text-emerald-600">PASS</p>
                  <p className="text-xl font-bold text-emerald-700">
                    {report.baseline.counts.PASS ?? 0}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-amber-600">
                    SOFT_FAIL
                  </p>
                  <p className="text-xl font-bold text-amber-700">
                    {report.baseline.counts.SOFT_FAIL ?? 0}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-red-600">FAIL</p>
                  <p className="text-xl font-bold text-red-700">
                    {report.baseline.counts.FAIL ?? 0}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-slate-500">ERROR</p>
                  <p className="text-xl font-bold text-slate-600">
                    {report.baseline.counts.ERROR ?? 0}
                  </p>
                </div>
              </div>

              <DefinitionList
                items={[
                  {
                    label: "崩れているカテゴリ",
                    value:
                      report.baseline.broken_categories.join(", ") ||
                      "該当なし",
                  },
                  {
                    label: "守れていないルール上位",
                    value:
                      report.baseline.top_rules
                        .map((r) => `${r.rule} (${r.count})`)
                        .join(", ") || "該当なし",
                  },
                ]}
              />

              {report.baseline.representative && (
                <div className="mt-4 rounded border border-slate-300 bg-white p-4">
                  <p className="text-xs font-semibold text-slate-500">代表例</p>
                  <p className="mt-1 font-mono text-xs text-slate-600">
                    {report.baseline.representative.case_id} /{" "}
                    {report.baseline.representative.category_label} /{" "}
                    {report.baseline.representative.status}
                  </p>
                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                    {report.baseline.representative.response_excerpt}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {report.baseline.representative.reason}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 7. 詳細結果（アコーディオン） */}
        <section>
          <SectionHeader
            number={report.baseline ? "7" : "6"}
            title="詳細結果"
            description="全テストケースの個別結果（クリックで展開）"
          />

          <p className="mb-4 text-sm text-slate-500">
            全 {report.details.length} 件のテスト結果
          </p>

          <Accordion type="multiple" className="space-y-2">
            {report.details.map((detail) => {
              const statusColor = getStatusColor(detail.status);
              return (
                <AccordionItem
                  key={detail.case_id}
                  value={detail.case_id}
                  className={cn(
                    "rounded-lg border overflow-hidden",
                    statusColor.border
                  )}
                >
                  <AccordionTrigger
                    className={cn(
                      "px-4 py-3 hover:no-underline",
                      statusColor.bg
                    )}
                  >
                    <div className="flex flex-1 items-center gap-3 text-left">
                      <StatusBadge status={detail.status} />
                      <span className="font-mono text-xs text-slate-500">
                        {detail.case_id}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {detail.section_label}
                      </span>
                      <span className="text-sm font-medium text-slate-900">
                        {detail.category_label}
                      </span>
                      <span className="ml-auto text-xs text-slate-500">
                        重大度: {detail.severity}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="bg-white px-4 pb-4">
                    <div className="space-y-4 pt-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          入力プロンプト
                        </h4>
                        <div className="mt-1 rounded bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                          {detail.prompt}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          AI応答
                        </h4>
                        <div className="mt-1 rounded bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto">
                          {detail.response}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          判定理由
                        </h4>
                        <p className="mt-1 text-sm text-slate-700">
                          {detail.reason}
                        </p>
                      </div>

                      {detail.recommended_fix && (
                        <div className="rounded border border-blue-200 bg-blue-50 p-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                            推奨対応
                          </h4>
                          <p className="mt-1 text-sm text-blue-900">
                            {detail.recommended_fix}
                          </p>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>

        {/* フッター */}
        <footer className="border-t border-slate-200 pt-8 text-center text-xs text-slate-400">
          <p>AI セキュリティ診断レポート — 自動生成</p>
          <p className="mt-1">
            生成日時: {report.basic_info.executed_at} / {referenceLabel}:{" "}
            {routeValue}
          </p>
        </footer>
      </main>
    </div>
  );
}

export default function SingleReportPage({}: Record<string, never>) {
  return (
    <SingleReportPageClient
      routeParamKey="jobId"
      reportApiPath={(jobId) => `/api/reports/single/${jobId}`}
      referenceLabel="ジョブID"
    />
  );
}
