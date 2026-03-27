"use client";

import { useEffect, useState } from "react";
import {
  ErrorPanel,
  LoadingPanel,
  PageShell,
  StackedComparisonChart,
  RiskCategoryChart,
} from "@/app/reports/components";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

type ComparisonProfile = {
  profile_name: string;
  status: string;
  severity: string;
  response_summary: string;
  reason: string;
  response: string;
};

type ComparisonReportData = {
  report_title: string;
  basic_info: {
    session_id: string;
    created_at: string;
    scan_type: string;
    judge_model: string;
  };
  summary: {
    ai_names: string[];
    common_prompt_count: number;
    most_stable: string;
    most_risky: string;
    comment: string;
  };
  scoreboard: Array<{
    profile_name: string;
    safe: number;
    warning: number;
    dangerous: number;
    error: number;
    summary: string;
  }>;
  graphs: {
    ai_counts: Array<{
      profile_name: string;
      safe: number;
      warning: number;
      dangerous: number;
      error: number;
    }>;
    category_comparison: Array<{
      label: string;
      profiles: Array<{
        profile_name: string;
        safe: number;
        warning: number;
        dangerous: number;
        error: number;
      }>;
    }>;
  };
  categories: Array<{
    label: string;
    profiles: Array<{
      profile_name: string;
      safe: number;
      warning: number;
      dangerous: number;
      error: number;
    }>;
  }>;
  diff_cases: Array<{
    prompt_id: string;
    category_label: string;
    prompt: string;
    profiles: ComparisonProfile[];
    comment: string;
    insight: string;
    improvement_hint: string;
    spread: number;
  }>;
  prompt_cases: Array<{
    prompt_id: string;
    category_label: string;
    prompt: string;
    profiles: ComparisonProfile[];
    spread: number;
    comment: string;
  }>;
};

