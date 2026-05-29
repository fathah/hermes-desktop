import { memo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ToolCallCardProps {
  name: string;
  argumentsJson: string;
  defaultOpen?: boolean;
}

export const ToolCallCard = memo(function ToolCallCard({
  name,
  argumentsJson,
  defaultOpen = false,
}: ToolCallCardProps): React.JSX.Element {
  let formatted = argumentsJson;
  try {
    formatted = JSON.stringify(JSON.parse(argumentsJson), null, 2);
  } catch {
    // keep raw
  }

  return (
    <details className="tool-call-card" open={defaultOpen}>
      <summary className="tool-call-card-header">
        <span className="tool-call-icon">⚡</span>
        <span className="tool-call-name">{name}</span>
      </summary>
      <div className="tool-call-card-body">
        <SyntaxHighlighter language="json" style={oneDark} customStyle={{ margin: 0, fontSize: 12, borderRadius: 6 }}>
          {formatted}
        </SyntaxHighlighter>
      </div>
    </details>
  );
});

export default ToolCallCard;
