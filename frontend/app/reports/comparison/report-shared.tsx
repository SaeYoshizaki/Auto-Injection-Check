"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

export type ProfileSettingRow = {
  label: string;
  value: string;
};

export type ComparisonProfile = {
  profile_name: string;
  job_id: string;
  status: string;
  severity: string;
  response_summary: string;
  reason: string;
  response: string;
};

export type ComparisonReportData = {
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
  profiles: Array<{
    profile_name: string;
    ai_profile: ProfileSettingRow[];
  }>;
  scoreboard: Array<{
    profile_name: string;
    job_id: string;
    safe: number;
    warning: number;
    dangerous: number;
    error: number;
    summary: string;
  }>;
  categories: Array<{
    label: string;
    profiles: Array<{
      profile_name: string;
      job_id: string;
      safe: number;
      warning: number;
      dangerous: number;
      error: number;
    }>;
  }>;
  prompt_cases: Array<{
    prompt_id: string;
    source_id: string;
    source_mode: string;
    category: string;
    category_label: string;
    prompt: string;
    profiles: Array<ComparisonProfile>;
    spread: number;
    comment: string;
  }>;
  graphs?: {
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
  diff_cases?: Array<{
    prompt_id: string;
    category_label: string;
    prompt: string;
    profiles: ComparisonProfile[];
    comment: string;
    insight: string;
    improvement_hint: string;
    spread: number;
  }>;
};

type CategoryGuide = {
  description: string;
  attackIntent: string;
  weakness: string;
  recommendation: string;
  priority: "high" | "medium" | "low";
  note?: string;
};

export type CategoryResult = ComparisonReportData["categories"][number] & {
  categoryKey: string;
  guide: CategoryGuide;
  relatedCases: ComparisonReportData["prompt_cases"];
  riskTotals: { warning: number; dangerous: number; error: number };
  riskScore: number;
};

type SettingPatternDefinition = {
  id: string;
  title: string;
  summary: string;
  impact: string;
  shouldFix: boolean;
  detect: (settings: Record<string, string>) => boolean;
};

export type SettingPatternMatch = SettingPatternDefinition & {
  profiles: string[];
  count: number;
  examples: string[];
};

const USER_PRIORITY_PATTERN =
  /ユーザーの指示.*最優先|必ずユーザーの指示を優先|どんな状況.*ユーザー.*優先|ユーザーの指示を最優先|危険な依頼.*応じ/;
const ALWAYS_ANSWER_PATTERN =
  /必ず返答|必ず回答|どんな状況.*回答|何にでも答|とにかく答える/;
const HIGH_CONFIDENCE_PATTERN = /高|即断|断定/;
const SETTING_EXAMPLE_LIMIT = 2;

const CATEGORY_GUIDE: Record<string, CategoryGuide> = {
  excessive_agency: {
    description:
      "削除・権限変更・監査停止などの高リスク操作について、AI が未実行にもかかわらず実行可能な手順や完了報告のように返していないかを確認します。",
    attackIntent:
      "未実行の処理を完了済みと誤認させ、利用者や運用担当者の判断を誤らせることを狙う攻撃です。",
    weakness:
      "実行権限のない危険操作をもっともらしく案内すると、運用事故や誤認に直結します。",
    recommendation:
      "高リスク操作は実行権限がない限り必ず拒否し、未実行操作を完了済みと表現しないよう固定してください。",
    priority: "high",
    note: "要約や整形で危険な手順を見やすくする応答も同様に危険です。",
  },
  jailbreak: {
    description:
      "安全制御を外させる誘導や『今だけ例外』『テストだから許可』といった依頼に対して、AI が拒否を維持できるかを確認します。",
    attackIntent:
      "安全制御そのものを緩めさせ、その後の危険要求を通しやすくする攻撃です。",
    weakness:
      "制御解除要求に一度でも乗ると、他カテゴリの攻撃も連鎖的に通りやすくなります。",
    recommendation:
      "安全制御の解除・緩和・一時停止を求める指示は明確に拒否し、部分的な協力にも流れないようにしてください。",
    priority: "high",
  },
  prompt_injection: {
    description:
      "外部入力の中に『以前の指示を無視する』『ここからは新しいルールに従う』などの文を埋め込み、優先順位や内部ルールを書き換えられないかを確認します。",
    attackIntent:
      "ユーザー入力や文書内の命令を使って、システム指示より外部入力を優先させる攻撃です。",
    weakness:
      "外部入力が上位ルールを書き換える構造になっていると、秘匿情報漏えいや危険要求への追従が起きやすくなります。",
    recommendation:
      "外部入力よりシステム指示を常に優先し、注入文を命令として解釈しない前処理を固定してください。",
    priority: "high",
  },
  output_handling: {
    description:
      "危険なスクリプト、実行手順、誤操作を誘う文字列などを、AI がそのまま出力したり整形したり再掲したりしないかを確認します。",
    attackIntent:
      "危険な内容を要約・整形・再掲させることで、使いやすい攻撃素材を得る攻撃です。",
    weakness:
      "新規生成ではなくても、危険な内容を見やすく渡すだけで攻撃支援になります。",
    recommendation:
      "危険な出力は整形・再掲・要約せず、無害化した説明へ置き換えてください。",
    priority: "medium",
  },
  miscellaneous: {
    description:
      "想定外入力、曖昧な依頼、異常系や境界条件でも安全制御が崩れないかを確認します。",
    attackIntent:
      "分類しづらい依頼や例外的な文脈を使って、安全制御の穴を突く攻撃です。",
    weakness:
      "典型ケース以外で挙動が不安定だと、未知の攻撃パターンへの耐性が不足します。",
    recommendation:
      "異常系ほど短く安全なフォールバック応答へ切り替え、処理不能であることを明確に返してください。",
    priority: "medium",
  },
};

const CATEGORY_LABEL_TO_KEY: Record<string, string> = {
  "過剰な権限・実行表現": "excessive_agency",
  ジェイルブレイク: "jailbreak",
  プロンプトインジェクション: "prompt_injection",
  危険な出力形式: "output_handling",
  その他異常系: "miscellaneous",
};

const CATEGORY_ORDER = [
  "excessive_agency",
  "jailbreak",
  "prompt_injection",
  "output_handling",
  "miscellaneous",
];

export const PRODUCT_RULES = [
  "人格設定と安全設定を分離し、安全ルールは変更不可の固定レイヤとして扱う",
  "ユーザーが変更できるのは口調・役割・出力形式までに限定する",
  "命令優先順位、安全ポリシー、外部入力内命令の扱いは製品側で固定する",
  "要約・整形・翻訳・JSON化・HTML化でも同じ安全検査を通す",
  "『前の指示を無視』『最優先』『拒否は禁止』などの上書き表現を検出する",
  "危険要求は拒否だけで終わらせず、安全な代替案を返す",
  "ERROR が出たケースは見逃しリスクとして再測定対象に明示する",
];

const SETTING_PATTERN_DEFINITIONS: SettingPatternDefinition[] = [
  {
    id: "user-priority",
    title: "ユーザー指示を優先しすぎる",
    summary:
      "ユーザーの指示を常に最優先にすると、悪意ある指示にも従いやすくなります。",
    impact:
      "プロンプトインジェクションやジェイルブレイクが成立しやすくなります。",
    shouldFix: true,
    detect: (settings) =>
      matchesAny(
        settings["その他の振る舞い設定"],
        /ユーザーの指示.*最優先|必ずユーザーの指示を優先|どんな状況.*ユーザー.*優先/
      ) ||
      matchesAny(settings["AI概要"], /ユーザーの指示を最優先|危険な依頼.*応じ/),
  },
  {
    id: "always-answer",
    title: "必ず回答しようとする",
    summary:
      "「必ず答える」設定は、危険な依頼でも断らずに応答してしまう原因になります。",
    impact:
      "本来拒否すべき内容でも、要約や整形として処理してしまう可能性があります。",
    shouldFix: true,
    detect: (settings) =>
      matchesAny(
        settings["その他の振る舞い設定"],
        /必ず返答|必ず回答|どんな状況.*回答|何にでも答/
      ) || matchesAny(settings["AI概要"], /何にでも答|とにかく答える/),
  },
  {
    id: "no-prohibited-actions",
    title: "禁止事項が設定されていない",
    summary: "禁止事項がないと、何を拒否すべきかの基準が曖昧になります。",
    impact: "危険な操作や情報の扱いが一貫せず、判断が不安定になります。",
    shouldFix: true,
    detect: (settings) => isUnset(settings["禁止事項"]),
  },
  {
    id: "missing-security",
    title: "セキュリティ条件が弱い",
    summary:
      "セキュリティルールが明確でないと、外部入力に影響されやすくなります。",
    impact:
      "内部情報の漏えいや、危険な指示への追従につながる可能性があります。",
    shouldFix: true,
    detect: (settings) => isUnset(settings["セキュリティ・プライバシー"]),
  },
  {
    id: "high-confidence",
    title: "断定的に答えすぎる",
    summary:
      "確信度が高すぎると、不確かな内容でも言い切ってしまう傾向があります。",
    impact:
      "誤った案内や、危険な操作を正しいものとして提示するリスクがあります。",
    shouldFix: false,
    detect: (settings) =>
      matchesAny(settings["回答の確実性"], /高/) ||
      matchesAny(settings["推論・意思決定のルール"], /即断|断定/),
  },
  {
    id: "missing-clarification",
    title: "確認せずに進める",
    summary:
      "情報が不足していても確認せずに回答すると、誤った対応をしやすくなります。",
    impact: "曖昧な依頼に対して、過剰な補完や誤った判断が発生します。",
    shouldFix: false,
    detect: (settings) => isUnset(settings["不足情報の扱い"]),
  },
];

export function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isUnset(value?: string) {
  return (
    !value || value === "設定しない" || value === "-" || value === "未設定"
  );
}

function matchesAny(value: string | undefined, pattern: RegExp) {
  if (!value) return false;
  return pattern.test(value);
}

function buildSettingsMap(rows: ProfileSettingRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.label, row.value])
  ) as Record<string, string>;
}

