"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ScanStatus = "idle" | "loading" | "success" | "error";
type JobState = "queued" | "running" | "completed" | "failed";
type Distribution = Record<string, number>;

type ScanSettings = {
  total_limit: number;
  rounds: number;
  variants_per_base: number;
  category_distribution: Distribution;
  conversation_mode_distribution: Distribution;
  shuffle_enabled: boolean;
  seed: number | null;
};

type PresetOption = {
  key: string;
  label: string;
  description: string;
  recommended: boolean;
  settings: ScanSettings;
};

type ScanOptionsResponse = {
  default_mode: string;
  modes: PresetOption[];
  category_labels: Record<string, string>;
  conversation_mode_labels: Record<string, string>;
};

type ScanResponse = {
  status: string;
  scan_type?: "attack_only" | "baseline_only" | "full_scan";
  job_id: string;
  mode: string;
  requested_mode?: string;
  is_random: boolean;
  conversation_mode?: string | null;
};

type ScanJobResult = {
  status: JobState | string;
  scan_type?: "attack_only" | "baseline_only" | "full_scan";
  job_id: string;
  mode?: string;
  requested_mode?: string;
  is_random?: boolean;
  conversation_mode?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  summary_json?: string;
  summary_csv?: string;
  report_file?: string;
  log_dir?: string;
  comparison_session_json?: string;
  result?: {
    status?: string;
    report_file?: string;
    summary_json?: string;
    summary_csv?: string;
    log_dir?: string;
    comparison_session_json?: string;
  };
};

type ComparisonReportResponse = {
  status: string;
  report_file: string;
  session_json: string;
  session_id?: string | null;
  profile_count?: number;
};

type AIProfile = {
  name: string;
  ai_overview: string;
  data_reference: {
    policy: string;
    sources?: string[];
  };
  role_purpose: string;
  tone_style: string;
  output_format: string;
  prohibited_actions: string[];
  answer_confidence: string;
  handling_missing_info: string;
  reasoning_rules: string;
  security_privacy: string;
  other_behaviors: string[];
};

const API_BASE = "http://127.0.0.1:8000";
const STANDARD_SCAN_TYPE = "full_scan";

const cloneSettings = (settings: ScanSettings): ScanSettings => ({
  total_limit: settings.total_limit,
  rounds: settings.rounds,
  variants_per_base: settings.variants_per_base,
  category_distribution: { ...settings.category_distribution },
  conversation_mode_distribution: {
    ...settings.conversation_mode_distribution,
  },
  shuffle_enabled: settings.shuffle_enabled,
  seed: settings.seed,
});

const sumDistribution = (distribution: Distribution) =>
  Object.values(distribution).reduce((total, value) => total + value, 0);