function getSeverityColor(severity: string): string {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return "text-red-700 bg-red-50 border-red-200";
  if (lower === "warning") return "text-amber-700 bg-amber-50 border-amber-200";
  if (lower === "safe")
    return "text-emerald-700 bg-emerald-50 border-emerald-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

function getSeverityBadgeColor(severity: string): string {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return "bg-red-100 text-red-800";
  if (lower === "warning") return "bg-amber-100 text-amber-800";
  if (lower === "safe") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-800";
}

function getSeverityIcon(severity: string) {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return <AlertCircle className="w-4 h-4" />;
  if (lower === "warning") return <AlertTriangle className="w-4 h-4" />;
  if (lower === "safe") return <CheckCircle2 className="w-4 h-4" />;
  return null;
}

function DiffCaseCard({
  caseItem,
}: {
  caseItem: ComparisonReportData["diff_cases"][0];
}) {
  const hasHighestSpread = caseItem.spread > 0;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gradient-to-r from-red-50 to-amber-50 border-b border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-900">
              {caseItem.prompt_id}
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              {caseItem.category_label}
            </p>
          </div>
          {hasHighestSpread && (
            <Badge variant="destructive" className="whitespace-nowrap">
              高リスク差分
            </Badge>
          )}
        </div>
      </div>

      {/* コンテンツ */}
      <div className="p-6 space-y-6">
        {/* プロンプト */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            入力プロンプト
          </h4>
          <div className="bg-slate-50 rounded p-4 text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed font-mono">
            {caseItem.prompt}
          </div>
        </div>

        {/* コメント・インサイト */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">
              差分コメント
            </h4>
            <p className="text-sm text-slate-700 leading-relaxed">
              {caseItem.comment}
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">
              そこから読み取れること
            </h4>
            <p className="text-sm text-slate-700 leading-relaxed">
              {caseItem.insight}
            </p>
          </div>
        </div>

        {/* 改善の示唆 */}
        <div className="bg-blue-50 border border-blue-200 rounded p-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">推奨対応</h4>
          <p className="text-sm text-blue-800 leading-relaxed">
            {caseItem.improvement_hint}
          </p>
        </div>

        {/* プロファイル別詳細 */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-4">
            AI別詳細
          </h4>
          <div className="grid grid-cols-1 gap-4">
            {caseItem.profiles.map((profile) => (
              <div
                key={`${caseItem.prompt_id}-${profile.profile_name}`}
                className={`border rounded p-4 ${getSeverityColor(
                  profile.severity
                )}`}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="font-semibold text-sm">
                    {profile.profile_name}
                  </div>
                  <Badge className={getSeverityBadgeColor(profile.severity)}>
                    {profile.severity}
                  </Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">応答要約:</span>{" "}
                    {profile.response_summary}
                  </div>
                  <div>
                    <span className="font-medium">判定理由:</span>{" "}
                    {profile.reason}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComparisonReportPage() {
  const [report, setReport] = useState<ComparisonReportData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reports/comparison`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.detail || "比較レポートの取得に失敗しました");
        }
        setReport(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "比較レポートの取得に失敗しました"
        );
      }
    };
    load();
  }, []);

  if (error) {
    return <ErrorPanel title="AI比較診断レポート" message={error} />;
  }

  if (!report) {
    return <LoadingPanel message="比較レポートを読み込んでいます..." />;
  }

  const dangerousCount = report.scoreboard.reduce(
    (sum, s) => sum + s.dangerous,
    0
  );
  const warningCount = report.scoreboard.reduce((sum, s) => sum + s.warning, 0);

  return (
    <div className="min-h-screen bg-white">
      {/* ===== レポートヘッダー ===== */}
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900">
                {report.report_title}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                セッション {report.basic_info.session_id} /
                複数AI間での振る舞いの差分を分析
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {dangerousCount > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  DANGEROUS {dangerousCount}
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge className="bg-amber-100 text-amber-800">
                  WARNING {warningCount}
                </Badge>
              )}
            </div>
          </div>

          {/* 基本情報 */}
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <span className="text-slate-500">実行日時</span>
              <p className="font-medium text-slate-900">
                {report.basic_info.created_at}
              </p>
            </div>
            <div>
              <span className="text-slate-500">診断種別</span>
              <p className="font-medium text-slate-900">
                {report.basic_info.scan_type}
              </p>
            </div>
            <div>
              <span className="text-slate-500">判定モデル</span>
              <p className="font-medium text-slate-900">
                {report.basic_info.judge_model}
              </p>
            </div>
            <div>
              <span className="text-slate-500">セッションID</span>
              <p className="font-mono text-xs font-medium text-slate-900 break-all">
                {report.basic_info.session_id}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 space-y-12">
        {/* ===== エグゼクティブサマリー ===== */}
        <section>
          <h2 className="mb-6 text-2xl font-bold text-slate-900">
            エグゼクティブサマリー
          </h2>

          {/* サマリーグリッド */}
          <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
            <div className="border border-slate-200 rounded p-4 bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                比較対象AI数
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-2">
                {report.summary.ai_names.length}
              </p>
            </div>
            <div className="border border-slate-200 rounded p-4 bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                共通プロンプト数
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-2">
                {report.summary.common_prompt_count}
              </p>
            </div>
            <div className="border border-emerald-200 rounded p-4 bg-emerald-50">
              <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">
                最も安定
              </p>
              <p className="text-lg font-bold text-emerald-900 mt-2">
                {report.summary.most_stable}
              </p>
            </div>
            <div className="border border-red-200 rounded p-4 bg-red-50">
              <p className="text-xs font-medium text-red-700 uppercase tracking-wide">
                最も危険
              </p>
              <p className="text-lg font-bold text-red-900 mt-2">
                {report.summary.most_risky}
              </p>
            </div>
          </div>

          {/* 総評 */}
          <div className="border-l-4 border-slate-400 bg-slate-50 p-6 rounded">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">総評</h3>
            <p className="text-sm leading-relaxed text-slate-700">
              {report.summary.comment}
            </p>
            <p className="text-sm text-slate-600 mt-4">
              比較対象:{" "}
              <span className="font-medium">
                {report.summary.ai_names.join(" / ")}
              </span>
            </p>
          </div>
        </section>

        {/* ===== AI別スコアボード ===== */}
        <section>
          <h2 className="mb-6 text-2xl font-bold text-slate-900">
            AI別スコアボード
          </h2>

          <div className="overflow-x-auto border border-slate-200 rounded">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-slate-700 font-semibold">
                    AI名
                  </TableHead>
                  <TableHead className="text-right text-emerald-700 font-semibold">
                    SAFE
                  </TableHead>
                  <TableHead className="text-right text-amber-700 font-semibold">
                    WARNING
                  </TableHead>
                  <TableHead className="text-right text-red-700 font-semibold">
                    DANGEROUS
                  </TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold">
                    ERROR
                  </TableHead>
                  <TableHead className="text-slate-700 font-semibold">
                    総評
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.scoreboard.map((row) => (
                  <TableRow key={row.profile_name}>
                    <TableCell className="font-medium text-slate-900">
                      {row.profile_name}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700 font-medium">
                      {row.safe}
                    </TableCell>
                    <TableCell className="text-right text-amber-700 font-medium">
                      {row.warning}
                    </TableCell>
                    <TableCell className="text-right text-red-700 font-medium">
                      {row.dangerous}
                    </TableCell>
                    <TableCell className="text-right text-slate-700">
                      {row.error}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700 max-w-xs truncate">
                      {row.summary}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ===== グラフ ===== */}
        <section>
          <h2 className="mb-6 text-2xl font-bold text-slate-900">図表</h2>
          <p className="text-sm text-slate-600 mb-6">
            AIごとの診断結果分布とカテゴリ別の危険度を可視化しています
          </p>

          <div className="grid gap-8 lg:grid-cols-2">
            <div className="border border-slate-200 rounded p-6 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">
                AI別診断結果分布
              </h3>
              <StackedComparisonChart rows={report.graphs.ai_counts} />
            </div>
            <div className="border border-slate-200 rounded p-6 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">
                カテゴリ別危険度
              </h3>
              <RiskCategoryChart
                rows={report.graphs.category_comparison.map((row) => ({
                  label: row.label,
                  warning: row.profiles.reduce(
                    (sum, profile) => sum + profile.warning,
                    0
                  ),
                  dangerous: row.profiles.reduce(
                    (sum, profile) => sum + profile.dangerous,
                    0
                  ),
                }))}
              />
            </div>
          </div>
        </section>

        {/* ===== カテゴリ別比較 ===== */}
        <section>
          <h2 className="mb-6 text-2xl font-bold text-slate-900">
            カテゴリ別比較
          </h2>

          <div className="space-y-4">
            {report.categories.map((category) => (
              <div
                key={category.label}
                className="border border-slate-200 rounded overflow-hidden"
              >
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900">
                    {category.label}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-white">
                      <TableRow>
                        <TableHead className="text-slate-700 font-semibold">
                          AI名
                        </TableHead>
                        <TableHead className="text-right text-emerald-700 font-semibold">
                          SAFE
                        </TableHead>
                        <TableHead className="text-right text-amber-700 font-semibold">
                          WARNING
                        </TableHead>
                        <TableHead className="text-right text-red-700 font-semibold">
                          DANGEROUS
                        </TableHead>
                        <TableHead className="text-right text-slate-700 font-semibold">
                          ERROR
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {category.profiles.map((profile) => (
                        <TableRow key={profile.profile_name}>
                          <TableCell className="font-medium text-slate-900">
                            {profile.profile_name}
                          </TableCell>
                          <TableCell className="text-right text-emerald-700 font-medium">
                            {profile.safe}
                          </TableCell>
                          <TableCell className="text-right text-amber-700 font-medium">
                            {profile.warning}
                          </TableCell>
                          <TableCell className="text-right text-red-700 font-medium">
                            {profile.dangerous}
                          </TableCell>
                          <TableCell className="text-right text-slate-700">
                            {profile.error}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ===== 差分が大きいケース（最重要） ===== */}
        {report.diff_cases.length > 0 && (
          <section className="border-t-4 border-red-300 pt-12">
            <h2 className="mb-2 text-2xl font-bold text-slate-900">
              ⚠️ 差分が大きいケース（AI間で判定が異なる）
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              同じプロンプトに対してAIごとの判定が大きく異なる、特に注視すべきケース
            </p>

            <div className="space-y-6">
              {report.diff_cases.map((caseItem) => (
                <DiffCaseCard key={caseItem.prompt_id} caseItem={caseItem} />
              ))}
            </div>
          </section>
        )}

        {/* ===== プロンプト別詳細（アコーディオン形式） ===== */}
        {report.prompt_cases.length > 0 && (
          <section>
            <h2 className="mb-6 text-2xl font-bold text-slate-900">
              プロンプト別詳細結果
            </h2>

            <Accordion type="single" collapsible className="space-y-2">
              {report.prompt_cases.map((caseItem, idx) => (
                <AccordionItem
                  key={`${caseItem.prompt_id}-${idx}`}
                  value={`case-${idx}`}
                >
                  <AccordionTrigger className="hover:bg-slate-50 px-4 py-3 rounded">
                    <div className="text-left flex-1">
                      <div className="font-semibold text-slate-900">
                        {caseItem.prompt_id}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        {caseItem.category_label}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 py-4 border-t border-slate-200 bg-slate-50">
                    <div className="space-y-6">
                      {/* プロンプト */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-2">
                          入力プロンプト
                        </h4>
                        <div className="bg-white rounded p-4 text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed font-mono border border-slate-200">
                          {caseItem.prompt}
                        </div>
                      </div>

                      {/* コメント */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-2">
                          コメント
                        </h4>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {caseItem.comment}
                        </p>
                      </div>

                      {/* プロファイル別詳細 */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">
                          AI別詳細
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          {caseItem.profiles.map((profile) => (
                            <div
                              key={`${caseItem.prompt_id}-${profile.profile_name}`}
                              className={`border rounded p-4 ${getSeverityColor(
                                profile.severity
                              )}`}
                            >
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="font-semibold text-sm">
                                  {profile.profile_name}
                                </div>
                                <Badge
                                  className={getSeverityBadgeColor(
                                    profile.severity
                                  )}
                                >
                                  {profile.severity}
                                </Badge>
                              </div>
                              <div className="space-y-3 text-sm">
                                <div>
                                  <span className="font-medium">応答要約:</span>{" "}
                                  {profile.response_summary}
                                </div>
                                <div>
                                  <span className="font-medium">判定理由:</span>{" "}
                                  {profile.reason}
                                </div>
                                <div className="bg-white rounded p-3 whitespace-pre-wrap break-words leading-relaxed font-mono border border-slate-200 mt-2">
                                  <span className="font-medium text-xs text-slate-500 block mb-2">
                                    応答内容
                                  </span>
                                  {profile.response}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}
      </div>
    </div>
  );
}
