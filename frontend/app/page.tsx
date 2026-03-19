"use client";

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
  job_id: string;
  mode: string;
  requested_mode?: string;
  is_random: boolean;
  conversation_mode?: string | null;
};

type ScanJobResult = {
  status: JobState | string;
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
  result?: {
    status?: string;
    report_file?: string;
    summary_json?: string;
    summary_csv?: string;
    log_dir?: string;
  };
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

const settingsEqual = (left: ScanSettings, right: ScanSettings) =>
  JSON.stringify(left) === JSON.stringify(right);

export default function Home() {
  const [formData, setFormData] = useState({
    url: "https://beta.kanata.app/ja/",
    mode: "",
  });
  const [aiProfiles, setAiProfiles] = useState<AIProfile[]>([]);
  const [selectedAIName, setSelectedAIName] = useState("");
  const [options, setOptions] = useState<ScanOptionsResponse | null>(null);
  const [scanSettings, setScanSettings] = useState<ScanSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<ScanSettings | null>(null);
  const [isCustomSettings, setIsCustomSettings] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<JobState | "">("");
  const [resultLinks, setResultLinks] = useState<{
    summary_json?: string;
    summary_csv?: string;
    report_file?: string;
    log_dir?: string;
  }>({});

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
    setIsCustomSettings(false);
  };

  const openSettingsModal = () => {
    if (!scanSettings) {
      return;
    }
    setDraftSettings(cloneSettings(scanSettings));
    setIsSettingsOpen(true);
  };

  const closeSettingsModal = () => {
    setIsSettingsOpen(false);
    setDraftSettings(null);
  };

  const updateDraftNumber = (
    key: "total_limit" | "rounds" | "variants_per_base",
    value: string
  ) => {
    setDraftSettings((prev) =>
      prev
        ? {
            ...prev,
            [key]: Math.max(1, Number(value) || 1),
          }
        : prev
    );
  };

  const updateDraftDistribution = (
    section: "category_distribution" | "conversation_mode_distribution",
    key: string,
    value: string
  ) => {
    setDraftSettings((prev) =>
      prev
        ? {
            ...prev,
            [section]: {
              ...prev[section],
              [key]: Math.max(0, Number(value) || 0),
            },
          }
        : prev
    );
  };

  const saveSettings = () => {
    if (!draftSettings || !selectedPreset) {
      return;
    }

    const categoryTotal = sumDistribution(draftSettings.category_distribution);
    const modeTotal = sumDistribution(
      draftSettings.conversation_mode_distribution
    );

    if (categoryTotal !== 100 || modeTotal !== 100) {
      setMessage("割合の合計を100%にしてください");
      setStatus("error");
      return;
    }

    setScanSettings(cloneSettings(draftSettings));
    setIsCustomSettings(!settingsEqual(draftSettings, selectedPreset.settings));
    closeSettingsModal();
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
          setMessage(
            `スキャンを実行中です\nジョブID: ${scanJobId}\n状態: ${currentStatus}`
          );
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        if (currentStatus === "completed") {
          const summaryJson = data.summary_json || data.result?.summary_json;
          const summaryCsv = data.summary_csv || data.result?.summary_csv;
          const reportFile = data.report_file || data.result?.report_file;
          const logDir = data.log_dir || data.result?.log_dir;

          setJobStatus("completed");
          setStatus("success");
          setResultLinks({
            summary_json: summaryJson,
            summary_csv: summaryCsv,
            report_file: reportFile,
            log_dir: logDir,
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
    setMessage("スキャンを開始しています...");

    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: formData.url,
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
          selectedPreset?.label ?? formData.mode
        }${isCustomSettings ? "（カスタム設定）" : ""}\n状態: queued`
      );

      await pollScanStatus(data.job_id);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("バックエンドへ接続できませんでした");
    }
  };

  if (!options || !scanSettings || aiProfiles.length === 0) {
    return (
      <main className="min-h-screen bg-stone-100 flex items-center justify-center p-6 text-stone-900">
        <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
          設定を読み込んでいます...
        </div>
      </main>
    );
  }

  const draftCategoryTotal = draftSettings
    ? sumDistribution(draftSettings.category_distribution)
    : 0;
  const draftConversationTotal = draftSettings
    ? sumDistribution(draftSettings.conversation_mode_distribution)
    : 0;

  return (
    <main className="min-h-screen bg-stone-100 p-6 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-stone-200 bg-white p-8 shadow-sm">
            <h1 className="text-3xl font-bold tracking-tight">
              Auto-Injection-Check
            </h1>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
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
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                ログイン情報は画面から入力せず、ローカル環境変数から読み込みます。
                <div className="mt-2 font-mono text-xs text-sky-900">
                  KANATA_USER_ID / KANATA_PASSWORD
                </div>
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
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-800">
                      スキャンの種類
                    </h2>
                    <p className="text-xs text-stone-500">
                      初めて使う場合は「標準スキャン」がおすすめです。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openSettingsModal}
                    className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400"
                  >
                    詳細設定
                  </button>
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
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold">
                            {preset.label}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-stone-600">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
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
                  : "この設定でスキャンを実行"}
              </button>
            </form>
          </section>

          <aside className="rounded-[28px] border border-stone-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-semibold">現在の設定</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-2xl bg-stone-50 p-4">
                <div className="font-medium text-stone-800">
                  {selectedPreset?.label}
                  {isCustomSettings ? "（カスタム設定）" : ""}
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

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 p-4">
                  <div className="text-stone-500">総テスト数</div>
                  <div className="mt-1 text-xl font-semibold">
                    {scanSettings.total_limit}
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 p-4">
                  <div className="text-stone-500">実行回数</div>
                  <div className="mt-1 text-xl font-semibold">
                    {scanSettings.rounds}
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 p-4">
                  <div className="text-stone-500">攻撃パターン</div>
                  <div className="mt-1 text-xl font-semibold">
                    {scanSettings.variants_per_base}
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 p-4">
                  <div className="text-stone-500">実行順</div>
                  <div className="mt-1 text-xl font-semibold">
                    {scanSettings.shuffle_enabled ? "ランダム" : "固定順"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 p-4">
                <div className="font-medium text-stone-800">
                  攻撃カテゴリの割合
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(options.category_labels).map(
                    ([key, label]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between"
                      >
                        <span>{label}</span>
                        <span>{scanSettings.category_distribution[key]}%</span>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 p-4">
                <div className="font-medium text-stone-800">
                  会話モードの割合
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(options.conversation_mode_labels).map(
                    ([key, label]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between"
                      >
                        <span>{label}</span>
                        <span>
                          {scanSettings.conversation_mode_distribution[key]}%
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {message && (
              <div
                className={`mt-6 rounded-2xl border p-4 whitespace-pre-line text-sm ${
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
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {isSettingsOpen && draftSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">詳細設定</h2>
                <p className="mt-1 text-sm text-stone-600">
                  現在選択中のプリセット内容を確認し、必要なら調整できます。
                </p>
              </div>
              <button
                type="button"
                onClick={closeSettingsModal}
                className="rounded-full border border-stone-300 px-3 py-1 text-sm text-stone-600"
              >
                閉じる
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <label className="block rounded-2xl border border-stone-200 p-4">
                <span className="text-sm font-medium text-stone-700">
                  総テスト数
                </span>
                <input
                  type="number"
                  min={1}
                  value={draftSettings.total_limit}
                  onChange={(e) =>
                    updateDraftNumber("total_limit", e.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              </label>
              <label className="block rounded-2xl border border-stone-200 p-4">
                <span className="text-sm font-medium text-stone-700">
                  実行回数
                </span>
                <input
                  type="number"
                  min={1}
                  value={draftSettings.rounds}
                  onChange={(e) => updateDraftNumber("rounds", e.target.value)}
                  className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              </label>
              <label className="block rounded-2xl border border-stone-200 p-4">
                <span className="text-sm font-medium text-stone-700">
                  攻撃パターン
                </span>
                <input
                  type="number"
                  min={1}
                  value={draftSettings.variants_per_base}
                  onChange={(e) =>
                    updateDraftNumber("variants_per_base", e.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-stone-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-stone-800">
                    攻撃カテゴリの割合
                  </div>
                  <div className="text-xs text-stone-500">
                    合計 {draftCategoryTotal}% / 100%
                  </div>
                </div>
                <div
                  className={`text-sm font-medium ${
                    draftCategoryTotal === 100
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }`}
                >
                  {draftCategoryTotal === 100 ? "OK" : "要調整"}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Object.entries(options.category_labels).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-sm text-stone-700">
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={draftSettings.category_distribution[key]}
                        onChange={(e) =>
                          updateDraftDistribution(
                            "category_distribution",
                            key,
                            e.target.value
                          )
                        }
                        className="w-full rounded-xl border border-stone-300 px-3 py-2"
                      />
                      <span className="text-sm text-stone-500">%</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-stone-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-stone-800">
                    会話モードの割合
                  </div>
                  <div className="text-xs text-stone-500">
                    合計 {draftConversationTotal}% / 100%
                  </div>
                </div>
                <div
                  className={`text-sm font-medium ${
                    draftConversationTotal === 100
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }`}
                >
                  {draftConversationTotal === 100 ? "OK" : "要調整"}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Object.entries(options.conversation_mode_labels).map(
                  ([key, label]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-sm text-stone-700">
                        {label}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={
                            draftSettings.conversation_mode_distribution[key]
                          }
                          onChange={(e) =>
                            updateDraftDistribution(
                              "conversation_mode_distribution",
                              key,
                              e.target.value
                            )
                          }
                          className="w-full rounded-xl border border-stone-300 px-3 py-2"
                        />
                        <span className="text-sm text-stone-500">%</span>
                      </div>
                    </label>
                  )
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-stone-200 p-4">
                <span className="text-sm font-medium text-stone-700">
                  実行順をランダムにする
                </span>
                <input
                  type="checkbox"
                  checked={draftSettings.shuffle_enabled}
                  onChange={(e) =>
                    setDraftSettings((prev) =>
                      prev
                        ? { ...prev, shuffle_enabled: e.target.checked }
                        : prev
                    )
                  }
                  className="h-4 w-4"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeSettingsModal}
                className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-medium text-white"
              >
                この設定を反映する
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
