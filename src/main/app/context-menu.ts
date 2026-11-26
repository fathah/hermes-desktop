import { type BrowserWindow, Menu } from "electron";
import { localizeDefinition } from "../../shared/i18n/definitions";

export function showChatContextMenu(
  mainWindow: BrowserWindow | null,
  params: Electron.ContextMenuParams,
): void {
  const { editFlags, isEditable } = params;
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (isEditable) {
    template.push(
      { role: "cut", enabled: editFlags.canCut },
      { role: "copy", enabled: editFlags.canCopy },
      { role: "paste", enabled: editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll" },
    );
  } else {
    template.push(
      { role: "copy", enabled: editFlags.canCopy },
      { type: "separator" },
      {
        label: localizeDefinition("Select All"),
        click: () =>
          mainWindow?.webContents.send("context-menu-select-bubble", {
            x: params.x,
            y: params.y,
          }),
      },
    );
  }
  template.push(
    { type: "separator" },
    {
      label: localizeDefinition("Copy entire chat (text)"),
      click: () =>
        mainWindow?.webContents.send("context-menu-copy-chat", "text"),
    },
    {
      label: localizeDefinition("Copy entire chat (Markdown)"),
      click: () =>
        mainWindow?.webContents.send("context-menu-copy-chat", "markdown"),
    },
  );
  Menu.buildFromTemplate(template).popup();
}
