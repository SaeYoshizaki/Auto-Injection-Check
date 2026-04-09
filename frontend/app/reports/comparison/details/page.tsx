"use client";

import Link from "next/link";
import {
  ComparisonDetailsSections,
  ComparisonReportHeader,
  ErrorPanel,
  LoadingPanel,
  SimpleToc,
  useComparisonReportData,
} from "../report-shared";

const DETAILS_TOC_ITEMS = [
  { id: "settings-list", label: "AI設定一覧" },
  { id: "scoreboard", label: "AI別スコアボード" },
  { id: "charts", label: "図表" },
  { id: "ai-details", label: "AI種類別詳細結果" },
];

export default function ComparisonReportDetailsPage() {
  const {
    report,
    error,
    dangerousCount,
    warningCount,
    aiCounts,
  } = useComparisonReportData();

  if (error) {
    return <ErrorPanel title="比較レポート詳細" message={error} />;
  }

  if (!report) {
    return <LoadingPanel message="詳細レポートを読み込んでいます..." />;
  }

  return (
    <div className="min-h-screen bg-white">
      <ComparisonReportHeader
        report={report}
        dangerousCount={dangerousCount}
        warningCount={warningCount}
        title={`${report.report_title} 詳細分析`}
        description={`セッション ${report.basic_info.session_id} / 根拠確認のための詳細ページ`}
        actions={
          <Link
            href="/reports/comparison"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            結論ページへ戻る
          </Link>
        }
      />

      <div className="mx-auto max-w-5xl space-y-12 px-6 py-12 sm:px-8">
        <section>
          <SimpleToc items={DETAILS_TOC_ITEMS} />
        </section>

        <ComparisonDetailsSections
          report={report}
          aiCounts={aiCounts}
        />
      </div>
    </div>
  );
}
