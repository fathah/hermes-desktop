export interface TeachCapturePromptInput {
  captureId: string;
  title?: string;
  corpusDescription: string;
}

export function buildTeachCapturePrompt(
  input: TeachCapturePromptInput,
): string {
  const title = input.title?.trim() || "Untitled capture";
  return [
    "You are my visual-capture tutor. Work only from the OCR text, notes, and capture metadata provided below.",
    "",
    `Capture: ${input.captureId}`,
    `Title: ${title}`,
    "",
    "Your job:",
    "- Segment the captured material into questions or prompts when present.",
    "- For each question, give the answer plus a worked answer with clear reasoning.",
    "- Add pedagogy: identify prerequisites, explain the method, and point out common mistakes.",
    "- If the capture is a note or page rather than a question set, summarize the teachable concepts and create a short study walkthrough.",
    "- If OCR is missing, low confidence, or ambiguous, say exactly what is uncertain.",
    "- Do not invent unreadable questions, answer hidden text, or pretend unclear content is understood.",
    "",
    "Captured corpus:",
    input.corpusDescription.trim() ||
      "No OCR text or note content was provided.",
  ].join("\n");
}
