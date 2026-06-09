import { Signal } from "../assets/icons";
import { switchToLocal } from "../lib/spsCommands";

function RemoteNotice({ feature }: { feature: string }): React.JSX.Element {
  return (
    <div className="remote-notice">
      <Signal size={28} className="remote-notice-icon" />
      <p className="remote-notice-title">Connected to remote Hermes</p>
      <p className="remote-notice-desc">
        {feature} is not available in remote mode. This data lives on the server
        and is not accessible through the API yet.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => switchToLocal()}
        style={{ marginTop: 16 }}
      >
        Switch to local mode
      </button>
    </div>
  );
}

export default RemoteNotice;
