<img width="100%" alt="HERMES DESKTOP" src="previews/header.webp" />

<br/>
<p align="center">
  <a href="https://x.com/HermesOneApp"><img src="https://img.shields.io/badge/Síguenos-000000?style=for-the-badge&logo=x" alt="Twitter/X"></a>
  <a href="https://discord.gg/Fqu72h8z"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/fathah/hermes-desktop/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licencia-MIT-green?style=for-the-badge" alt="Licencia: MIT"></a>
  <a href="https://hermesone.org/"><img src="https://img.shields.io/badge/Descargar-Releases-FF6600?style=for-the-badge" alt="Releases"></a>
  <a href="https://github.com/fathah/hermes-desktop/stargazers">
  <img src="https://img.shields.io/github/stars/fathah/hermes-desktop?style=for-the-badge&color=FFD700&label=Estrellas" alt="Estrellas">
</a>
  <a href="https://github.com/fathah/hermes-desktop/releases/">
  <img src="https://img.shields.io/github/downloads/fathah/hermes-desktop/total?style=for-the-badge&color=00B496&label=Descargas%20Totales" alt="Descargas">
</a>
  <a href="https://bankr.bot/launches/0xfda75f77a22b4f4b783bbbb21915ef64d149bba3">
  <img src="https://img.shields.io/badge/Token-$HD-purple?style=for-the-badge&logo=ethereum" alt="Token $HD">
</a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja-JP.md">日本語</a> ·
  <a href="README.es-LATAM.md">Español (LATAM)</a>
</p>

<p align="center">
 <a href="https://www.star-history.com/fathah/hermes-desktop">
  <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=fathah/hermes-desktop&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=fathah/hermes-desktop" />
   <img alt="Star History Rank" src="https://api.star-history.com/badge?repo=fathah/hermes-desktop" />
  </picture>
 </a>
</p>

