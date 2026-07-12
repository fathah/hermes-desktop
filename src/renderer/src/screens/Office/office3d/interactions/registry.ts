/**
 * Space representatives: the staff NPCs in the city's transaction spaces that
 * agents can do business with (bank tellers now; showroom sales, building
 * space later). The 3D side of a representative is the interior's StaffPerson
 * wrapped in an Interactable; this registry holds its identity and the
 * actions its interaction menu offers. Adding a new space's representative is
 * one entry here, i18n strings, an Interactable hookup in the interior, and
 * (if the space needs new capabilities) action wiring in RepInteractionPanel.
 */

export type RepActionId =
  | "checkBalance"
  | "accountStatus"
  | "createAccount"
  | "sendMoney";

export interface RepAction {
  id: RepActionId;
  /** i18n key under the `office.` namespace. */
  labelKey: string;
  /** Shown but not yet executable (renders a "coming soon" caption). */
  disabled?: boolean;
}

export interface SpaceRepresentative {
  id: string;
  /** The space this rep belongs to ("bank", "showroom", ...). */
  spaceId: string;
  /** i18n key for the rep's display name (e.g. "Bank Teller"). */
  labelKey: string;
  /** i18n key for the space's display name (e.g. "Bank"). */
  spaceLabelKey: string;
  actions: RepAction[];
}

export const REPRESENTATIVES: SpaceRepresentative[] = [
  {
    id: "bank-teller",
    spaceId: "bank",
    labelKey: "repBankTeller",
    spaceLabelKey: "spaceBank",
    actions: [
      { id: "checkBalance", labelKey: "repActionCheckBalance" },
      { id: "accountStatus", labelKey: "repActionAccountStatus" },
      { id: "createAccount", labelKey: "repActionCreateAccount" },
      { id: "sendMoney", labelKey: "repActionSendMoney", disabled: true },
    ],
  },
];

export function getRepresentative(
  id: string | null | undefined,
): SpaceRepresentative | null {
  if (!id) return null;
  return REPRESENTATIVES.find((rep) => rep.id === id) ?? null;
}
