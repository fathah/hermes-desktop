import HomeSection from "./HomeSection";

interface TaskQueueItem {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "done";
}

interface HomeTaskQueueProps {
  tasks: TaskQueueItem[];
  onToggleTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onClearCompleted: () => void;
}

export default function HomeTaskQueue({
  tasks,
  onToggleTask,
  onOpenTask,
  onClearCompleted,
}: HomeTaskQueueProps): React.JSX.Element | null {
  if (tasks.length === 0) return null;

  return (
    <HomeSection
      title="Task queue"
      actions={
        <button className="content-event-dismiss" onClick={onClearCompleted}>
          Clear done
        </button>
      }
    >
      <div className="content-event-list">
        {tasks.map((task) => (
          <div key={task.id} className={`content-event-item tone-${task.status === "done" ? "success" : "info"}`}>
            <button className="content-task-open" onClick={() => onOpenTask(task.id)}>
              <div className="content-event-item-title">{task.title}</div>
              <div className="content-event-item-detail">{task.detail}</div>
            </button>
            <button className={`content-launcher-pin ${task.status === "done" ? "active" : ""}`} onClick={() => onToggleTask(task.id)}>
              {task.status === "done" ? "Done" : "Mark done"}
            </button>
          </div>
        ))}
      </div>
    </HomeSection>
  );
}
