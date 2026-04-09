"use client";

import rawSession from "./session-snapshot.json";
import {
  deriveComparisonReportState,
  type ComparisonProfile,
  type ComparisonReportData,
} from "../comparison/report-shared";

type RawResult = {
  section?: string;
  prompt_id?: string;
  source_id?: string;
  source_mode?: string;
  category?: string;
  prompt?: string;
  response?: string;
  status?: string;
  reason?: string;
  profile_name?: string;
  job_id?: string;
};

type RawProfile = {
  profile_name?: string;
  job_id?: string;
  ai_profile?: Record<string, unknown>;
  results?: RawResult[];
};

type RawSession = {
  session_id?: string;
  created_at?: string;
  scan_type?: string;
  judge_model?: string;
  profiles?: RawProfile[];
};

const ATTACK_SECTION = "attack";
const STATUS_SAFE = "SAFE";
const STATUS_WARNING = "WARNING";
const STATUS_DANGEROUS = "DANGEROUS";
const STATUS_ERROR = "ERROR";

const CATEGORY_LABELS: Record<string, string> = {
  prompt_injection: "プロンプトインジェクション",
  jailbreak: "ジェイルブレイク",
  excessive_agency: "過剰な権限・実行表現",
  output_handling: "危険な出力形式",
  miscellaneous: "その他の異常系",
  unknown: "未分類",
};

const SCAN_TYPE_LABELS: Record<string, string> = {
  attack_only: "攻撃検証",
  baseline_only: "ベースライン検証",
  full_scan: "フルスキャン",
  attack_core: "過剰権限・ジェイルブレイク検証",
  attack_surface: "その他・危険出力検証",
  attack_injection: "プロンプトインジェクション検証",
  mixed: "分割実行の集約結果",
};

function getCategoryLabel(category?: string) {
  return CATEGORY_LABELS[category || "unknown"] ?? (category || "未分類");
}

function getScanTypeLabel(scanType?: string) {
  return SCAN_TYPE_LABELS[scanType || ""] ?? (scanType || "-");
}

function normalizeStatus(status?: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === STATUS_WARNING) return STATUS_WARNING;
  if (normalized === STATUS_DANGEROUS) return STATUS_DANGEROUS;
  if (normalized === STATUS_ERROR) return STATUS_ERROR;
  return STATUS_SAFE;
}

function getSummaryLabel(
  counts: Pick<
    ComparisonReportData["scoreboard"][number],
    "safe" | "warning" | "dangerous"
  >
) {
  if (counts.dangerous > 0 && counts.dangerous >= counts.safe) {
    return "最も危険寄り";
  }
  if (counts.warning > 0 || counts.dangerous > 0) {
    return "要注意ケースあり";
  }
  return "比較的安定";
}

function extractResponseSummary(response?: string) {
  const text = String(response || "").trim();
  if (!text) return "-";
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function serializeAiProfile(aiProfile?: Record<string, unknown>) {
  if (!aiProfile) return [];
  const pairs: Array<[string, string]> = [
    ["AI名", "name"],
    ["AI概要", "ai_overview"],
    ["役割・目的", "role_purpose"],
    ["トーン・文体", "tone_style"],
    ["出力フォーマット", "output_format"],
    ["禁止事項", "prohibited_actions"],
    ["回答の確実性", "answer_confidence"],
    ["不足情報の扱い", "handling_missing_info"],
    ["推論・意思決定のルール", "reasoning_rules"],
    ["セキュリティ・プライバシー", "security_privacy"],
    ["その他の振る舞い設定", "other_behaviors"],
  ];

  return pairs.map(([label, key]) => {
    const value = aiProfile[key];
    const text = Array.isArray(value)
      ? value.length > 0
        ? value.map((item) => String(item)).join("、")
        : "設定しない"
      : value && typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value || "設定しない");

    return { label, value: text };
  });
}

function buildScoreboard(profiles: RawProfile[]) {
  return profiles.map((profile) => {
    const attackResults = (profile.results || []).filter(
      (entry) => entry.section === ATTACK_SECTION
    );
    const counts = attackResults.reduce(
      (acc, entry) => {
        const status = normalizeStatus(entry.status);
        if (status === STATUS_WARNING) acc.warning += 1;
        else if (status === STATUS_DANGEROUS) acc.dangerous += 1;
        else if (status === STATUS_ERROR) acc.error += 1;
        else acc.safe += 1;
        return acc;
      },
      { safe: 0, warning: 0, dangerous: 0, error: 0 }
    );

    return {
      profile_name: String(profile.profile_name || "-"),
      job_id: String(profile.job_id || ""),
      ...counts,
      summary: getSummaryLabel(counts),
    };
  });
}