export default function Home() {
  const [formData, setFormData] = useState({
    url: "https://dev.kanata.app/ja/",
    mode: "",
  });
  const [aiProfiles, setAiProfiles] = useState<AIProfile[]>([]);
  const [selectedAIName, setSelectedAIName] = useState("");
  const [options, setOptions] = useState<ScanOptionsResponse | null>(null);
  const [scanSettings, setScanSettings] = useState<ScanSettings | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<JobState | "">("");
  const [resultLinks, setResultLinks] = useState<{
    summary_json?: string;
    summary_csv?: string;
    report_file?: string;
    log_dir?: string;
    comparison_session_json?: string;
  }>({});
  const [comparisonStatus, setComparisonStatus] = useState<ScanStatus>("idle");
  const [comparisonMessage, setComparisonMessage] = useState("");
  const [comparisonReportFile, setComparisonReportFile] = useState("");

  const selectedPreset =
    options?.modes.find((preset) => preset.key === formData.mode) ?? null;
  const selectedAIProfile =
    aiProfiles.find((profile) => profile.name === selectedAIName) ?? null;

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [optionsRes, aiProfilesRes] = await Promise.all([
          fetch(`${API_BASE}/api/scan/options`),
          fetch(`${API_BASE}/api/ai-profiles`),
        ]);

        const optionsData: ScanOptionsResponse = await optionsRes.json();
        const aiProfilesData: AIProfile[] = await aiProfilesRes.json();

        if (!optionsRes.ok || !aiProfilesRes.ok) {
          throw new Error("failed");
        }

        const defaultPreset =
          optionsData.modes.find(
            (preset) => preset.key === optionsData.default_mode
          ) ?? optionsData.modes[0];

        setOptions(optionsData);
        setAiProfiles(aiProfilesData);

        if (defaultPreset) {
          setFormData((prev) => ({ ...prev, mode: defaultPreset.key }));
          setScanSettings(cloneSettings(defaultPreset.settings));
        }

        if (aiProfilesData.length > 0) {
          setSelectedAIName(aiProfilesData[0].name);
        }
      } catch (error) {
        console.error(error);
        setStatus("error");
        setMessage("初期設定の読み込みに失敗しました");
      }
    };

    loadInitialData();
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePresetSelect = (preset: PresetOption) => {
    setFormData((prev) => ({ ...prev, mode: preset.key }));
    setScanSettings(cloneSettings(preset.settings));
  };

  const pollScanStatus = async (scanJobId: string) => {
    const maxAttempts = 300;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`${API_BASE}/api/scan/${scanJobId}`);
        const data: ScanJobResult = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(data?.status || "スキャン結果の取得に失敗しました");
          return;
        }

        const currentStatus = String(data.status || "");
        if (currentStatus === "queued" || currentStatus === "running") {
          setJobStatus(currentStatus as JobState);
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        if (currentStatus === "completed") {
          const summaryJson = data.summary_json || data.result?.summary_json;
          const summaryCsv = data.summary_csv || data.result?.summary_csv;
          const reportFile = data.report_file || data.result?.report_file;
          const logDir = data.log_dir || data.result?.log_dir;
          const comparisonSessionJson =
            data.comparison_session_json ||
            data.result?.comparison_session_json;

          setJobStatus("completed");
          setStatus("success");
          setResultLinks({
            summary_json: summaryJson,
            summary_csv: summaryCsv,
            report_file: reportFile,
            log_dir: logDir,
            comparison_session_json: comparisonSessionJson,
          });
          setMessage(
            `スキャンが完了しました\nジョブID: ${scanJobId}\n状態: completed`
          );
          return;
        }

        setJobStatus("failed");
        setStatus("error");
        setMessage(
          `スキャンに失敗しました\nジョブID: ${scanJobId}\n状態: ${currentStatus}`
        );
        return;
      } catch (error) {
        console.error(error);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    setJobStatus("failed");
    setStatus("error");
    setMessage(
      `スキャン結果の待機がタイムアウトしました\nジョブID: ${scanJobId}`
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanSettings || !formData.mode || !selectedAIName) {
      return;
    }

    const categoryTotal = sumDistribution(scanSettings.category_distribution);
    const modeTotal = sumDistribution(
      scanSettings.conversation_mode_distribution
    );
    if (categoryTotal !== 100 || modeTotal !== 100) {
      setStatus("error");
      setMessage("割合の合計を100%にしてください");
      return;
    }

    setStatus("loading");
    setJobStatus("queued");
    setJobId("");
    setResultLinks({});
    setMessage("標準スキャンを開始しています...");

    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: formData.url,
          scan_type: STANDARD_SCAN_TYPE,
          mode: formData.mode,
          ai_profile_name: selectedAIName,
          is_random: scanSettings.shuffle_enabled,
          total_limit: scanSettings.total_limit,
          rounds: scanSettings.rounds,
          variants_per_base: scanSettings.variants_per_base,
          category_distribution: scanSettings.category_distribution,
          conversation_mode_distribution:
            scanSettings.conversation_mode_distribution,
          shuffle_enabled: scanSettings.shuffle_enabled,
          seed: scanSettings.seed,
        }),
      });

      const data: ScanResponse = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage("スキャン開始に失敗しました");
        return;
      }

      setJobId(data.job_id);
      setMessage(
        `スキャンを受け付けました\nジョブID: ${
          data.job_id
        }\n対象AI: ${selectedAIName}\nモード: ${
          selectedPreset?.label ?? "標準スキャン"
        }\n状態: queued`
      );

      await pollScanStatus(data.job_id);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("バックエンドへ接続できませんでした");
    }
  };

  const handleComparisonReport = async () => {
    setComparisonStatus("loading");
    setComparisonMessage("比較レポートを生成しています...");
    setComparisonReportFile("");
    try {
      const res = await fetch(`${API_BASE}/api/scan/comparison-report`, {
        method: "POST",
      });
      const data: ComparisonReportResponse = await res.json();
      if (!res.ok) {
        setComparisonStatus("error");
        setComparisonMessage("比較レポートの生成に失敗しました");
        return;
      }
      setComparisonStatus("success");
      setComparisonReportFile(data.report_file);
      setComparisonMessage(
        `比較レポートを出力しました\nセッション: ${
          data.session_id ?? "-"
        }\n対象AI数: ${data.profile_count ?? 0}`
      );
    } catch (error) {
      console.error(error);
      setComparisonStatus("error");
      setComparisonMessage("比較レポートAPIへ接続できませんでした");
    }
  };

  if (!options || !scanSettings || aiProfiles.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-stone-100 p-6 text-stone-900">
        <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
          設定を読み込んでいます...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 p-6 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-stone-200 bg-white p-8 shadow-sm">
            <h1 className="text-3xl font-bold tracking-tight">
              Auto-Injection-Check
            </h1>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">
                  URL
                </label>
                <input
                  type="text"
                  name="url"
                  value={formData.url}
                  onChange={handleTextChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-500"
                  required
                />
              </div>

              <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-5">
                <div>
                  <h2 className="text-sm font-semibold text-stone-800">
                    対象AI
                  </h2>
                  <p className="text-xs text-stone-500">
                    診断対象にするAIを選択してください。
                  </p>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-stone-700">
                    AI選択
                  </label>
                  <select
                    value={selectedAIName}
                    onChange={(e) => setSelectedAIName(e.target.value)}
                    className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none transition focus:border-amber-500"
                    required
                  >
                    {aiProfiles.map((profile) => (
                      <option key={profile.name} value={profile.name}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedAIProfile && (
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-700">
                    <div className="font-medium text-stone-900">
                      {selectedAIProfile.name}
                    </div>
                    <div className="mt-2 text-stone-600">
                      {selectedAIProfile.ai_overview}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div>
                        <span className="text-stone-500">役割・目的: </span>
                        {selectedAIProfile.role_purpose}
                      </div>
                      <div>
                        <span className="text-stone-500">トーン・文体: </span>
                        {selectedAIProfile.tone_style}
                      </div>
                      <div>
                        <span className="text-stone-500">回答の確実性: </span>
                        {selectedAIProfile.answer_confidence}
                      </div>
                      <div>
                        <span className="text-stone-500">セキュリティ: </span>
                        {selectedAIProfile.security_privacy}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-5">
                <div>
                  <h2 className="text-sm font-semibold text-stone-800">
                    標準スキャン
                  </h2>
                  <p className="text-xs text-stone-500">
                    `backend/data/prompts` の attack prompt 全件と
                    `backend/data/baseline_prompts.json` の baseline prompt を
                    1回のジョブでまとめて実行します。
                  </p>
                </div>

                <div className="mt-4 grid gap-3">
                  {options.modes.map((preset) => {
                    const selected = formData.mode === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        className={`rounded-3xl border p-5 text-left transition ${
                          selected
                            ? "border-amber-500 bg-amber-50"
                            : "border-stone-200 bg-white hover:border-stone-300"
                        }`}
                      >
                        <div className="text-lg font-semibold">
                          {preset.label}
                        </div>
                        <p className="mt-1 text-sm text-stone-600">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* 将来 scan type を復活させる場合の UI
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <button type="button">Attack Scan</button>
                  <button type="button">Baseline Scan</button>
                  <button type="button">Full Scan</button>
                </div>
                */}
              </div>

              <button
                type="submit"
                disabled={status === "loading" || !selectedAIName}
                className={`w-full rounded-2xl px-5 py-4 text-base font-semibold text-white transition ${
                  status === "loading"
                    ? "cursor-not-allowed bg-stone-400"
                    : "bg-stone-900 hover:bg-stone-800"
                }`}
              >
                {status === "loading"
                  ? "標準スキャンを実行中..."
                  : "標準スキャンを実行"}
              </button>

              <button
                type="button"
                onClick={handleComparisonReport}
                disabled={comparisonStatus === "loading"}
                className={`w-full rounded-2xl border px-5 py-4 text-base font-semibold transition ${
                  comparisonStatus === "loading"
                    ? "cursor-not-allowed border-stone-300 bg-stone-100 text-stone-400"
                    : "border-sky-300 bg-sky-50 text-sky-900 hover:border-sky-400"
                }`}
              >
                {comparisonStatus === "loading"
                  ? "比較レポートを生成中..."
                  : "比較レポートを生成（PDF / HTML）"}
              </button>
            </form>
          </section>

          <aside className="rounded-[28px] border border-stone-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-semibold">現在の設定</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-2xl bg-stone-50 p-4">
                <div className="font-medium text-stone-800">
                  {selectedPreset?.label ?? "標準スキャン"}
                </div>
                <div className="mt-1 text-stone-600">
                  {selectedPreset?.description}
                </div>
              </div>

              {selectedAIProfile && (
                <div className="rounded-2xl border border-stone-200 p-4">
                  <div className="font-medium text-stone-800">選択中のAI</div>
                  <div className="mt-2 text-base font-semibold text-stone-900">
                    {selectedAIProfile.name}
                  </div>
                  <div className="mt-1 text-stone-600">
                    {selectedAIProfile.ai_overview}
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div>
                      <span className="text-stone-500">学習データ参照: </span>
                      {selectedAIProfile.data_reference.policy}
                    </div>
                    <div>
                      <span className="text-stone-500">役割・目的: </span>
                      {selectedAIProfile.role_purpose}
                    </div>
                    <div>
                      <span className="text-stone-500">トーン・文体: </span>
                      {selectedAIProfile.tone_style}
                    </div>
                    <div>
                      <span className="text-stone-500">推論ルール: </span>
                      {selectedAIProfile.reasoning_rules}
                    </div>
                    <div>
                      <span className="text-stone-500">禁止事項数: </span>
                      {selectedAIProfile.prohibited_actions.length}件
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                標準スキャンでは、attack 側は `backend/data/prompts`
                の全件、baseline 側は `backend/data/baseline_prompts.json`
                を実行します。結果は単体 PDF / JSON / CSV と比較用 JSON
                に保存されます。
              </div>
            </div>

            {message && (
              <div
                className={`mt-6 whitespace-pre-line rounded-2xl border p-4 text-sm ${
                  status === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : status === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-sky-200 bg-sky-50 text-sky-800"
                }`}
              >
                {message}
              </div>
            )}

            {jobId && (
              <div className="mt-4 text-xs text-stone-500">
                ジョブID: {jobId}
                <br />
                状態: {jobStatus || "queued"}
              </div>
            )}

            {(resultLinks.report_file ||
              resultLinks.summary_json ||
              resultLinks.summary_csv) && (
              <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <h3 className="text-sm font-semibold text-stone-800">
                  出力ファイル
                </h3>
                <div className="mt-3 space-y-2 text-sm text-stone-700">
                  {jobId && (
                    <div>
                      HTML:{" "}
                      <Link
                        href={`/reports/single/${jobId}`}
                        className="font-medium text-sky-700 underline underline-offset-4"
                      >
                        単体レポート画面を開く
                      </Link>
                    </div>
                  )}
                  {resultLinks.report_file && (
                    <div>PDF: {resultLinks.report_file}</div>
                  )}
                  {resultLinks.summary_json && (
                    <div>JSON: {resultLinks.summary_json}</div>
                  )}
                  {resultLinks.summary_csv && (
                    <div>CSV: {resultLinks.summary_csv}</div>
                  )}
                  {resultLinks.log_dir && (
                    <div>ログ: {resultLinks.log_dir}</div>
                  )}
                  {resultLinks.comparison_session_json && (
                    <div>比較用JSON: {resultLinks.comparison_session_json}</div>
                  )}
                </div>
              </div>
            )}

            {(comparisonMessage || comparisonReportFile) && (
              <div
                className={`mt-6 whitespace-pre-line rounded-2xl border p-4 text-sm ${
                  comparisonStatus === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : comparisonStatus === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-sky-200 bg-sky-50 text-sky-800"
                }`}
              >
                {comparisonMessage}
                {comparisonReportFile && `\nPDF: ${comparisonReportFile}`}
                {comparisonStatus === "success" &&
                  "\nHTML: /reports/comparison"}
              </div>
            )}

            {comparisonStatus === "success" && (
              <div className="mt-4">
                <Link
                  href="/reports/comparison"
                  className="inline-flex rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900 transition hover:border-sky-400"
                >
                  比較HTMLレポートを開く
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
