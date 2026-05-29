import { useState, useEffect } from "react";

function Dashboard({ profile }: { profile: string }): React.JSX.Element {
  const [stats, setStats] = useState<{
    sessionCount: number;
    modelProvider: string;
    modelName: string;
    gatewayRunning: boolean;
    cronJobCount: number;
  } | null>(null);

  useEffect(() => {
    window.hermesAPI.getDashboardStats(profile).then(setStats);
    const id = setInterval(() => {
      window.hermesAPI.getDashboardStats(profile).then(setStats);
    }, 15000);
    return () => clearInterval(id);
  }, [profile]);

  if (!stats) return <div className="screen-loading">Loading dashboard…</div>;

  return (
    <div className="dashboard-screen">
      <header className="screen-header">
        <h1 className="screen-title">Operations Dashboard</h1>
        <span className={`status-badge ${stats.gatewayRunning ? "connected" : "disconnected"}`}>
          {stats.gatewayRunning ? "Gateway connected" : "Gateway disconnected"}
        </span>
      </header>
      <div className="dashboard-grid">
        <div className="dashboard-card card">
          <h3>Sessions</h3>
          <p className="dashboard-stat">{stats.sessionCount}</p>
        </div>
        <div className="dashboard-card card">
          <h3>Active model</h3>
          <p>{stats.modelProvider} / {stats.modelName || "default"}</p>
        </div>
        <div className="dashboard-card card">
          <h3>Cron jobs</h3>
          <p className="dashboard-stat">{stats.cronJobCount}</p>
        </div>
        <div className="dashboard-card card attention">
          <h3>Attention</h3>
          {!stats.gatewayRunning && <p>Gateway is not running — activate a profile or send a chat message.</p>}
          {stats.gatewayRunning && <p>All systems operational.</p>}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