function buildPromptCases(profiles: RawProfile[]) {
  const grouped = new Map<
    string,
    {
      prompt_id: string;
      source_id: string;
      source_mode: string;
      category: string;
      category_label: string;
      prompt: string;
      comment: string;
      profiles: ComparisonProfile[];
    }
  >();

  for (const profile of profiles) {
    for (const result of profile.results || []) {
      if (result.section !== ATTACK_SECTION) continue;

      const key = `${result.section}:${result.prompt_id || ""}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          prompt_id: String(result.prompt_id || "-"),
          source_id: String(result.source_id || ""),
          source_mode: String(result.source_mode || ""),
          category: String(result.category || "unknown"),
          category_label: getCategoryLabel(result.category),
          prompt: String(result.prompt || ""),
          comment: "",
          profiles: [],
        });
      }

      grouped.get(key)!.profiles.push({
        profile_name: String(profile.profile_name || "-"),
        job_id: String(profile.job_id || ""),
        status: normalizeStatus(result.status),
        severity: normalizeStatus(result.status),
        response_summary: extractResponseSummary(result.response),
        reason: String(result.reason || ""),
        response: String(result.response || ""),
      });
    }
  }

  return Array.from(grouped.values())
    .map((item) => {
      const rank = (status: string) => {
        if (status === STATUS_DANGEROUS) return 2;
        if (status === STATUS_WARNING) return 1;
        if (status === STATUS_ERROR) return -1;
        return 0;
      };
      const ranks = item.profiles.map((profile) => rank(profile.status));
      const spread = ranks.length > 0 ? Math.max(...ranks) - Math.min(...ranks) : 0;

      return {
        ...item,
        spread,
        comment:
          spread > 0
            ? "同じ入力に対してAI設定ごとの応答差分が見られました。"
            : "大きな差分は見られませんでした。",
        profiles: item.profiles.sort((a, b) => rank(a.status) - rank(b.status)),
      };
    })
    .sort((a, b) => b.spread - a.spread);
}

function buildCategories(
  profiles: RawProfile[]
) {
  const grouped = new Map<
    string,
    Map<string, { job_id: string; safe: number; warning: number; dangerous: number; error: number }>
  >();

  for (const profile of profiles) {
    for (const result of profile.results || []) {
      if (result.section !== ATTACK_SECTION) continue;
      const category = String(result.category || "unknown");
      if (!grouped.has(category)) grouped.set(category, new Map());
      if (!grouped.get(category)!.has(String(profile.profile_name || "-"))) {
        grouped.get(category)!.set(String(profile.profile_name || "-"), {
          job_id: String(profile.job_id || ""),
          safe: 0,
          warning: 0,
          dangerous: 0,
          error: 0,
        });
      }
      const stats = grouped.get(category)!.get(String(profile.profile_name || "-"))!;
      const status = normalizeStatus(result.status);
      if (status === STATUS_WARNING) stats.warning += 1;
      else if (status === STATUS_DANGEROUS) stats.dangerous += 1;
      else if (status === STATUS_ERROR) stats.error += 1;
      else stats.safe += 1;
    }
  }

  return Array.from(grouped.entries()).map(([category, profileMap]) => ({
    label: getCategoryLabel(category),
    profiles: Array.from(profileMap.entries()).map(([profileName, counts]) => ({
      profile_name: profileName,
      job_id: counts.job_id,
      safe: counts.safe,
      warning: counts.warning,
      dangerous: counts.dangerous,
      error: counts.error,
    })),
  }));
}

function buildComparisonReportData(session: RawSession): ComparisonReportData {
  const profiles = (session.profiles || []) as RawProfile[];
  const scoreboard = buildScoreboard(profiles);
  const promptCases = buildPromptCases(profiles);
  const categories = buildCategories(profiles);
  const sortedScoreboard = [...scoreboard].sort(
    (a, b) => a.dangerous - b.dangerous || a.warning - b.warning || b.safe - a.safe
  );

  return {
    report_title: "kanataAI診断レポート",
    basic_info: {
      session_id: String(session.session_id || "-"),
      created_at: String(session.created_at || "-"),
      scan_type: getScanTypeLabel(session.scan_type),
      judge_model: String(session.judge_model || "-"),
    },
    summary: {
      ai_names: profiles.map((profile) => String(profile.profile_name || "-")),
      common_prompt_count: new Set(promptCases.map((item) => item.prompt_id)).size,
      most_stable: sortedScoreboard[0]?.profile_name || "データなし",
      most_risky:
        sortedScoreboard[sortedScoreboard.length - 1]?.profile_name || "データなし",
      comment:
        sortedScoreboard.length > 0
          ? `${sortedScoreboard[0]?.profile_name} が最も安定し、${
              sortedScoreboard[sortedScoreboard.length - 1]?.profile_name
            } が最も危険寄りでした。`
          : "比較対象データがありません。",
    },
    profiles: profiles.map((profile) => ({
      profile_name: String(profile.profile_name || "-"),
      ai_profile: serializeAiProfile(profile.ai_profile),
    })),
    scoreboard,
    categories,
    prompt_cases: promptCases,
    graphs: {
      ai_counts: scoreboard.map((row) => ({
        profile_name: row.profile_name,
        safe: row.safe,
        warning: row.warning,
        dangerous: row.dangerous,
        error: row.error,
      })),
      category_comparison: categories.map((category) => ({
        label: category.label,
        profiles: category.profiles.map((profile) => ({
          profile_name: profile.profile_name,
          safe: profile.safe,
          warning: profile.warning,
          dangerous: profile.dangerous,
          error: profile.error,
        })),
      })),
    },
    diff_cases: [],
  };
}

const staticReportData = buildComparisonReportData(rawSession as RawSession);

export function useStaticComparisonReportData() {
  return deriveComparisonReportState(staticReportData, "");
}
