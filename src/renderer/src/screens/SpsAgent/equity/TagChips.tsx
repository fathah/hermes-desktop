// Hashtag editor for a report row. Auto-tags (sector/rating/PSU…) are read-only;
// user tags are editable chips. Persistence is the parent's job (updateUserTags).
import React, { useState } from "react";

export function TagChips({
  autoTags,
  userTags,
  onChange,
}: {
  autoTags: string[];
  userTags: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");

  const add = (): void => {
    const t = input.trim().replace(/^#/, "");
    if (t && !userTags.includes(t)) onChange([...userTags, t]);
    setInput("");
  };
  const remove = (t: string): void => onChange(userTags.filter((x) => x !== t));

  return (
    <div className="eq-tags">
      {autoTags.map((t) => (
        <span key={`a-${t}`} className="eq-tag eq-tag-auto" title="auto tag">
          #{t}
        </span>
      ))}
      {userTags.map((t) => (
        <span
          key={`u-${t}`}
          className="eq-tag eq-tag-user"
          onClick={() => remove(t)}
          title="click to remove"
        >
          #{t} ×
        </span>
      ))}
      <input
        className="eq-tag-input"
        value={input}
        placeholder="#tag"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        onBlur={add}
      />
    </div>
  );
}
