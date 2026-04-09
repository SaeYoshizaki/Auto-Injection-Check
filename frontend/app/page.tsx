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

type ScanTypeOption = {
  key: string;
  label: string;
  description: string;
};

type ScanOptionsResponse = {
  default_mode: string;
  modes: PresetOption[];
  scan_types: ScanTypeOption[];
  category_labels: Record<string, string>;
  conversation_mode_labels: Record<string, string>;
};

type ScanResponse = {
  status: string;
  scan_type?: string;
  job_id: string;
  mode: string;
  requested_mode?: string;
  is_random: boolean;
  conversation_mode?: string | null;
};

type ScanJobResult = {
  status: JobState | string;
  scan_type?: string;
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

type SavedSingleReport = {
  job_id: string;
  scan_type?: string;
  mode?: string;
  requested_mode?: string;
  ai_profile_name?: string;
  created_at?: string;
  finished_at?: string;
  report_path: string;
};

type SavedProfileReport = {
  profile_name: string;
  report_path: string;
};

type SavedReportsResponse = {
  single_reports: SavedSingleReport[];
  comparison_report: {
    session_id?: string | null;
    created_at?: string;
    report_path: string;
  } | null;
  profile_reports: SavedProfileReport[];
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
const SCAN_POLL_INTERVAL_MS = 3000;
const SCAN_POLL_MAX_ATTEMPTS = 2400;
const FALLBACK_SCAN_TYPE_LABELS: Record<string, string> = {
  baseline_only: "ベースプロンプト実行",
  attack_only: "攻撃プロンプト実行",
  full_scan: "全件実行",
  attack_core: "過剰権限+ジェイルブレイク",
  attack_surface: "その他+危険出力",
  attack_injection: "プロンプトインジェクション",
};

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

const formatDateTime = (value?: string) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function Home() {
  const [formData, setFormData] = useState({
    url: "http://localhost:3000/ja/",
    mode: "",
    scanType: "",
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
  const [savedReports, setSavedReports] = useState<SavedReportsResponse>({
    single_reports: [],
    comparison_report: null,
    profile_reports: [],
  });

  const selectedPreset =
    options?.modes.find((preset) => preset.key === formData.mode) ?? null;
  const selectedScanType =
    options?.scan_types.find(
      (scanType) => scanType.key === formData.scanType
    ) ?? null;
  const selectedAIProfile =
    aiProfiles.find((profile) => profile.name === selectedAIName) ?? null;
  const getScanTypeLabel = (scanType?: string) =>
    options?.scan_types.find((item) => item.key === scanType)?.label ??
    (scanType ? FALLBACK_SCAN_TYPE_LABELS[scanType] ?? scanType : "未設定");

  const loadSavedReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reports`);
      const data: SavedReportsResponse = await res.json();
      if (!res.ok) {
        throw new Error("failed to load reports");
      }
      setSavedReports({
        single_reports: Array.isArray(data.single_reports)
          ? data.single_reports
          : [],
        comparison_report: data.comparison_report ?? null,
        profile_reports: Array.isArray(data.profile_reports)
          ? data.profile_reports
          : [],
      });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [optionsRes, aiProfilesRes, savedReportsRes] = await Promise.all([
          fetch(`${API_BASE}/api/scan/options`),
          fetch(`${API_BASE}/api/ai-profiles`),
          fetch(`${API_BASE}/api/reports`),
        ]);

        const optionsData: ScanOptionsResponse = await optionsRes.json();
        const aiProfilesData: AIProfile[] = await aiProfilesRes.json();
        const savedReportsData: SavedReportsResponse =
          await savedReportsRes.json();

        if (!optionsRes.ok || !aiProfilesRes.ok || !savedReportsRes.ok) {
          throw new Error("failed");
        }

        const defaultPreset =
          optionsData.modes.find(
            (preset) => preset.key === optionsData.default_mode
          ) ?? optionsData.modes[0];

        setOptions(optionsData);
        setAiProfiles(aiProfilesData);

        if (defaultPreset) {
          setFormData((prev) => ({
            ...prev,
            mode: defaultPreset.key,
            scanType: optionsData.scan_types[0]?.key ?? "",
          }));
          setScanSettings(cloneSettings(defaultPreset.settings));
        }

        if (aiProfilesData.length > 0) {
          setSelectedAIName(aiProfilesData[0].name);
        }

        setSavedReports({
          single_reports: Array.isArray(savedReportsData.single_reports)
            ? savedReportsData.single_reports
            : [],
          comparison_report: savedReportsData.comparison_report ?? null,
          profile_reports: Array.isArray(savedReportsData.profile_reports)
            ? savedReportsData.profile_reports
            : [],
        });
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
    for (let attempt = 0; attempt < SCAN_POLL_MAX_ATTEMPTS; attempt += 1) {
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
          await new Promise((resolve) =>
            setTimeout(resolve, SCAN_POLL_INTERVAL_MS)
          );
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
          await loadSavedReports();
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
        await new Promise((resolve) =>
          setTimeout(resolve, SCAN_POLL_INTERVAL_MS)
        );
      }
    }

    setJobStatus("running");
    setStatus("loading");
    setMessage(
      `画面上の待機時間を超えましたが、スキャンはバックグラウンドで継続中の可能性があります\nジョブID: ${scanJobId}\nしばらく待ってから再度状態を確認してください`
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !scanSettings ||
      !formData.mode ||
      !formData.scanType ||
      !selectedAIName
    ) {
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
    setMessage("スキャンを開始しています...");

    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: formData.url,
          scan_type: formData.scanType,
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
        }\n実行区分: ${
          selectedScanType?.label ?? formData.scanType
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
      await loadSavedReports();
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
                    実行区分
                  </h2>
                  <p className="text-xs text-stone-500">
                    baseline と attack
                    を分けて実行できます。比較レポートでは、複数回の結果をまとめて確認できます。
                  </p>
                </div>

                <div className="mt-4 grid gap-3">
                  {options.scan_types.map((scanType) => {
                    const selected = formData.scanType === scanType.key;
                    return (
                      <button
                        key={scanType.key}
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            scanType: scanType.key,
                          }))
                        }
                        className={`rounded-3xl border p-5 text-left transition ${
                          selected
                            ? "border-sky-500 bg-sky-50"
                            : "border-stone-200 bg-white hover:border-stone-300"
                        }`}
                      >
                        <div className="text-lg font-semibold">
                          {scanType.label}
                        </div>
                        <p className="mt-1 text-sm text-stone-600">
                          {scanType.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-5">
                <div>
                  <h2 className="text-sm font-semibold text-stone-800">
                    標準スキャン
                  </h2>
                  <p className="text-xs text-stone-500">
                    選択したプロンプト群に対して、標準の設定でスキャンを実行します。
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
                  ? "スキャンを実行中..."
                  : "スキャンを開始"}
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
                {selectedScanType && (
                  <div className="mt-2 text-stone-600">
                    実行区分: {selectedScanType.label}
                  </div>
                )}
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
                分割実行した結果は比較用 JSON
                に追記されるため、最後に比較レポートを生成するとまとまった形で確認できます。
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

            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-stone-800">
                  保存済みHTMLレポート
                </h3>
                <button
                  type="button"
                  onClick={loadSavedReports}
                  className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-400"
                >
                  更新
                </button>
              </div>

              {savedReports.comparison_report && (
                <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                    比較レポート
                  </div>
                  <div className="mt-2 text-sm text-stone-700">
                    生成日時:{" "}
                    {formatDateTime(savedReports.comparison_report.created_at)}
                  </div>
                  <Link
                    href={savedReports.comparison_report.report_path}
                    className="mt-3 inline-flex rounded-2xl border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-900 transition hover:border-sky-400"
                  >
                    比較HTMLを開く
                  </Link>
                </div>
              )}

              {savedReports.profile_reports.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                    AI別レポート
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {savedReports.profile_reports.map((profile) => (
                      <Link
                        key={profile.profile_name}
                        href={`/reports/profile/${encodeURIComponent(
                          profile.profile_name
                        )}`}
                        className="rounded-2xl border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400"
                      >
                        {profile.profile_name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                  個別HTMLレポート
                </div>
                {savedReports.single_reports.length === 0 ? (
                  <div className="mt-3 text-sm text-stone-500">
                    まだ保存済みの個別レポートはありません。
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {savedReports.single_reports.map((report) => (
                      <Link
                        key={report.job_id}
                        href={report.report_path}
                        className="block rounded-2xl border border-stone-200 bg-white p-4 transition hover:border-stone-300"
                      >
                        <div className="text-sm font-semibold text-stone-900">
                          {report.ai_profile_name || "AI未設定"} /{" "}
                          {getScanTypeLabel(report.scan_type)}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                          モード: {report.mode || report.requested_mode || "-"}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                          完了日時:{" "}
                          {formatDateTime(
                            report.finished_at || report.created_at
                          )}
                        </div>
                        <div className="mt-2 text-xs text-sky-700">
                          レポートを開く
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
