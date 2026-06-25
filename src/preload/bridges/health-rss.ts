import { ipcRenderer } from "electron";
import type {
  SpsClinicalDigestArticle,
  SpsHealthBiometricLog,
  SpsHealthJournalEntry,
  SpsHealthMedicalDoc,
  SpsHealthMedicationLog,
  SpsHealthMedicationProtocol,
  SpsRssArticle,
  SpsRssFeed,
  SpsSubstackDiscoveryResult,
} from "../api-types";
import type { HealthRssBridgeApi } from "./health-rss.types";

type JsonRecord = Record<string, unknown>;

interface RssArticleQuery {
  feedId?: string;
  readStatus?: number;
  starStatus?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export const healthRssBridge = {
  spsHealthGetProfile: (profile?: string): Promise<JsonRecord | null> =>
    ipcRenderer.invoke("sps-health-get-profile", profile),
  spsHealthSaveProfile: (
    profileData: JsonRecord,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-save-profile", profileData, profile),
  spsHealthAddJournalEntry: (
    entry: JsonRecord,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-journal-entry", entry, profile),
  spsHealthGetJournalEntries: (
    profile?: string,
  ): Promise<SpsHealthJournalEntry[]> =>
    ipcRenderer.invoke("sps-health-get-journal-entries", profile),
  spsHealthDeleteJournalEntry: (
    entryId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-delete-journal-entry", entryId, profile),
  spsHealthAddBiometricLog: (
    log: JsonRecord,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-biometric-log", log, profile),
  spsHealthGetBiometricLogs: (
    profile?: string,
  ): Promise<SpsHealthBiometricLog[]> =>
    ipcRenderer.invoke("sps-health-get-biometric-logs", profile),
  spsHealthSaveMedicationProtocol: (
    protocol: JsonRecord,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke(
      "sps-health-save-medication-protocol",
      protocol,
      profile,
    ),
  spsHealthGetMedicationProtocols: (
    profile?: string,
  ): Promise<SpsHealthMedicationProtocol[]> =>
    ipcRenderer.invoke("sps-health-get-medication-protocols", profile),
  spsHealthDeleteMedicationProtocol: (
    protocolId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "sps-health-delete-medication-protocol",
      protocolId,
      profile,
    ),
  spsHealthAddMedicationLog: (
    log: JsonRecord,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-medication-log", log, profile),
  spsHealthGetMedicationLogs: (
    profile?: string,
  ): Promise<SpsHealthMedicationLog[]> =>
    ipcRenderer.invoke("sps-health-get-medication-logs", profile),
  spsHealthGetMedicalDocs: (profile?: string): Promise<SpsHealthMedicalDoc[]> =>
    ipcRenderer.invoke("sps-health-get-medical-docs", profile),
  spsHealthAddMedicalDoc: (
    doc: JsonRecord,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-medical-doc", doc, profile),
  spsHealthDeleteMedicalDoc: (
    docId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-delete-medical-doc", docId, profile),

  spsRssGetFeeds: (profile?: string): Promise<SpsRssFeed[]> =>
    ipcRenderer.invoke("sps-rss-get-feeds", profile),
  spsRssDiscoverSubstack: (
    inputUrl: string,
    profile?: string,
  ): Promise<SpsSubstackDiscoveryResult> =>
    ipcRenderer.invoke("sps-rss-discover-substack", inputUrl, profile),
  spsRssAddFeed: (feedData: JsonRecord, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-rss-add-feed", feedData, profile),
  spsRssDeleteFeed: (feedId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-rss-delete-feed", feedId, profile),
  spsRssGetArticles: (
    query?: RssArticleQuery,
    profile?: string,
  ): Promise<SpsRssArticle[]> =>
    ipcRenderer.invoke("sps-rss-get-articles", query, profile),
  spsRssMarkArticleRead: (
    articleId: string,
    readStatus: number,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "sps-rss-mark-article-read",
      articleId,
      readStatus,
      profile,
    ),
  spsRssToggleArticleStar: (
    articleId: string,
    starStatus: number,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "sps-rss-toggle-article-star",
      articleId,
      starStatus,
      profile,
    ),
  spsRssSyncFeeds: (
    profile?: string,
  ): Promise<{ success: boolean; count: number }> =>
    ipcRenderer.invoke("sps-rss-sync-feeds", profile),
  spsRssGetClinicalDigest: (
    profile?: string,
  ): Promise<SpsClinicalDigestArticle[]> =>
    ipcRenderer.invoke("sps-rss-get-clinical-digest", profile),
} satisfies HealthRssBridgeApi;
