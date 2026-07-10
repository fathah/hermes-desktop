import HomeSection from "./HomeSection";

interface DashboardMetric {
  key: string;
  label: string;
  value: string;
  detail: string;
}

interface HealthDiagnostic {
  key: string;
  label: string;
  value: string;
  detail: string;
}

interface HomeDashboardProps {
  metrics: DashboardMetric[];
  health: HealthDiagnostic[];
  onNavigateMetric: (metricKey: string) => void;
}

export default function HomeDashboard({
  metrics,
  health,
  onNavigateMetric,
}: HomeDashboardProps): React.JSX.Element | null {
  if (metrics.length === 0 && health.length === 0) return null;

  return (
    <HomeSection title="Dashboard">
      {metrics.length > 0 && (
        <div className="content-dashboard-grid">
          {metrics.map((metric) => (
            <button
              key={metric.key}
              className="content-dashboard-card"
              onClick={() => onNavigateMetric(metric.key)}
            >
              <span className="content-dashboard-card-label">{metric.label}</span>
              <span className="content-dashboard-card-value">{metric.value}</span>
              <span className="content-dashboard-card-detail">{metric.detail}</span>
            </button>
          ))}
        </div>
      )}

      {health.length > 0 && (
        <div className="content-health-grid">
          {health.map((item) => (
            <div key={item.key} className="content-health-card">
              <span className="content-health-card-label">{item.label}</span>
              <span className="content-health-card-value">{item.value}</span>
              <span className="content-health-card-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      )}
    </HomeSection>
  );
}
