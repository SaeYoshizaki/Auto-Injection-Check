"use client";

import { SingleReportPageClient } from "@/app/reports/single/[jobId]/page";

export default function ProfileReportPage({}: Record<string, never>) {
  return (
    <SingleReportPageClient
      routeParamKey="profileName"
      reportApiPath={(profileName) => `/api/reports/profile/${encodeURIComponent(profileName)}`}
      referenceLabel="AI名"
    />
  );
}
