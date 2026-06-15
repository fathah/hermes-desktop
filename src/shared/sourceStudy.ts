// sourceStudy.ts - source-agnostic study prompt for NotebookLM and SPS Wiki.
// Pure helper shared by renderer and main process.

export interface SourceStudyPromptOptions {
  corpusDescription?: string;
}

const DEFAULT_FOCUS = "the provided source corpus";
const DEFAULT_CORPUS =
  "Use the connected Knowledge Wiki, uploaded sources, transcripts, " +
  "articles, PDFs, notes, or NotebookLM notebook sources available in this run. " +
  "When NotebookLM MCP tools are available, use them to query notebook sources directly.";

export function buildSourceStudyPrompt(
  focus: string,
  options: SourceStudyPromptOptions = {},
): string {
  const cleanFocus = focus.trim() || DEFAULT_FOCUS;
  const cleanCorpus = options.corpusDescription?.trim() || DEFAULT_CORPUS;

  return [
    "You are my source-study tutor. Work only from the source corpus I have provided or explicitly connected. The corpus may include books, PDFs, web articles, YouTube transcripts, magazines, research papers, notes, or wiki pages.",
    "",
    "Do not summarize mechanically. Build an understanding map.",
    "",
    "Focus question or learning goal:",
    cleanFocus,
    "",
    "Corpus description:",
    cleanCorpus,
    "",
    "1. Central argument",
    "What is the single central claim, question, or problem this corpus is really about? What does the author, speaker, or source set believe that a smart reader might miss or disagree with?",
    "",
    "2. Core ideas first",
    "Identify the 5 most important ideas, mental models, or distinctions I must understand before the rest of the material makes sense. For each one, explain why it matters and cite the source location or source name.",
    "",
    "3. Reading/viewing map",
    "Separate the corpus into:",
    "- Core sections I should study carefully",
    "- Supporting examples, case studies, anecdotes, or repetition",
    "- Optional context I can skim",
    "- Material that appears weak, redundant, outdated, or off-topic",
    "",
    "4. Intellectual landscape",
    "Where do the sources agree? Where do they disagree? Name the 2-3 strongest disagreements and steelman each side before judging.",
    "",
    "5. Stress test",
    "What questions does this corpus fail to answer? Where is the evidence weakest? What would a hostile but fair critic say is wrong, incomplete, overstated, or underspecified?",
    "",
    "6. Understanding check",
    "Generate 10 questions that distinguish deep understanding from memorization. For each question, say what a shallow answer would miss.",
    "",
    "7. Compression",
    "Explain the core idea to a smart 14-year-old in exactly three sentences. Then name the single most actionable thing I should think, do, decide, or investigate differently after studying this corpus.",
    "",
    "8. Knowledge-wiki capture",
    "Produce a durable wiki note with:",
    "- Suggested title",
    "- 5-8 tags",
    "- Key claims with citations",
    "- Open questions",
    "- Related concepts or wikilinks I should connect later",
    "",
    "If the corpus does not contain enough evidence for any answer, say so directly and mark it as an evidence gap. Do not invent citations or pretend unsupported claims are grounded.",
  ].join("\n");
}