> **Este proyecto está en desarrollo activo.** Las funciones pueden cambiar y algunas cosas podrían no funcionar perfectamente. Si encuentras un problema o tienes una idea, [abre un issue](https://github.com/fathah/hermes-desktop/issues). ¡Las contribuciones son bienvenidas!

Hermes Desktop es una aplicación nativa de escritorio para instalar, configurar y chatear con [Hermes Agent](https://github.com/NousResearch/hermes-agent) — un asistente de IA con autoaprendizaje, uso de herramientas, mensajería multiplataforma y un ciclo de aprendizaje cerrado.

En lugar de manejar el CLI a mano, la app guía todo el proceso de instalación, configuración de proveedores y uso diario en un solo lugar. Usa el script oficial de instalación de Hermes, guarda los archivos en `~/.hermes` y te da una GUI para chat, sesiones, perfiles, memoria, habilidades, herramientas, tareas programadas, gateways de mensajería y más.

## Patrocinadores

<a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=hermes-desktop" target="_blank" rel="noopener noreferrer">
    <img src="src/renderer/src/assets/logos/atlascloud.svg" alt="Atlas Cloud" height="100" style="display: block;">
  </a>

> **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=hermes-desktop)** es una plataforma de inferencia de IA full-modal compatible con OpenAI (DeepSeek, Qwen, GLM, Kimi, MiniMax y más). Úsala en Hermes Desktop seleccionando **Atlas Cloud** como tu proveedor — la URL base se configura automáticamente.

## Instalación

<a href="https://hermesone.org/"><img width="380" alt="Descargar ahora" src="previews/download.webp" /></a>

### Windows

> **Usuarios de Windows:** El instalador no tiene firma de código. Windows SmartScreen mostrará una advertencia al primer lanzamiento — haz clic en "Más información" → "Ejecutar de todas formas".

> **Usuarios de WSL:** Si el instalador se queda colgado en `Switching to root user to install dependencies...`, Playwright está esperando una contraseña de sudo que no tiene TTY para leerla. Otorga sudo sin contraseña para la instalación y reviértelo al terminar:
>
> ```bash
> echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/hermes-install
> # …vuelve a ejecutar el instalador; cuando termine:
> sudo rm /etc/sudoers.d/hermes-install
> ```
>
> Seguimiento en [#109](https://github.com/fathah/hermes-desktop/issues/109).

### Fedora (RPM)

```bash
sudo dnf install ./hermes-desktop-<version>.rpm
```

> **Usuarios de Fedora:** El `.rpm` no tiene firma GPG. Si tu sistema exige verificación de firma, agrega `--nogpgcheck` al comando de instalación. La actualización automática no está disponible para builds `.rpm` (limitación de `electron-updater`); reinstala el nuevo `.rpm` para actualizar.

## Vista previa

<table>
<tr>
<td width="50%" align="center"><b>Chat</b><br/><img width="100%" alt="Chat" src="previews/chat.png" /></td>
<td width="50%" align="center"><b>Perfiles</b><br/><img width="100%" alt="Profiles" src="previews/profiles.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Modelos</b><br/><img width="100%" alt="Models" src="previews/models.png" /></td>
<td width="50%" align="center"><b>Proveedores</b><br/><img width="100%" alt="Providers" src="previews/providers.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Herramientas</b><br/><img width="100%" alt="Tools" src="previews/tools.png" /></td>
<td width="50%" align="center"><b>Habilidades</b><br/><img width="100%" alt="Skills" src="previews/skills.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Tareas programadas</b><br/><img width="100%" alt="Schedules" src="previews/schedules.png" /></td>
<td width="50%" align="center"><b>Gateway</b><br/><img width="100%" alt="Gateway" src="previews/gateway.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Persona</b><br/><img width="100%" alt="Persona" src="previews/persona.png" /></td>
<td width="50%" align="center"><b>Kanban</b><br/><img width="100%" alt="Kanban" src="previews/kanban.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Oficina</b><br/><img width="100%" alt="Office" src="previews/office.png" /></td>
<td width="50%" align="center"><b>Configuración</b><br/><img width="100%" alt="Settings" src="previews/settings.png" /></td>
</tr>
</table>

## Funcionalidades

- **Instalación guiada en el primer uso** de Hermes Agent con seguimiento de progreso y resolución de dependencias
- **Backend local o remoto** — ejecuta Hermes localmente en `127.0.0.1:8642`, o conecta la app a un servidor remoto con URL + clave API
- **Soporte multi-proveedor** — OpenRouter, Anthropic, OpenAI, Google (Gemini), xAI (Grok), Nous Portal, Qwen, MiniMax, Hugging Face, Groq y endpoints compatibles con OpenAI (LM Studio, Atomic Chat, Ollama, vLLM, llama.cpp)
- **UI de chat con streaming** con SSE, indicadores de progreso de herramientas, renderizado de Markdown y resaltado de sintaxis
- **Seguimiento de tokens** — conteo en tiempo real de tokens de entrada/salida y costo en el pie del chat, más el comando `/usage`
- **22 comandos slash** — `/new`, `/clear`, `/fast`, `/web`, `/image`, `/browse`, `/code`, `/shell`, `/usage`, `/help`, `/tools`, `/skills`, `/model`, `/memory`, `/persona`, `/version`, `/compact`, `/compress`, `/undo`, `/retry`, `/debug`, `/status` y más
- **Gestión de sesiones** — búsqueda de texto completo (SQLite FTS5), historial agrupado por fecha, reanudar y buscar conversaciones
- **Cambio de perfiles** — crea, elimina y cambia entre entornos Hermes con configuración aislada
- **14 conjuntos de herramientas** — web, navegador, terminal, archivos, ejecución de código, visión, generación de imágenes, TTS, habilidades, memoria, búsqueda de sesiones, clarificación, delegación, MoA y planificación de tareas
- **Sistema de memoria** — ver/editar entradas de memoria, perfil de usuario, seguimiento de capacidad y proveedores de memoria (Honcho, Hindsight, Mem0, RetainDB, Supermemory, ByteRover)
- **Editor de Persona** — edita y restablece el archivo SOUL.md de personalidad de tu agente
- **Modelos guardados** — gestión CRUD de configuraciones de modelos por proveedor
- **Tareas programadas** — constructor de cron jobs (minutos, cada hora, diario, semanal, cron personalizado) con 15 destinos de entrega
- **16 gateways de mensajería** — Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email (IMAP/SMTP), SMS (Twilio/Vonage), iMessage (BlueBubbles), DingTalk, Feishu/Lark, WeCom, WeChat (iLink Bot), Webhooks, Home Assistant
- **Hermes Office (Claw3d)** — interfaz visual 3D con servidor de desarrollo y gestión de adaptadores
- **Backup, importar y diagnóstico** — respaldo/restauración completa y diagnóstico del sistema desde Configuración
- **Visor de logs** — visualiza logs de gateway y agente directamente desde la pantalla de Configuración
- **Actualizador automático** — verifica e instala actualizaciones vía electron-updater
- **Listo para i18n** — framework de internacionalización con localización en inglés para todas las pantallas, listo para traducciones de la comunidad
- **Suite de pruebas** — parser SSE, handlers IPC, superficie de API preload, utilidades del instalador y validación de constantes con Vitest

## Cómo funciona

Al primer lanzamiento, la app:

1. Pregunta si deseas ejecutar Hermes **localmente** o conectarte a un **servidor remoto**.
2. **Modo local:** verifica si Hermes ya está instalado en `~/.hermes`; si no, ejecuta el instalador oficial con resolución de dependencias (Git, uv, Python 3.11+).
3. **Modo remoto:** solicita la URL de la API remota y la clave API, valida la conexión y omite la instalación local.
4. Solicita un proveedor de API o endpoint de modelo local.
5. Guarda la configuración del proveedor y las claves API en los archivos de configuración de Hermes.
6. Lanza el workspace principal una vez completada la configuración.

En modo local, las solicitudes de chat van por `http://127.0.0.1:8642` con streaming SSE. En modo remoto, la app se comunica con tu URL remota configurada con el mismo protocolo de streaming. La app parsea el stream en tiempo real, renderizando progreso de herramientas, contenido Markdown y uso de tokens a medida que llegan.

## Pantallas

| Pantalla          | Descripción                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| **Chat**          | UI de conversación con streaming, comandos slash, progreso de herramientas y seguimiento de tokens |
| **Sesiones**      | Navega, busca y reanuda conversaciones pasadas                                                     |
| **Agentes**       | Crea, elimina y cambia entre perfiles de Hermes                                                    |
| **Habilidades**   | Navega, instala y gestiona habilidades incluidas e instaladas                                      |
| **Modelos**       | Gestiona configuraciones de modelos guardadas por proveedor                                        |
| **Memoria**       | Ver/editar entradas de memoria, perfil de usuario y configurar proveedores de memoria              |
| **Soul**          | Edita la persona del perfil activo (SOUL.md)                                                       |
| **Herramientas**  | Activa o desactiva conjuntos de herramientas individuales                                          |
| **Programadas**   | Crea y gestiona cron jobs con destinos de entrega                                                  |
| **Gateway**       | Configura y controla integraciones de plataformas de mensajería                                    |
| **Oficina**       | Configuración y gestión de la interfaz visual Claw3d                                               |
| **Configuración** | Config de proveedor, pools de credenciales, backup/importar, visor de logs, red, tema              |

## Proveedores soportados

### Patrocinadores

| Proveedor       | Notas                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Atlas Cloud** | Gateway compatible con OpenAI — DeepSeek, Qwen, GLM, Kimi, MiniMax y más ([atlascloud.ai](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=hermes-desktop)) |

### Proveedores de LLM

| Proveedor           | Notas                                    |
| ------------------- | ---------------------------------------- |
| **OpenRouter**      | 200+ modelos vía API única (recomendado) |
| **Anthropic**       | Acceso directo a Claude                  |
| **OpenAI**          | Acceso directo a GPT                     |
| **Google (Gemini)** | Google AI Studio                         |
| **xAI (Grok)**      | Modelos Grok                             |
| **Nous Portal**     | Capa gratuita disponible                 |
| **Qwen**            | Modelos QwenAI                           |
| **MiniMax**         | Endpoints globales y de China            |
| **Hugging Face**    | 20+ modelos abiertos vía HF Inference    |
| **Groq**            | Inferencia rápida (voz/STT)              |
| **Local/Custom**    | Cualquier endpoint compatible con OpenAI |

Los presets locales incluyen LM Studio, Atomic Chat, Ollama, vLLM y llama.cpp.

### Plataformas de mensajería

Telegram, Discord, Slack, WhatsApp, Signal, Matrix/Element, Mattermost, Email (IMAP/SMTP), SMS (Twilio y Vonage), iMessage (BlueBubbles), DingTalk, Feishu/Lark, WeCom, WeChat (iLink Bot), Webhooks y Home Assistant.

### Integraciones de herramientas

Exa Search, Parallel API, Tavily, Firecrawl, FAL.ai (generación de imágenes), Honcho, Browserbase, Weights & Biases y Tinker.

## Desarrollo

### Requisitos previos

- Node.js y npm
- Un entorno tipo Unix para el instalador de Hermes
- Acceso a internet para descargar Hermes en la primera instalación

### Instalar dependencias

```bash
npm install
```

### Iniciar la app en desarrollo

```bash
npm run dev
```

### Ejecutar verificaciones

```bash
npm run lint
npm run typecheck
```

### Ejecutar pruebas

```bash
npm run test
npm run test:watch
```

### Construir la app de escritorio

```bash
npm run build
```

Empaquetado por plataforma:

```bash
npm run build:mac
npm run build:win
npm run build:linux
npm run build:rpm    # Solo .rpm para Fedora/RHEL
```

## Configuración inicial

Cuando la app se abre por primera vez, detectará una instalación existente de Hermes o se ofrecerá a instalarla.

Rutas de configuración soportadas en la UI:

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- `Local LLM` vía URL base compatible con OpenAI

Los presets locales incluyen:

- LM Studio
- Atomic Chat
- Ollama
- vLLM
- llama.cpp

Los archivos de Hermes se gestionan en:

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`
- `~/.hermes/profiles/` — directorios de perfiles con nombre
- `~/.hermes/state.db` — base de datos del historial de sesiones
- `~/.hermes/cron/jobs.json` — tareas programadas

## Proveedor de secretos

Por defecto, las claves API viven en `~/.hermes/.env` (el proveedor **env**). No se necesita configuración — este es el comportamiento histórico y nada cambia para ti.

Si prefieres no guardar claves en un `.env` en texto plano, el proveedor **command** (de activación opcional) las resuelve ejecutando un comando auxiliar que tú configuras. El orden de resolución en todos lados es: `process.env` → `.env` → proveedor → no definida.

Helper por clave (el nombre de la clave solicitada llega como `$HERMES_SECRET_KEY`):

```yaml
# ~/.hermes/config.yaml
secrets:
  provider: command
  command: secret-tool lookup hermes "$HERMES_SECRET_KEY"
```

O un helper que vuelca un bloque dotenv (por ejemplo, un vault que se descifra en tmpfs):

```yaml
secrets:
  provider: command
  command: "cat /run/user/1000/hermes-secrets.env"
```

La salida del helper puede ser un valor único (helpers por clave) o líneas `KEY=VALUE` (volcados dotenv); ambos formatos se detectan automáticamente.

### Integración con vault / gestor de secretos (sin TPM requerido)

El proveedor `command` es **agnóstico al vault** — ejecuta el helper que configures y lee su stdout. El helper es lo único que necesita comunicarse con tu almacén de secretos. Si no tienes un keyfile sellado con TPM, cualquiera de estas opciones funciona sin cambios en el código de Hermes:

- **KeePassXC (BD solo con contraseña, sin keyfile):** apunta `secrets.command` a un pequeño script `kpxc-export.sh` que hace `keepassxc-cli ls ~/secrets/hermes.kdbx <<<"$KPXC_PASSWORD"` y vuelca el grupo relevante como dotenv. Pide la contraseña maestra una vez por sesión.
- **GnuPG con clave solo de contraseña:** `gpg --batch --passphrase-fd 0 --decrypt ~/.keys/api-keys.gpg` funciona directamente como valor de `command`. Pasa la contraseña vía descriptor de archivo o variable de entorno, nunca como argumento.
- **`pass` (el gestor de contraseñas unix estándar):** `command: "pass show hermes/$HERMES_SECRET_KEY"` para helper por clave, o un script wrapper para volcado dotenv.
- **`secret-tool` (libsecret/Gnome Keyring):** `command: "secret-tool lookup hermes $HERMES_SECRET_KEY"` (ya mostrado arriba como ejemplo canónico por clave).
- **Bitwarden CLI:** `bw get item "$HERMES_SECRET_KEY" | jq -r .notes` (después de `bw unlock` en la sesión).
- **1Password CLI:** `op read "op://vault/$HERMES_SECRET_KEY/credential"`.
- **Archivo env plano con permisos gestionados:** `command: "cat ~/.config/hermes/secrets.env"` con `chmod 600` y el archivo propiedad de tu usuario. No tan seguro como un vault, pero mejor que un `.env` legible por todos.

El punto: **cualquier helper que imprima un valor (por clave) o un bloque dotenv (modo lista) en stdout funcionará**, y Hermes impone un timeout de 3 segundos y un límite de 1 MiB de salida al helper. El proveedor no hace suposiciones sobre TPM, FIDO2, tarjetas inteligentes ni keychains de plataforma.

Modelo de seguridad:

- El string de comando es tu propia configuración — mismo nivel de confianza que `.env`. Se ejecuta vía `/bin/sh -c`, por lo que el proveedor command es solo POSIX (Linux/macOS); Windows se mantiene en el proveedor env.
- El helper hereda el entorno del proceso más `HERMES_SECRET_KEY`; el nombre de la clave se pasa como dato, nunca interpolado en el string del shell.
- Timeout fijo de 3 segundos, límite de 1 MiB de salida, y stderr se descarta.
- Los valores resueltos nunca se registran ni se escriben en disco; los fallos degradan a "clave no definida", registrando solo el código de salida/señal.
- El broadcast de inicio de gateway usa una única llamada `list()`, nunca un loop de helper por clave.

Fuente de verdad: [`src/main/secrets/`](src/main/secrets/).

## Stack tecnológico

- **Electron** 39 — shell de escritorio multiplataforma
- **React** 19 — framework de UI
- **TypeScript** 5.9 — tipado seguro en procesos main y renderer
- **Tailwind CSS** 4 — estilos utility-first
- **Vite** 7 + electron-vite — servidor de desarrollo rápido y herramientas de build
- **better-sqlite3** — almacenamiento local de sesiones con búsqueda FTS5
- **i18next** — framework de internacionalización
- **Vitest** — test runner

## Notas

- La app de escritorio depende del proyecto upstream Hermes Agent para el comportamiento del agente y la ejecución de herramientas.
- El instalador integrado ejecuta el script oficial de instalación de Hermes con `--skip-setup`, luego completa la configuración del proveedor en la GUI.
- Los proveedores de modelos locales no requieren clave API, pero el servidor compatible debe estar ejecutándose.
- Las rutas alternativas de registro npm son compatibles para entornos con acceso restringido a internet.

## Contribuir

¡Las contribuciones son bienvenidas! Consulta la [Guía de contribución](CONTRIBUTING.md) para comenzar. Si no sabes por dónde empezar, mira los [issues abiertos](https://github.com/fathah/hermes-desktop/issues). ¿Encontraste un bug o tienes una solicitud de funcionalidad? [Abre un issue](https://github.com/fathah/hermes-desktop/issues/new).

## Proyecto relacionado

Para el agente central, documentación y flujos de trabajo CLI, consulta el repositorio principal de Hermes Agent:

- https://github.com/NousResearch/hermes-agent

---

_Traducción al español LATAM por [Nanoboy](https://github.com/365diascollaboration-prog)._
