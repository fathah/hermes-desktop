import HomeSection from "./HomeSection";

interface EventItem {
  id: string;
  title: string;
  detail: string;
  timestamp: number;
  tone: "info" | "success" | "warning" | "error";
}

interface HomeEventsProps {
  events: EventItem[];
  onDismissEvent: (eventId: string) => void;
}

export default function HomeEvents({ events, onDismissEvent }: HomeEventsProps): React.JSX.Element {
  return (
    <HomeSection title="Event center" actions={<span className="content-event-center-count">{events.length} events</span>}>
      <div className="content-event-list">
        {events.length === 0 ? (
          <div className="content-event-empty">No shell events yet.</div>
        ) : (
          events.map((event) => (
            <div key={event.id} className={`content-event-item tone-${event.tone}`}>
              <div className="content-event-item-header">
                <span className="content-event-item-title">{event.title}</span>
                <div className="content-event-item-actions">
                  <span className="content-event-item-time">
                    {new Date(event.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button className="content-event-dismiss" onClick={() => onDismissEvent(event.id)}>
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="content-event-item-detail">{event.detail}</div>
            </div>
          ))
        )}
      </div>
    </HomeSection>
  );
}
