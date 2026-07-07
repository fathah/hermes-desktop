export type OwnerNotificationChannel =
  | "macos"
  | "telegram"
  | "email"
  | "whatsapp";

export type OwnerNotificationEvent = "brief" | "nag" | "alert" | "update";

export const OWNER_NOTIFICATION_CHANNELS: OwnerNotificationChannel[] = [
  "macos",
  "telegram",
  "email",
  "whatsapp",
];

export const OWNER_NOTIFICATION_EVENTS: OwnerNotificationEvent[] = [
  "brief",
  "nag",
  "alert",
  "update",
];

export interface OwnerNotificationQuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface OwnerNotificationPrefs {
  channels: Record<OwnerNotificationChannel, boolean>;
  events: Record<OwnerNotificationEvent, boolean>;
  targets: {
    telegramChatId: string;
    emailAddress: string;
    whatsappTarget: string;
  };
  quietHours: OwnerNotificationQuietHours;
  rateLimitMinutes: number;
}

export interface OwnerNotificationPrefsPatch {
  channels?: Partial<Record<OwnerNotificationChannel, boolean>>;
  events?: Partial<Record<OwnerNotificationEvent, boolean>>;
  targets?: Partial<OwnerNotificationPrefs["targets"]>;
  quietHours?: Partial<OwnerNotificationQuietHours>;
  rateLimitMinutes?: number;
}

export interface OwnerDeliverySummary {
  status: "not-configured" | "ok" | "warning" | "failed";
  summary: string;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

export const DEFAULT_OWNER_NOTIFICATION_PREFS: OwnerNotificationPrefs = {
  channels: {
    macos: true,
    telegram: false,
    email: false,
    whatsapp: false,
  },
  events: {
    brief: true,
    nag: true,
    alert: true,
    update: true,
  },
  targets: {
    telegramChatId: "",
    emailAddress: "",
    whatsappTarget: "",
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
  rateLimitMinutes: 10,
};
