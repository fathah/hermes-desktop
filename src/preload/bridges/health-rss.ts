import { ipcRenderer } from "electron";

export const healthRssBridge = {
  spsHealthGetProfile: (profile?: string): Promise<any> =>
    ipcRenderer.invoke("sps-health-get-profile", profile),
  spsHealthSaveProfile: (
    profileData: any,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-save-profile", profileData, profile),
  spsHealthAddJournalEntry: (entry: any, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-journal-entry", entry, profile),
  spsHealthGetJournalEntries: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-health-get-journal-entries", profile),
  spsHealthDeleteJournalEntry: (
    entryId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-delete-journal-entry", entryId, profile),
  spsHealthAddBiometricLog: (log: any, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-biometric-log", log, profile),
  spsHealthGetBiometricLogs: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-health-get-biometric-logs", profile),
  spsHealthSaveMedicationProtocol: (
    protocol: any,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke(
      "sps-health-save-medication-protocol",
      protocol,
      profile,
    ),
  spsHealthGetMedicationProtocols: (profile?: string): Promise<any[]> =>
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
  spsHealthAddMedicationLog: (log: any, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-medication-log", log, profile),
  spsHealthGetMedicationLogs: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-health-get-medication-logs", profile),
  spsHealthGetMedicalDocs: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-health-get-medical-docs", profile),
  spsHealthAddMedicalDoc: (doc: any, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-health-add-medical-doc", doc, profile),
  spsHealthDeleteMedicalDoc: (
    docId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-health-delete-medical-doc", docId, profile),

  spsRssGetFeeds: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-rss-get-feeds", profile),
  spsRssAddFeed: (feedData: any, profile?: string): Promise<string> =>
    ipcRenderer.invoke("sps-rss-add-feed", feedData, profile),
  spsRssDeleteFeed: (feedId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-rss-delete-feed", feedId, profile),
  spsRssGetArticles: (
    query?: {
      feedId?: string;
      readStatus?: number;
      starStatus?: number;
      search?: string;
      limit?: number;
      offset?: number;
    },
    profile?: string,
  ): Promise<any[]> =>
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
  spsRssGetClinicalDigest: (profile?: string): Promise<any[]> =>
    ipcRenderer.invoke("sps-rss-get-clinical-digest", profile),
};
