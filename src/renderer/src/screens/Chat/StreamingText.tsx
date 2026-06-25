import { memo } from "react";

interface StreamingTextProps {
  children: string;
}

export const StreamingText = memo(function StreamingText({
  children,
}: StreamingTextProps): React.JSX.Element {
  return <div className="chat-streaming-text">{children}</div>;
});
