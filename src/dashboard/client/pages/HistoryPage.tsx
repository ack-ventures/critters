import type { DashboardData } from "../../dashboard-data.js";
import { ActivityTable } from "../components/ActivityTable.js";
import { PageHeader } from "../components/PageHeader.js";

interface Props {
  data: DashboardData;
}

export function HistoryPage({ data }: Props) {
  const total = data.activity.length;
  return (
    <>
      <PageHeader title="History" subtitle={`${total} run${total === 1 ? "" : "s"} in memory`} />
      <ActivityTable data={data} />
    </>
  );
}
