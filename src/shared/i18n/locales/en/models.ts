export default {
  title: "Models",
  searchPlaceholder: "Search models...",
  empty: "No models yet",
  noMatch: "No models match your search",
  deleteConfirm: "Delete?",
  displayName: "Display Name",
  modelId: "Model ID",
  namePlaceholder: "e.g. Claude Sonnet 4",
  modelIdPlaceholder: "e.g. anthropic/claude-sonnet-4-20250514",
  baseUrlPlaceholder: "http://localhost:1234/v1",
  subtitle:
    "Manage your model library. These models will appear in the chat page model selector.",
  addModel: "Add Model",
  emptyHint:
    "After adding models here, you can use them in the chat page model selector. Models you configure in settings will also be automatically added here.",
  editModel: "Edit Model",
  update: "Update",
  deleteModelTitle: "Delete Model",
  yes: "Yes",
  no: "No",
  nameRequired: "Name and Model ID are required",
  customProviderHint: "Only required for custom or local providers",
  apiKeyLabel: "API Key",
  apiKeyHint:
    "Stored as an environment variable. Picks the matching env key based on the URL, or CUSTOM_API_KEY otherwise.",
} as const;
