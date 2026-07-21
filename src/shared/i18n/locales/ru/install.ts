export default {
  preparing: "Подготовка...",
  startingInstall: "Начало установки",
  installationComplete: "Установка завершена",
  installationFailed: "Установка не удалась",
  installingHermes: "Установка Hermes Agent",
  installationFailedHint:
    "Установка не удалась. Попробуйте снова или установите через терминал.",
  retryInstallation: "Повторить установку",
  copied: "Скопировано!",
  copyLogs: "Копировать логи",
  stepLabel: "Шаг {{step}}/{{total}}: {{title}}",
  waitingToStart: "Ожидание запуска...",
  continueToSetup: "Перейти к настройке",
  confirmTitle: "Перед установкой",
  confirmLocationLabel: "Hermes будет установлен в:",
  confirmFresh:
    "Здесь не найдена существующая установка — будет настроена новая копия.",
  confirmUpdate:
    "Здесь уже есть установка Hermes — она будет обновлена до последней версии.",
  confirmReplace:
    "Папка существует, но не содержит корректной установки Hermes — при установке она будет удалена и заменена.",
  confirmNotInherited:
    "Если вы устанавливали Hermes в другом месте или через командную строку, эта установка не будет перенесена.",
  confirmInstallBtn: "Установить Hermes",
  useExistingBtn: "Использовать существующую установку",
  useExistingHint:
    "Выберите папку с существующей установкой Hermes (ту, где находится папка hermes-agent).",
  useExistingInvalid: "В этой папке не найдена пригодная установка Hermes.",
  useExistingDone:
    "Существующая установка задана — перезапустите Hermes, чтобы применить изменения.",
  useExistingQuitBtn: "Выйти из Hermes",
} as const;
