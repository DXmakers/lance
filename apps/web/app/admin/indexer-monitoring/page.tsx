import { IndexerMonitoringDashboard } from '@/components/dashboard/indexer-monitoring';

export const metadata = {
  title: 'Indexer Monitoring',
  description: 'Real-time monitoring dashboard for the DisputeResolved event indexer',
};

export default function IndexerMonitoringPage() {
  return <IndexerMonitoringDashboard />;
}
