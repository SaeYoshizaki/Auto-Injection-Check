"use client";

import { useState } from "react";

type ScanStatus = "idle" | "loading" | "success" | "error";

type JobState = "queued" | "running" | "completed" | "failed";

type ScanResponse = {
  status: string;
  job_id: string;
  mode: string;
  is_random: boolean;
};

type ScanJobResult = {
  status: JobState | string;
  job_id: string;
  mode?: string;
  is_random?: boolean;
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

export default function Home() {
  const [formData, setFormData] = useState({
    url: "https://ai-chat.third-scope.com/ts/chat",
    organization: "",
    username: "",
    password: "",
    mode: "smoke",
    is_random: false,
  });

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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const val =
      type === "checkbox" ? (e.target as HTMLInputElement).checked : value;

    setFormData((prev) => ({
      ...prev,
      [name]: val,
    }));
  };

  const pollScanStatus = async (scanJobId: string) => {
    const maxAttempts = 300;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/scan/${scanJobId}`);
        const data: ScanJobResult = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(data?.status || "failed to fetch scan result");
          return;
        }

        const currentStatus = String(data.status || "");
        if (currentStatus === "queued" || currentStatus === "running") {
          setJobStatus(currentStatus as JobState);
          setMessage(
            `scan in progress...\nJob ID: ${scanJobId}\nStatus: ${currentStatus}`
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
          setMessage(`scan completed\nJob ID: ${scanJobId}\nStatus: completed`);
          return;
        }

        setJobStatus("failed");
        setStatus("error");
        setMessage(
          `scan failed\nJob ID: ${scanJobId}\nStatus: ${currentStatus}`
        );
        return;
      } catch (error) {
        console.error(error);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    setJobStatus("failed");
    setStatus("error");
    setMessage(`scan polling timed out\nJob ID: ${scanJobId}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setJobStatus("queued");
    setJobId("");
    setResultLinks({});
    setMessage("scan request submitted...");

    try {
      const res = await fetch("http://127.0.0.1:8000/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data: ScanResponse = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage("request failed");
        return;
      }

      setJobId(data.job_id);
      setMessage(
        `scan accepted\nJob ID: ${data.job_id}\nMode: ${
          data.mode || formData.mode
        }\nPrompt Source: ${
          formData.is_random ? "Category Sample" : "Benchmark Set"
        }\nStatus: queued`
      );

      await pollScanStatus(data.job_id);
    } catch (error) {
      setStatus("error");
      setMessage("connection failed");
      console.error(error);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-black">
      <div className="max-w-xl w-full bg-white rounded-xl shadow-lg p-8 border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          AI Security Scanner
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target URL
              </label>
              <input
                type="text"
                name="url"
                value={formData.url}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization ID
              </label>
              <input
                type="text"
                name="organization"
                value={formData.organization}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                name="username"
                placeholder="Username"
                value={formData.username}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md"
                required
              />
              <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md"
                required
              />
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="bg-gray-50 p-4 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scan Mode
              </label>
              <select
                name="mode"
                value={formData.mode}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md bg-white"
              >
                <optgroup label="Set-Based Modes">
                  <option value="smoke">Smoke (representative)</option>
                  <option value="risk_discovery">
                    Risk Discovery (representative + high_risk)
                  </option>
                  <option value="stability_audit">
                    Stability Audit (stability)
                  </option>
                  <option value="full_assessment">Full Assessment (all)</option>
                </optgroup>
                <optgroup label="Legacy Fixed Modes">
                  <option value="JP-test1">JP-test 1</option>
                  <option value="JP-test2">JP-test 2</option>
                  <option value="JP-test3">JP-test 3</option>
                  <option value="test1">test 1</option>
                  <option value="test2">test 2</option>
                  <option value="test3">test 3</option>
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep</option>
                </optgroup>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-700">
                  Prompt Source
                </span>
                <p className="text-xs text-gray-400">
                  Off = Benchmark Set / On = Category Sample
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="is_random"
                  checked={formData.is_random}
                  onChange={handleChange}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={status === "loading"}
            className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all ${
              status === "loading"
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 shadow-md active:scale-[0.98]"
            }`}
          >
            {status === "loading" ? "processing..." : "Start Security Scan"}
          </button>
        </form>

        {message && (
          <div
            className={`mt-6 p-4 rounded-md whitespace-pre-line text-sm ${
              status === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : status === "error"
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-blue-50 text-blue-800"
            }`}
          >
            {message}
          </div>
        )}

        {jobId && (
          <div className="mt-4 text-xs text-gray-500">
            <div>Job ID: {jobId}</div>
            <div>Status: {jobStatus || "queued"}</div>
          </div>
        )}

        {(resultLinks.report_file ||
          resultLinks.summary_json ||
          resultLinks.summary_csv) && (
          <div className="mt-6 rounded-md border border-gray-200 p-4 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              Scan Results
            </h2>
            <div className="space-y-2 text-sm">
              {resultLinks.report_file && (
                <div>
                  <span className="font-medium">PDF Report:</span>{" "}
                  <span className="text-gray-700">
                    {resultLinks.report_file}
                  </span>
                </div>
              )}
              {resultLinks.summary_json && (
                <div>
                  <span className="font-medium">Summary JSON:</span>{" "}
                  <span className="text-gray-700">
                    {resultLinks.summary_json}
                  </span>
                </div>
              )}
              {resultLinks.summary_csv && (
                <div>
                  <span className="font-medium">Summary CSV:</span>{" "}
                  <span className="text-gray-700">
                    {resultLinks.summary_csv}
                  </span>
                </div>
              )}
              {resultLinks.log_dir && (
                <div>
                  <span className="font-medium">Log Dir:</span>{" "}
                  <span className="text-gray-700">{resultLinks.log_dir}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