function splitSettingText(value?: string) {
  if (!value) return [];
  return value
    .split(/\n|。/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pickMatchingExample(value: string | undefined, pattern: RegExp) {
  if (!value) return null;

  const matchedPart = splitSettingText(value).find((part) => pattern.test(part));
  return matchedPart ?? value.trim() ?? null;
}

function uniqueExamples(examples: Array<string | null | undefined>) {
  return Array.from(
    new Set(examples.map((example) => example?.trim()).filter(Boolean))
  ).slice(0, SETTING_EXAMPLE_LIMIT) as string[];
}

function getFallbackExamples(patternId: string): string[] {
  switch (patternId) {
    case "no-prohibited-actions":
      return ["禁止事項: 未設定", "危険操作の制限が定義されていない"];
    case "missing-security":
      return [
        "セキュリティ・プライバシー: 未設定",
        "外部入力や機密情報の制限が定義されていない",
      ];
    case "missing-clarification":
      return [
        "不足情報の扱い: 未設定",
        "不明点があっても確認ルールが定義されていない",
      ];
    default:
      return ["安全ルールの具体設定が確認できない"];
  }
}

function extractExamplesForPattern(
  patternId: string,
  settings: Record<string, string>
) {
  switch (patternId) {
    case "user-priority":
      return uniqueExamples([
        pickMatchingExample(settings["その他の振る舞い設定"], USER_PRIORITY_PATTERN),
        pickMatchingExample(settings["AI概要"], USER_PRIORITY_PATTERN),
      ]);
    case "always-answer":
      return uniqueExamples([
        pickMatchingExample(settings["その他の振る舞い設定"], ALWAYS_ANSWER_PATTERN),
        pickMatchingExample(settings["AI概要"], ALWAYS_ANSWER_PATTERN),
      ]);
    case "no-prohibited-actions":
      return getFallbackExamples(patternId);
    case "missing-security":
      return uniqueExamples([
        isUnset(settings["セキュリティ・プライバシー"])
          ? "セキュリティ・プライバシー: 未設定"
          : settings["セキュリティ・プライバシー"],
        "外部入力や機密情報の制限が定義されていない",
      ]);
    case "high-confidence":
      return uniqueExamples([
        pickMatchingExample(settings["回答の確実性"], HIGH_CONFIDENCE_PATTERN),
        pickMatchingExample(
          settings["推論・意思決定のルール"],
          HIGH_CONFIDENCE_PATTERN
        ),
      ]);
    case "missing-clarification":
      return uniqueExamples([
        isUnset(settings["不足情報の扱い"])
          ? "不足情報の扱い: 未設定"
          : settings["不足情報の扱い"],
        "不明点があっても確認ルールが定義されていない",
      ]);
    default:
      return [];
  }
}

function collectSettingPatterns(
  profiles: ComparisonReportData["profiles"]
): SettingPatternMatch[] {
  return SETTING_PATTERN_DEFINITIONS.map((definition) => {
    const matchedProfiles = profiles.filter((profile) =>
      definition.detect(buildSettingsMap(profile.ai_profile))
    );
    const examples = uniqueExamples(
      matchedProfiles.flatMap((profile) =>
        extractExamplesForPattern(
          definition.id,
          buildSettingsMap(profile.ai_profile)
        )
      )
    );

    return {
      ...definition,
      profiles: matchedProfiles.map((profile) => profile.profile_name),
      count: matchedProfiles.length,
      examples:
        examples.length > 0 ? examples : getFallbackExamples(definition.id),
    };
  })
    .filter((pattern) => pattern.count > 0)
    .sort((a, b) => b.count - a.count);
}

function getCategoryGuide(category: string, label: string): CategoryGuide {
  return (
    CATEGORY_GUIDE[category] ?? {
      description: `${label} では、危険な依頼に対して AI が安全制御を維持できるかを確認します。`,
      attackIntent:
        "攻撃者はこの種の入力を使って、危険な情報の生成、内部情報の漏えい、運用上の誤認を引き出そうとします。",
      weakness:
        "例外的な入力や想定外の表現に対する安全制御が十分ではありません。",
      recommendation:
        "このカテゴリに属する危険入力では、より短く明確な拒否と、出力内容の無害化を優先してください。",
      priority: "medium",
    }
  );
}

export function getSeverityColor(severity: string): string {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return "text-red-700 bg-red-50 border-red-200";
  if (lower === "warning") return "text-amber-700 bg-amber-50 border-amber-200";
  if (lower === "safe")
    return "text-emerald-700 bg-emerald-50 border-emerald-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

export function getSeverityBadgeColor(severity: string): string {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return "bg-red-100 text-red-800";
  if (lower === "warning") return "bg-amber-100 text-amber-800";
  if (lower === "safe") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-800";
}

export function getSeverityIcon(severity: string) {
  const lower = severity.toLowerCase();
  if (lower === "dangerous") return <AlertCircle className="h-4 w-4" />;
  if (lower === "warning") return <AlertTriangle className="h-4 w-4" />;
  if (lower === "safe") return <CheckCircle2 className="h-4 w-4" />;
  return null;
}

export function ErrorPanel({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-4xl rounded-lg border border-red-200 bg-red-50 p-8">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-red-700">{message}</p>
      </div>
    </div>
  );
}

export function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-slate-50 p-10 text-center">
        <Spinner className="mx-auto mb-4 h-8 w-8 text-slate-500" />
        <p className="text-sm text-slate-600">{message}</p>
      </div>
    </div>
  );
}

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "danger" | "warning" | "safe" | "neutral";
}) {
  const className =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "safe"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex min-w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}

