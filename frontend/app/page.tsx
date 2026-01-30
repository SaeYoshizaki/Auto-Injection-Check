"use client";

import { useState } from "react";

export default function Home() {
  const [formData, setFormData] = useState({
    url: "https://ai-chat.third-scope.com/ts/chat",
    organization: "",
    username: "",
    password: "",
    mode: "quick",
    is_random: false,
  });

  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const val =
      type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setFormData({ ...formData, [name]: val });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("scan in progress...");

    try {
      const res = await fetch("http://127.0.0.1:8000/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage(
          `scan accepted\nMode: ${data.mode}\nType: ${
            formData.is_random ? "Random" : "Fixed (Benchmark)"
          }`
        );
      } else {
        setStatus("error");
        setMessage(data.detail || "request failed");
      }
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
                <option value="test">Test (3件)</option>
                <option value="quick">Quick (50件)</option>
                <option value="standard">Standard (120件)</option>
                <option value="deep">Deep (300件)</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-700">
                  ランダムスキャン
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="is_random"
                  checked={formData.is_random}
                  onChange={handleChange}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
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
      </div>
    </main>
  );
}
