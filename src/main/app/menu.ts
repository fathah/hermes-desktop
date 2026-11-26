import { app, type BrowserWindow, Menu } from "electron";
import { is } from "@electron-toolkit/utils";
import { localizeDefinition } from "../../shared/i18n/definitions";

interface MenuDeps {
  getMainWindow: () => BrowserWindow | null;
  openExternalUrl: (rawUrl: unknown) => void;
}

export function buildMenu({ getMainWindow, openExternalUrl }: MenuDeps): void {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: localizeDefinition("Chat"),
      submenu: [
        {
          label: localizeDefinition("New Chat"),
          accelerator: "CmdOrCtrl+N",
          click: () => getMainWindow()?.webContents.send("menu-new-chat"),
        },
        { type: "separator" },
        {
          label: localizeDefinition("Search Sessions"),
          accelerator: "CmdOrCtrl+K",
          click: () =>
            getMainWindow()?.webContents.send("menu-search-sessions"),
        },
      ],
    },
    {
      label: localizeDefinition("Edit"),
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: localizeDefinition("View"),
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: localizeDefinition("Window"),
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: localizeDefinition("Help"),
      submenu: [
        ...(!is.dev
          ? [
              {
                label: localizeDefinition("Toggle Developer Tools"),
                accelerator: "Alt+Command+I",
                click: () => getMainWindow()?.webContents.toggleDevTools(),
              },
              { type: "separator" as const },
            ]
          : []),
        {
          label: localizeDefinition("Hermes Agent on GitHub"),
          click: () =>
            openExternalUrl("https://github.com/NousResearch/hermes-agent/"),
        },
        {
          label: localizeDefinition("Report an Issue"),
          click: () =>
            openExternalUrl("https://github.com/fathah/hermes-desktop/issues"),
        },
      ],
    },
  ] as Electron.MenuItemConstructorOptions[];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
