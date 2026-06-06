// MockResearch.ts — offline/canned scholarly results. Used when the bridge is
// unavailable (sandboxed dev, no gateway) and seeded by the Playwright smoke
// harness so the Research flow can be exercised with no network.
import type { ResearchProvider } from "./ResearchProvider";
import type {
  WorkSummary,
  WorkDetail,
  SearchOpts,
} from "../../../../../shared/openalex/core";

const SAMPLE: WorkDetail[] = [
  {
    id: "W2741809807",
    title:
      "The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles",
    year: 2018,
    authors: ["Heather Piwowar", "Jason Priem", "Vincent Larivière"],
    venue: "PeerJ",
    citedByCount: 1043,
    isOA: true,
    oaUrl: "https://peerj.com/articles/4375.pdf",
    topics: ["Open access", "Scientometrics"],
    doi: "10.7717/peerj.4375",
    abstract:
      "Despite growing interest in Open Access to scholarly literature, there is an unmet need for large-scale, up-to-date, and reproducible studies assessing the prevalence and characteristics of OA.",
    referencedCount: 48,
    relatedIds: ["W1", "W2"],
  },
  {
    id: "W3000000001",
    title: "Deep learning for scholarly document understanding",
    year: 2021,
    authors: ["A. Researcher", "B. Scholar"],
    venue: "Journal of Demonstrations",
    citedByCount: 87,
    isOA: false,
    topics: ["Machine learning", "Information retrieval"],
    doi: "10.1000/demo.2021",
    abstract:
      "We survey methods for understanding scholarly documents, including citation analysis, abstract summarization, and topic modeling.",
    referencedCount: 64,
    relatedIds: [],
  },
];

export class MockResearch implements ResearchProvider {
  async searchWorks(q: string, _opts?: SearchOpts): Promise<WorkSummary[]> {
    void _opts;
    const needle = q.trim().toLowerCase();
    if (!needle) return SAMPLE;
    const hits = SAMPLE.filter(
      (w) =>
        w.title.toLowerCase().includes(needle) ||
        w.topics.some((t) => t.toLowerCase().includes(needle)),
    );
    return (hits.length ? hits : SAMPLE).map(toSummary);
  }

  async getWork(id: string): Promise<WorkDetail> {
    return SAMPLE.find((w) => w.id === id) ?? SAMPLE[0];
  }
}

function toSummary(w: WorkDetail): WorkSummary {
  const { abstract, referencedCount, relatedIds, ...summary } = w;
  void abstract;
  void referencedCount;
  void relatedIds;
  return summary;
}
