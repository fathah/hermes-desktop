import type * as Api from "../api-types";

export interface HealthRssBridgeApi {
  spsHealthGetProfile: (
    profile?: string,
  ) => Promise<Api.SpsHealthProfile | null>;

  spsHealthSaveProfile: (
    profileData: Record<string, unknown>,
    profile?: string,
  ) => Promise<boolean>;

  spsHealthAddJournalEntry: (
    entry: Partial<Api.SpsHealthJournalEntry>,
    profile?: string,
  ) => Promise<string>;

  spsHealthGetJournalEntries: (
    profile?: string,
  ) => Promise<Api.SpsHealthJournalEntry[]>;

  spsHealthDeleteJournalEntry: (
    entryId: string,
    profile?: string,
  ) => Promise<boolean>;

  spsHealthAddBiometricLog: (
    log: Partial<Api.SpsHealthBiometricLog>,
    profile?: string,
  ) => Promise<string>;

  spsHealthGetBiometricLogs: (
    profile?: string,
  ) => Promise<Api.SpsHealthBiometricLog[]>;

  spsHealthSaveMedicationProtocol: (
    protocol: Partial<Api.SpsHealthMedicationProtocol>,
    profile?: string,
  ) => Promise<string>;

  spsHealthGetMedicationProtocols: (
    profile?: string,
  ) => Promise<Api.SpsHealthMedicationProtocol[]>;

  spsHealthDeleteMedicationProtocol: (
    protocolId: string,
    profile?: string,
  ) => Promise<boolean>;

  spsHealthAddMedicationLog: (
    log: Partial<Api.SpsHealthMedicationLog>,
    profile?: string,
  ) => Promise<string>;

  spsHealthGetMedicationLogs: (
    profile?: string,
  ) => Promise<Api.SpsHealthMedicationLog[]>;

  spsHealthGetMedicalDocs: (
    profile?: string,
  ) => Promise<Api.SpsHealthMedicalDoc[]>;

  spsHealthAddMedicalDoc: (
    doc: Partial<Api.SpsHealthMedicalDoc>,
    profile?: string,
  ) => Promise<string>;

  spsHealthDeleteMedicalDoc: (
    docId: string,
    profile?: string,
  ) => Promise<boolean>;

  // RSS APIs

  spsRssGetFeeds: (profile?: string) => Promise<Api.SpsRssFeed[]>;

  spsRssDiscoverSubstack: (
    inputUrl: string,
    profile?: string,
  ) => Promise<Api.SpsSubstackDiscoveryResult>;

  spsRssAddFeed: (
    feedData: Partial<Api.SpsRssFeed>,
    profile?: string,
  ) => Promise<string>;

  spsRssDeleteFeed: (feedId: string, profile?: string) => Promise<boolean>;

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
  ) => Promise<Api.SpsRssArticle[]>;

  spsRssMarkArticleRead: (
    articleId: string,
    readStatus: number,
    profile?: string,
  ) => Promise<boolean>;

  spsRssToggleArticleStar: (
    articleId: string,
    starStatus: number,
    profile?: string,
  ) => Promise<boolean>;

  spsRssSyncFeeds: (
    profile?: string,
  ) => Promise<{ success: boolean; count: number }>;

  spsRssGetClinicalDigest: (
    profile?: string,
  ) => Promise<Api.SpsClinicalDigestArticle[]>;
}