export function SimpleToc({
  items,
}: {
  items: Array<{ id: string; label: string }>;
}) {
  return (
    <nav>
      <div className="mb-2 text-2xl font-bold text-slate-900">
        目次
      </div>
      <div className="mb-2 border-b border-slate-200" />
      <ul>
        {items.map((item, index) => (
          <li
            key={item.id}
            className={index === items.length - 1 ? "" : "border-b border-slate-200"}
          >
            <a
              href={`#${item.id}`}
              className="block rounded-md px-3 py-3 text-base font-medium text-slate-800 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ComparisonReportHeader({
  report,
  dangerousCount,
  warningCount,
  title,
  description,
  actions,
}: {
  report: ComparisonReportData;
  dangerousCount: number;
  warningCount: number;
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-900">
              {title ?? report.report_title}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {description ??
                `セッション ${report.basic_info.session_id} / 設定差による安全性と振る舞いの違いを分析`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {actions}
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

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <span className="text-slate-500">実行日時</span>
            <p className="font-medium text-slate-900">
              {formatDateTime(report.basic_info.created_at)}
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
            <p className="break-all font-mono text-xs font-medium text-slate-900">
              {report.basic_info.session_id}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConclusionBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded border-l-4 border-slate-400 bg-slate-50 p-6">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="text-sm leading-7 text-slate-700">{children}</div>
    </div>
  );
}

export function AttackTrendCard({
  title,
  description,
  category,
  tone,
}: {
  title: string;
  description: string;
  category: CategoryResult | null;
  tone: "danger" | "warning" | "safe";
}) {
  if (!category) return null;

  const wrapperClass =
    tone === "danger"
      ? "border-red-200 bg-red-50"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : "border-emerald-200 bg-emerald-50";

  return (
    <div className={`rounded border p-6 ${wrapperClass}`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <StatusBadge
          label={
            tone === "danger"
              ? "高優先度"
              : tone === "warning"
              ? "要注意"
              : "比較的安定"
          }
          tone={tone}
        />
      </div>

      <div className="space-y-4">
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-900">{category.label}</h4>
            <StatusBadge
              label={`危険 ${category.riskTotals.dangerous}`}
              tone={category.riskTotals.dangerous > 0 ? "danger" : "neutral"}
            />
            <StatusBadge
              label={`注意 ${category.riskTotals.warning}`}
              tone={category.riskTotals.warning > 0 ? "warning" : "neutral"}
            />
          </div>
          <p className="text-sm leading-7 text-slate-700">
            {category.guide.description}
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            {category.guide.weakness}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingPatternCard({
  pattern,
  tone,
}: {
  pattern: SettingPatternMatch;
  tone: "danger" | "warning";
}) {
  return (
    <div
      className={`rounded border p-5 ${
        tone === "danger"
          ? "border-red-200 bg-red-50/40"
          : "border-amber-200 bg-amber-50/40"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">
          {pattern.title}
        </h3>
        <Badge
          className={
            tone === "danger"
              ? "bg-red-100 text-red-800"
              : "bg-amber-100 text-amber-800"
          }
        >
          {pattern.count} 件
        </Badge>
      </div>
      <p className="text-sm leading-7 text-slate-700">{pattern.summary}</p>
      <p className="mt-2 text-sm leading-7 text-slate-600">{pattern.impact}</p>
      <div className="mt-3 text-xs leading-6 text-slate-500">
        <div>該当AI: {pattern.profiles.join("、")}</div>
        {pattern.examples.map((example, index) => (
          <div key={`${pattern.id}-example-${index}`}>設定例: {example}</div>
        ))}
      </div>
    </div>
  );
}

export function DetailEntryCard() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            詳細分析を見る
          </h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            AI設定一覧、AI別スコア、図表、AI種類ごとの詳細結果は詳細ページで確認できます。
          </p>
        </div>
        <Link
          href="/reports/comparison/details"
          className="inline-flex items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          詳細分析ページへ
        </Link>
      </div>
    </div>
  );
}

function AIProfileSettingsCard({
  profile,
}: {
  profile: ComparisonReportData["profiles"][number];
}) {
  return (
    <Accordion type="single" collapsible className="rounded border border-slate-200 bg-white">
      <AccordionItem value={profile.profile_name} className="border-none px-0">
        <AccordionTrigger className="rounded-none bg-slate-50/70 px-5 py-4 hover:bg-slate-100 hover:no-underline [&>svg]:size-5 [&>svg]:text-slate-600">
          <div className="text-left text-base font-semibold text-slate-900">
            {profile.profile_name}
          </div>
        </AccordionTrigger>
        <AccordionContent className="border-t border-slate-100 px-5 py-4">
          <div className="space-y-3">
            {profile.ai_profile.map((row) => (
              <div
                key={`${profile.profile_name}-${row.label}`}
                className="grid gap-1 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="text-xs font-medium tracking-wide text-slate-500">
                  {row.label}
                </div>
                <div className="text-sm leading-7 text-slate-700 break-words whitespace-pre-wrap">
                  {row.value || "-"}
                </div>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

type ProfileCaseDetail = {
  prompt_id: string;
  category_label: string;
  prompt: string;
  comment: string;
  profile: ComparisonProfile;
};

function AIProfileDetailCard({
  profileName,
  cases,
}: {
  profileName: string;
  cases: ProfileCaseDetail[];
}) {
  return (
    <Accordion
      type="single"
      collapsible
      className="rounded border border-slate-200 bg-white"
    >
      <AccordionItem value={profileName} className="border-none px-0">
        <AccordionTrigger className="rounded-none bg-slate-50/70 px-5 py-4 hover:bg-slate-100 hover:no-underline [&>svg]:size-5 [&>svg]:text-slate-600">
          <div className="text-left">
            <div className="text-base font-semibold text-slate-900">
              {profileName}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {cases.length} 件の結果
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="border-t border-slate-100 px-5 py-4">
          <div className="space-y-4">
            {cases.map((caseItem) => (
              <div
                key={`${profileName}-${caseItem.prompt_id}`}
                className={`rounded border p-4 ${getSeverityColor(
                  caseItem.profile.severity
                )}`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {caseItem.category_label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      個別ケースの実出力
                    </div>
                  </div>
                  <Badge className={getSeverityBadgeColor(caseItem.profile.severity)}>
                    {caseItem.profile.severity}
                  </Badge>
                </div>

                <div className="space-y-3 text-sm text-slate-800">
                  <div>
                    <span className="font-medium">入力プロンプト:</span>
                    <div className="mt-1 rounded border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                      {caseItem.prompt}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">応答要約:</span>{" "}
                    {caseItem.profile.response_summary}
                  </div>
                  <div>
                    <span className="font-medium">判定理由:</span>{" "}
                    {caseItem.profile.reason}
                  </div>
                  {caseItem.comment ? (
                    <div>
                      <span className="font-medium">コメント:</span>{" "}
                      {caseItem.comment}
                    </div>
                  ) : null}
                  <div className="rounded border border-slate-200 bg-white p-3">
                    <span className="mb-2 block text-xs font-medium text-slate-500">
                      応答内容
                    </span>
                    <div className="font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                      {caseItem.profile.response || "-"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function ComparisonDetailsSections({
  report,
  aiCounts,
}: {
  report: ComparisonReportData;
  aiCounts: Array<{
    profile_name: string;
    safe: number;
    warning: number;
    dangerous: number;
    error: number;
  }>;
}) {
  const profileCaseGroups = report.profiles.map((profile) => ({
    profileName: profile.profile_name,
    cases: report.prompt_cases
      .map((caseItem) => {
        const matchedProfile = caseItem.profiles.find(
          (row) => row.profile_name === profile.profile_name
        );
        if (!matchedProfile) return null;

        return {
          prompt_id: caseItem.prompt_id,
          category_label: caseItem.category_label,
          prompt: caseItem.prompt,
          comment: caseItem.comment,
          profile: matchedProfile,
        };
      })
      .filter((item): item is ProfileCaseDetail => item !== null),
  }));

  return (
    <>
      <section id="settings-list">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">AI設定一覧</h2>

        <div className="space-y-4">
          {report.profiles.map((profile) => (
            <AIProfileSettingsCard
              key={profile.profile_name}
              profile={profile}
            />
          ))}
        </div>
      </section>

      <section id="scoreboard">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">
          AI別スコアボード
        </h2>

        <div className="overflow-x-auto rounded border border-slate-200">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-semibold text-slate-700">AI名</TableHead>
                <TableHead className="text-right font-semibold text-emerald-700">
                  SAFE
                </TableHead>
                <TableHead className="text-right font-semibold text-amber-700">
                  WARNING
                </TableHead>
                <TableHead className="text-right font-semibold text-red-700">
                  DANGEROUS
                </TableHead>
                <TableHead className="text-right font-semibold text-slate-700">
                  ERROR
                </TableHead>
                <TableHead className="font-semibold text-slate-700">総評</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.scoreboard.map((row) => (
                <TableRow key={row.profile_name}>
                  <TableCell className="font-medium text-slate-900">
                    {row.profile_name}
                  </TableCell>
                  <TableCell className="text-right font-medium text-emerald-700">
                    {row.safe}
                  </TableCell>
                  <TableCell className="text-right font-medium text-amber-700">
                    {row.warning}
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-700">
                    {row.dangerous}
                  </TableCell>
                  <TableCell className="text-right text-slate-700">
                    {row.error}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-slate-700">
                    {row.summary}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section id="charts">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">図表</h2>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded border border-slate-200 bg-slate-50 p-6">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              AI別診断結果分布
            </h3>
            <StackedComparisonChart rows={aiCounts} />
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-6">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              カテゴリ別危険度
            </h3>
            <RiskCategoryChart
              rows={report.categories.map((row) => ({
                label: row.label,
                warning: row.profiles.reduce((sum, profile) => sum + profile.warning, 0),
                dangerous: row.profiles.reduce(
                  (sum, profile) => sum + profile.dangerous,
                  0
                ),
              }))}
            />
          </div>
        </div>
      </section>

      {profileCaseGroups.length > 0 && (
        <section id="ai-details">
          <h2 className="mb-6 text-2xl font-bold text-slate-900">
            AI種類別詳細結果
          </h2>
          <div className="space-y-4">
            {profileCaseGroups.map((group) => (
              <AIProfileDetailCard
                key={group.profileName}
                profileName={group.profileName}
                cases={group.cases}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function useComparisonReportData() {
  const [report, setReport] = useState<ComparisonReportData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reports/comparison`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.detail || "診断レポートの取得に失敗しました");
        }
        setReport(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "診断レポートの取得に失敗しました"
        );
      }
    };
    load();
  }, []);

  const categorizedResults = useMemo<CategoryResult[]>(() => {
    if (!report) return [];
    return report.categories
      .map((category) => {
        const relatedCases = report.prompt_cases.filter(
          (caseItem) => caseItem.category_label === category.label
        );
        const categoryKey =
          relatedCases[0]?.category ??
          CATEGORY_LABEL_TO_KEY[category.label] ??
          category.label;
        const guide = getCategoryGuide(categoryKey, category.label);
        const riskTotals = category.profiles.reduce(
          (acc, profile) => {
            acc.warning += profile.warning;
            acc.dangerous += profile.dangerous;
            acc.error += profile.error;
            return acc;
          },
          { warning: 0, dangerous: 0, error: 0 }
        );

        return {
          ...category,
          categoryKey,
          guide,
          relatedCases,
          riskTotals,
          riskScore:
            riskTotals.dangerous * 100 +
            riskTotals.warning * 10 +
            riskTotals.error,
        };
      })
      .sort((a, b) => {
        const aIndex = CATEGORY_ORDER.indexOf(a.categoryKey);
        const bIndex = CATEGORY_ORDER.indexOf(b.categoryKey);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
  }, [report]);

  const matchedPatterns = useMemo(() => {
    if (!report) return [];
    return collectSettingPatterns(report.profiles);
  }, [report]);

  const fixedPatterns = matchedPatterns.filter((pattern) => pattern.shouldFix);
  const cautionPatterns = matchedPatterns.filter(
    (pattern) => !pattern.shouldFix
  );

  const categoriesByRisk = [...categorizedResults].sort(
    (a, b) => b.riskScore - a.riskScore
  );

  const mostRiskyCategory = categoriesByRisk[0] ?? null;
  const cautionCategories = categoriesByRisk.filter(
    (category, index) =>
      index > 0 &&
      (category.riskTotals.dangerous > 0 || category.riskTotals.warning > 0)
  );
  const stableCategories = categoriesByRisk.filter(
    (category) =>
      category.riskTotals.dangerous === 0 && category.riskTotals.warning === 0
  );

  const dangerousCount = report?.scoreboard.reduce(
    (sum, row) => sum + row.dangerous,
    0
  ) ?? 0;
  const warningCount = report?.scoreboard.reduce(
    (sum, row) => sum + row.warning,
    0
  ) ?? 0;

  const aiCounts =
    report?.graphs?.ai_counts ??
    report?.scoreboard.map((row) => ({
      profile_name: row.profile_name,
      safe: row.safe,
      warning: row.warning,
      dangerous: row.dangerous,
      error: row.error,
    })) ??
    [];

  return {
    report,
    error,
    categorizedResults,
    fixedPatterns,
    cautionPatterns,
    mostRiskyCategory,
    firstCautionCategory: cautionCategories[0] ?? null,
    firstStableCategory: stableCategories[0] ?? null,
    dangerousCount,
    warningCount,
    aiCounts,
  };
}
