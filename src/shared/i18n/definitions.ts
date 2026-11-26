import { getLocale, type AppLocale } from "./index";

/**
 * Definitions that live outside the i18n namespaces: messaging-platform field
 * labels, toolset cards, slash-command descriptions, main-process menu and
 * dialog strings. They are keyed by their English source text so the data
 * modules stay readable, and are resolved to the active locale at render time.
 */
export const DEFINITIONS_BE: Record<string, string> = {
  // ── Toolset cards ────────────────────────────────────────────────────────
  "Web search": "Вэб-пошук",
  "Use the configured Hermes web/search backend. This still requires a working web backend in config.":
    "Выкарыстоўвае наладжаны ў Hermes бэкенд вэб-пошуку. Усё яшчэ патрабуе працоўнага вэб-бэкенда ў канфігурацыі.",
  Browser: "Браўзер",
  "Use a local browser session for live web pages without a separate search provider.":
    "Выкарыстоўвае лакальную сесію браўзера для жывых вэб-старонак без асобнага правайдэра пошуку.",
  Terminal: "Тэрмінал",
  "Run shell commands on this machine from the messaging platform.":
    "Выконвае каманды абалонкі на гэтай машыне з платформы паведамленняў.",
  Files: "Файлы",
  "Read and write files reachable by Hermes from the messaging platform.":
    "Чытае і запісвае файлы, даступныя Hermes, з платформы паведамленняў.",
  "Code execution": "Выкананне кода",
  "Run local code execution tools from the messaging platform.":
    "Запускае лакальныя інструменты выканання кода з платформы паведамленняў.",
  Vision: "Бачанне",
  "Analyze images sent through the messaging platform.":
    "Аналізуе выявы, дасланыя праз платформу паведамленняў.",
  "Image generation": "Генерацыя выяў",
  "Generate images from the messaging platform.":
    "Генеруе выявы з платформы паведамленняў.",
  "Text to speech": "Сінтэз маўлення",
  "Create speech/audio responses from messages.":
    "Стварае маўленчыя і аўдыёадказы на паведамленні.",
  Skills: "Навыкі",
  "List, inspect, and manage Hermes skills.":
    "Паказвае, аглядае і кіруе навыкамі Hermes.",
  Memory: "Памяць",
  "Read and update Hermes memory.": "Чытае і абнаўляе памяць Hermes.",
  "Session search": "Пошук па сесіях",
  "Search previous Hermes sessions.": "Шукае ў папярэдніх сесіях Hermes.",
  Clarify: "Удакладненне",
  "Ask clarification questions before acting.":
    "Задае ўдакладняльныя пытанні перад дзеяннем.",
  Schedules: "Расклады",
  "Create and manage scheduled jobs.":
    "Стварае і кіруе запланаванымі задачамі.",
  Todos: "Задачы",
  "Manage task lists and temporary todos.":
    "Кіруе спісамі задач і тымчасовымі задачамі.",
  Messaging: "Паведамленні",
  "Send messages through configured messaging platforms.":
    "Дасылае паведамленні праз наладжаныя платформы паведамленняў.",
  Kanban: "Канбан",
  "Read and manage Hermes kanban tasks.":
    "Чытае і кіруе задачамі Канбана Hermes.",
  Delegation: "Дэлегаванне",
  "Delegate work to other agents.": "Перадае працу іншым агентам.",
  "Mixture of agents": "Ансамбль агентаў",
  "Use multiple agents for comparison or consensus.":
    "Выкарыстоўвае некалькі агентаў для параўнання або кансэнсусу.",

  // ── Messaging platform field descriptions ────────────────────────────────
  "Telegram bot token from BotFather": "Токен бота Telegram ад BotFather",
  "Comma-separated Telegram user IDs allowed to use the bot":
    "ID карыстальнікаў Telegram, якім дазволена карыстацца ботам (праз коску)",
  "Optional proxy URL used by the Telegram adapter":
    "Неабавязковы URL проксі для адаптара Telegram",
  "Discord bot token from the Developer Portal":
    "Токен бота Discord з партала распрацоўшчыкаў",
  "Comma-separated Discord user IDs allowed to use the bot":
    "ID карыстальнікаў Discord, якім дазволена карыстацца ботам (праз коску)",
  "Legacy allow-list for Discord channels":
    "Стары спіс дазволеных каналаў Discord",
  "Discord reply behavior used by the gateway":
    "Паводзіны адказаў Discord, якія выкарыстоўвае шлюз",
  "Slack bot token (xoxb-...)": "Токен бота Slack (xoxb-…)",
  "Slack Socket Mode app token (xapp-...)":
    "Токен праграмы Slack Socket Mode (xapp-…)",
  "Mattermost server base URL": "Базавы URL сервера Mattermost",
  "Mattermost personal access token": "Асабісты токен доступу Mattermost",
  "Comma-separated Mattermost users allowed to use the bot":
    "Карыстальнікі Mattermost, якім дазволена карыстацца ботам (праз коску)",
  "Matrix homeserver URL": "URL хатняга сервера Matrix",
  "Matrix account access token": "Токен доступу да акаўнта Matrix",
  "Matrix user ID, e.g. @hermes:example.org":
    "ID карыстальніка Matrix, напр. @hermes:example.org",
  "Comma-separated Matrix users allowed to use the bot":
    "Карыстальнікі Matrix, якім дазволена карыстацца ботам (праз коску)",
  "signal-cli REST API base URL, e.g. http://127.0.0.1:8080":
    "Базавы URL REST API signal-cli, напр. http://127.0.0.1:8080",
  "Signal account phone number registered with the bridge":
    "Нумар тэлефона акаўнта Signal, зарэгістраваны ў мастку",
  "Comma-separated Signal users allowed to use the bot":
    "Карыстальнікі Signal, якім дазволена карыстацца ботам (праз коску)",
  "Legacy Desktop Signal phone number setting":
    "Старая налада нумара тэлефона Signal для праграмы",
  "Enable the WhatsApp gateway adapter":
    "Уключыць адаптар шлюза WhatsApp",
  "WhatsApp bridge mode": "Рэжым мастка WhatsApp",
  "Comma-separated WhatsApp users allowed to use the bot":
    "Карыстальнікі WhatsApp, якім дазволена карыстацца ботам (праз коску)",
  "Legacy Desktop WhatsApp bridge URL":
    "Стары URL мастка WhatsApp для праграмы",
  "Legacy Desktop WhatsApp bridge token":
    "Стары токен мастка WhatsApp для праграмы",
  "BlueBubbles server URL": "URL сервера BlueBubbles",
  "BlueBubbles server password": "Пароль сервера BlueBubbles",
  "Comma-separated iMessage senders allowed to use the bot":
    "Адпраўнікі iMessage, якім дазволена карыстацца ботам (праз коску)",
  "Legacy Desktop BlueBubbles server URL":
    "Стары URL сервера BlueBubbles для праграмы",
  "Home Assistant base URL, e.g. https://homeassistant.local:8123":
    "Базавы URL Home Assistant, напр. https://homeassistant.local:8123",
  "Long-lived access token from Home Assistant":
    "Доўгатэрміновы токен доступу Home Assistant",
  "Email address to send and receive from":
    "Адрас электроннай пошты для дасылання і атрымання",
  "Email account password or app password":
    "Пароль акаўнта электроннай пошты або пароль праграмы",
  "IMAP server host, e.g. imap.gmail.com":
    "Хост сервера IMAP, напр. imap.gmail.com",
  "SMTP server host, e.g. smtp.gmail.com":
    "Хост сервера SMTP, напр. smtp.gmail.com",
  "Legacy Desktop IMAP server setting":
    "Старая налада сервера IMAP для праграмы",
  "Legacy Desktop SMTP server setting":
    "Старая налада сервера SMTP для праграмы",
  "Twilio Account SID": "SID акаўнта Twilio",
  "Twilio Auth Token": "Токен аўтэнтыфікацыі Twilio",
  "Legacy Desktop Twilio sender number":
    "Стары нумар адпраўніка Twilio для праграмы",
  "Legacy Desktop SMS provider setting":
    "Старая налада SMS-правайдэра для праграмы",
  "DingTalk client ID (App key)": "ID кліента DingTalk (ключ праграмы)",
  "DingTalk client secret (App secret)":
    "Сакрэт кліента DingTalk (сакрэт праграмы)",
  "Legacy Desktop DingTalk app key":
    "Стары ключ праграмы DingTalk для праграмы",
  "Legacy Desktop DingTalk app secret":
    "Стары сакрэт праграмы DingTalk для праграмы",
  "Feishu / Lark app ID": "ID праграмы Feishu / Lark",
  "Feishu / Lark app secret": "Сакрэт праграмы Feishu / Lark",
  "Feishu / Lark encrypt key": "Ключ шыфравання Feishu / Lark",
  "Feishu / Lark verification token": "Токен праверкі Feishu / Lark",
  "WeCom group bot ID": "ID групавога бота WeCom",
  "WeCom group bot secret": "Сакрэт групавога бота WeCom",
  "WeCom corp ID": "ID карпарацыі WeCom",
  "WeCom app corp secret": "Карпаратыўны сакрэт праграмы WeCom",
  "WeCom app agent ID": "ID агента праграмы WeCom",
  "WeCom callback verification token":
    "Токен праверкі зваротнага выкліку WeCom",
  "WeCom callback AES encoding key":
    "Ключ кадавання AES для зваротных выклікаў WeCom",
  "Legacy Desktop WeCom corp ID": "Стары ID карпарацыі WeCom для праграмы",
  "Legacy Desktop WeCom agent ID": "Стары ID агента WeCom для праграмы",
  "WeChat Official Account ID": "ID афіцыйнага акаўнта WeChat",
  "WeChat callback token": "Токен зваротнага выкліку WeChat",
  "WeChat platform base URL": "Базавы URL платформы WeChat",
  "Legacy Desktop WeChat bot token": "Стары токен бота WeChat для праграмы",
  "QQ bot app ID": "ID праграмы бота QQ",
  "QQ bot client secret": "Сакрэт кліента бота QQ",
  "Comma-separated QQ users allowed to use the bot":
    "Карыстальнікі QQ, якім дазволена карыстацца ботам (праз коску)",
  "Enable webhook ingestion": "Уключыць прыём вэбхукаў",
  "HTTP port for webhook delivery": "HTTP-порт для дастаўкі вэбхукаў",
  "Shared secret used to verify webhook senders":
    "Агульны сакрэт для праверкі адпраўнікоў вэбхукаў",
  "Expose Hermes through its OpenAI-compatible HTTP API":
    "Адкрыць Hermes праз яго HTTP API, сумяшчальны з OpenAI",
  "Bearer token required by the local API server":
    "Bearer-токен, патрэбны лакальнаму API-серверу",
  "Port used by the API server": "Порт, які выкарыстоўвае API-сервер",
  "Host interface for the API server": "Сеткавы інтэрфейс для API-сервера",
  "Model name exposed by the API server":
    "Назва мадэлі, якую паказвае API-сервер",

  // ── Messaging platform cards ─────────────────────────────────────────────
  "DMs, groups, and topics": "Асабістыя паведамленні, групы і тэмы",
  "DMs, channels, and threads":
    "Асабістыя паведамленні, каналы і галіны",
  "Socket Mode": "Рэжым Socket",
  "Channels and direct messages": "Каналы і асабістыя паведамленні",
  "Rooms and direct messages": "Пакоі і асабістыя паведамленні",
  "Bundled bridge, QR sign-in": "Убудаваны масток, уваход праз QR-код",
  "Connect through a signal-cli REST bridge.":
    "Падключэнне праз REST-масток signal-cli.",
  "Via a BlueBubbles server": "Праз сервер BlueBubbles",
  "Smart home via Home Assistant": "Разумны дом праз Home Assistant",
  Email: "Пошта",
  "Talk to Hermes through an IMAP/SMTP mailbox.":
    "Размова з Hermes праз паштовую скрыню IMAP/SMTP.",
  "Send and receive text messages via Twilio.":
    "Дасыланне і атрыманне тэкставых паведамленняў праз Twilio.",
  "DingTalk groups": "Групы DingTalk",
  "Groups and direct messages": "Групы і асабістыя паведамленні",
  "WeCom (group bot)": "WeCom (групавы бот)",
  "Send-only WeCom group bot via webhook.":
    "Групавы бот WeCom толькі для дасылання праз вэбхук.",
  "WeCom (app)": "WeCom (праграма)",
  "Two-way WeCom integration via callback app.":
    "Двухбаковая інтэграцыя WeCom праз праграму зваротных выклікаў.",
  "WeChat (Official Account)": "WeChat (афіцыйны акаўнт)",
  "Connect a WeChat Official Account.": "Падключыць афіцыйны акаўнт WeChat.",
  "QQ Bot": "Бот QQ",
  "QQ Open Platform bot": "Бот платформы QQ Open Platform",
  "Tencent Yuanbao": "Tencent Yuanbao",
  "API server": "API-сервер",
  "Expose Hermes as an OpenAI-compatible HTTP API for tools like Open WebUI.":
    "Адкрыць Hermes як HTTP API, сумяшчальны з OpenAI, для такіх інструментаў, як Open WebUI.",
  Webhooks: "Вэбхукі",
  "Receive events from GitHub, GitLab, and other webhook sources.":
    "Атрымліваць падзеі з GitHub, GitLab і іншых крыніц вэбхукаў.",

  // ── Slash commands ───────────────────────────────────────────────────────
  "Start a new chat": "Пачаць новы чат",
  "Clear conversation history": "Ачысціць гісторыю размовы",
  "Ask a side question without affecting context":
    "Задаць пабочнае пытанне, не ўплываючы на кантэкст",
  "Approve a pending action": "Пацвердзіць дзеянне, якое чакае выканання",
  "Deny a pending action": "Адхіліць дзеянне, якое чакае выканання",
  "Show current agent status": "Паказаць бягучы стан агента",
  "Reset conversation context": "Скінуць кантэкст размовы",
  "Compact and summarize the conversation": "Сціснуць і падсумаваць размову",
  "Undo the last action": "Адмяніць апошняе дзеянне",
  "Retry the last failed action": "Паўтарыць апошняе няўдалае дзеянне",
  "Toggle priority processing (lower latency)":
    "Пераключыць прыярытэтную апрацоўку (меншая затрымка)",
  "Compress conversation with optional focus topic":
    "Сціснуць размову з неабавязковай тэмай фокусу",
  "Show token usage, cost, and rate limits":
    "Паказаць выкарыстанне токенаў, кошт і ліміты",
  "Show diagnostics and debug info":
    "Паказаць дыягностыку і адладкавую інфармацыю",
  "Lock the agent onto a persistent cross-turn goal (Ralph loop)":
    "Замацаваць за агентам пастаянную мэту паміж ходамі (Ralph loop)",
  "Learn a reusable skill from files, URLs, notes, or this chat":
    "Вывучыць шматразовы навык з файлаў, URL, нататак або гэтага чату",
  "Steer the in-flight agent without interrupting it":
    "Скіраваць агента падчас працы, не перапыняючы яго",
  "Queue a follow-up to run after the current turn":
    "Паставіць у чаргу наступнае дзеянне пасля бягучага ходу",
  "Update Hermes to the latest version":
    "Абнавіць Hermes да апошняй версіі",
  "Search the web": "Знайсці ў сетцы",
  "Generate an image": "Згенераваць выяву",
  "Browse a URL": "Адкрыць URL",
  "Write or execute code": "Напісаць або выканаць код",
  "Read or write files": "Чытаць або запісваць файлы",
  "Run a shell command": "Выканаць каманду абалонкі",
  "Show available commands and help":
    "Паказаць даступныя каманды і даведку",
  "List available tools": "Паказаць спіс даступных інструментаў",
  "List installed skills": "Паказаць усталяваныя навыкі",
  "Reload the skills directory without restarting":
    "Перазагрузіць каталог навыкаў без перазапуску",
  "List or operate on kanban tasks": "Паказаць або апрацаваць задачы Канбана",
  "Show curator status (usage-ranked skills)":
    "Паказаць стан куратара (навыкі па частаце выкарыстання)",
  "Open model picker": "Адкрыць выбар мадэлі",
  "Open Desktop settings": "Адкрыць налады праграмы",
  "Explain the selected content": "Растлумачыць выбраны змест",
  "Show available commands": "Паказаць даступныя каманды",
  "Open Kanban board": "Адкрыць дошку Канбана",
  "Pages & settings": "Старонкі і налады",
  "Tools & skills": "Інструменты і навыкі",
  "Open Agents page": "Адкрыць старонку агентаў",
  "Open Office 3D page": "Адкрыць старонку «Офіс 3D»",
  "Open Discover page": "Адкрыць старонку «Агляд»",
  "Open Providers page": "Адкрыць старонку правайдэраў",
  "Open Schedules page": "Адкрыць старонку раскладаў",
  "Open Gateway status page": "Адкрыць старонку стану шлюза",
  "Show agent memory": "Паказаць памяць агента",
  "Show current persona": "Паказаць бягучую персону",
  "Show the current persona": "Паказаць бягучую персону",
  "Show available toolsets": "Паказаць даступныя наборы інструментаў",
  "Toggle fast mode": "Пераключыць хуткі рэжым",
  "Show token usage": "Паказаць выкарыстанне токенаў",
  "Show Hermes version": "Паказаць версію Hermes",

  // ── Voice input errors ───────────────────────────────────────────────────
  "No speech detected.": "Маўленне не распазнана.",
  "Voice input isn't available here.": "Галасавы ўвод тут недаступны.",
  "Microphone access was denied or is unavailable.":
    "У доступе да мікрафона адмоўлена або мікрафон недаступны.",

  // ── Inline errors ────────────────────────────────────────────────────────
  "Failed to load": "Не ўдалося загрузіць",
  "Failed to create job": "Не ўдалося стварыць задачу",
  "Failed to remove job": "Не ўдалося выдаліць задачу",
  "Failed to update job": "Не ўдалося абнавіць задачу",
  "Failed to trigger job": "Не ўдалося запусціць задачу",
  "Failed to load registry": "Не ўдалося загрузіць рэестр",
  "Failed to load models": "Не ўдалося загрузіць мадэлі",
  "Failed to write config": "Не ўдалося запісаць канфігурацыю",
  "Install failed": "Усталяванне не ўдалося",
  "Failed to create profile": "Не ўдалося стварыць профіль",

  // ── Main-process menu, context menu, dialogs ─────────────────────────────
  Chat: "Чат",
  "New Chat": "Новы чат",
  "Search Sessions": "Пошук сесій",
  Edit: "Праўка",
  View: "Выгляд",
  Window: "Акно",
  Help: "Даведка",
  "Toggle Developer Tools": "Інструменты распрацоўшчыка",
  "Hermes Agent on GitHub": "Hermes Agent на GitHub",
  "Pool provider": "Провайдэр пула",
  "Pool API key": "API-ключ пула",
  "Pool label": "Пазнака пула",
  "Report an Issue": "Паведаміць пра праблему",
  "Select All": "Выбраць усё",
  "Copy entire chat (text)": "Капіяваць увесь чат (тэкст)",
  "Copy entire chat (Markdown)": "Капіяваць увесь чат (Markdown)",
  "Administrator Password Required": "Патрэбны пароль адміністратара",
  "Administrator Password": "Пароль адміністратара",
  "Secret Required": "Патрэбны сакрэт",
  "Migrating from OpenClaw": "Пераход з OpenClaw",
  "Updating Hermes Agent": "Абнаўленне Hermes Agent",
  "Checking prerequisites": "Праверка папярэдніх умоў",
  "Setting up package manager": "Наладжванне менеджара пакетаў",
  "Setting up Python": "Наладжванне Python",
  "Downloading Hermes Agent": "Спампоўка Hermes Agent",
  "Creating Python environment": "Стварэнне асяроддзя Python",
  "Installing dependencies": "Усталяванне залежнасцей",
  "Finishing setup": "Завяршэнне наладжвання",
  "Restore Hermes backup": "Аднавіць рэзервовую копію Hermes",
  "Restore this Hermes backup?": "Аднавіць гэтую рэзервовую копію Hermes?",
  Cancel: "Скасаваць",
  "Restore backup": "Аднавіць копію",
  "Archive:": "Архіў:",
  "Local profile:": "Лакальны профіль:",
  "This replaces configuration, credentials, sessions and other backup contents. Provider backups may also restore files outside this profile.":
    "Гэта заменіць канфігурацыю, уліковыя даныя, сесіі і іншы змест рэзервовай копіі. Копіі правайдэраў могуць таксама аднаўляць файлы па-за гэтым профілем.",
  "Hermes is not installed.": "Hermes не ўсталяваны.",
  "Hermes is not installed. Please install it first.":
    "Hermes не ўсталяваны. Спачатку ўсталюйце яго.",
  "The installer needs your password": "Усталёўшчыку патрэбны ваш пароль",
  "Backup import cancelled.": "Імпарт рэзервовай копіі скасаваны.",
  "Could not confirm backup import.":
    "Не ўдалося пацвердзіць імпарт рэзервовай копіі.",

  // ── Registry field labels ────────────────────────────────────────────────
  Transport: "Транспарт",
  Command: "Каманда",
  Environment: "Асяроддзе",
  Permissions: "Дазволы",
  Model: "Мадэль",
  Tools: "Інструменты",
  Entry: "Запіс",
  Requires: "Патрабуе",
  "Requires Hermes": "Патрабуе Hermes",
  Category: "Катэгорыя",
  Platforms: "Платформы",
  Tags: "Тэгі",
  License: "Ліцэнзія",
  Author: "Аўтар",
  Version: "Версія",

  // ── Registry errors ────────────────────────────────
  "No files found for this entry": "Для гэтага запісу не знойдзена файлаў",
  "MCP entry has no path": "Запіс MCP не мае шляху",
  "MCP manifest has no connection config":
    "У маніфесце MCP няма канфігурацыі падключэння",
  "Already configured": "Ужо наладжана",
  "Skill entry has no path": "Запіс навыку не мае шляху",
  "Workflow entry has no path": "Запіс працэсу не мае шляху",
  "Agent entry has no path": "Запіс агента не мае шляху",
  "Agent persona is empty": "Персона агента пустая",
  "Failed to write agent persona (SOUL.md)":
    "Не ўдалося запісаць персону агента (SOUL.md)",
  "Unknown item kind": "Невядомы тып элемента",

  // ── Installer / backup import ─────────────────────
  "Starting installation...": "Пачатак усталёўкі...",
  "Backup import requires a Local connection.":
    "Імпарт рэзервовай копіі патрабуе лакальнага падключэння.",
  "Connection changed; backup import cancelled.":
    "Падключэнне змянілася; імпарт рэзервовай копіі скасаваны.",
  "Import archive path is required.": "Патрабуецца шлях да архіва імпарту.",
  "Import archive does not exist.": "Архіў імпарту не існуе.",
  "Import archive must be a file.": "Архіў імпарту мусіць быць файлам.",
  "Import archive is not readable.": "Архіў імпарту не чытаецца.",
  "No OpenClaw installation found.": "Усталёўка OpenClaw не знойдзена.",

  // ── Gateway credential prompts ────────────────────
  "An agent command needs administrator (sudo) access to continue. Your password is sent only to the requesting Hermes Agent's sudo prompt and is never stored.":
    "Каманда агента патрабуе правоў адміністратара (sudo), каб працягнуць. Ваш пароль перадаецца толькі ў адказ на запыт sudo таго Hermes Agent, які яго запытаў, і ніколі не захоўваецца.",
  "Hermes needs your sudo password": "Hermes патрабуе ваш пароль sudo",
  "Hermes needs a secret value": "Hermes патрабуе сакрэтнае значэнне",

  // ── Sudo password dialog (native) ──────────────────
  "Hermes needs your computer password":
    "Hermes патрабуе пароль вашага камп'ютара",
  "The installer will install browser libraries that require administrator access. You'll only be asked once — the password is used locally and never stored.":
    "Усталёўшчык усталюе бібліятэкі браўзера, якія патрабуюць правоў адміністратара. Вас спытаюць толькі раз — пароль выкарыстоўваецца лакальна і ніколі не захоўваецца.",
  Password: "Пароль",
  Continue: "Працягнуць",
};

/** Перакладае радок-вызначэнне, калі актыўная мова — беларуская. */
export function localizeDefinition(
  text: string,
  locale: AppLocale = getLocale(),
): string {
  if (locale !== "be") return text;
  return DEFINITIONS_BE[text] ?? text;
}
