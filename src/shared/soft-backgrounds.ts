export type CustomSoftBackgroundId = `custom:${string}`;

export interface CustomSoftBackground {
  id: CustomSoftBackgroundId;
  image: string;
  name: string;
}

export function isCustomSoftBackgroundId(
  value: string,
): value is CustomSoftBackgroundId {
  return value.startsWith("custom:");
}
