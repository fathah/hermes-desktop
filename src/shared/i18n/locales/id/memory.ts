export default {
  title: "Memori",
  subtitle:
    "Hal yang diingat Hermes tentang Anda dan lingkungan Anda di berbagai sesi.",
  sessions: "Sesi",
  messages: "Pesan",
  memories: "Memori",
  providersTitle: "Provider",
  agentMemory: "Memori Agent",
  userProfile: "Profil Pengguna",
  entries: "{{count}} entri",
  addMemory: "Tambah Memori",
  addFailed: "Gagal menambah entri",
  updateFailed: "Gagal memperbarui entri",
  saveFailed: "Gagal menyimpan",
  entriesPlaceholder:
    "mis. Pengguna lebih suka TypeScript daripada JavaScript. Selalu gunakan strict mode.",
  userProfilePlaceholder:
    "mis. Nama: Alex. Senior developer. Lebih suka jawaban ringkas. Menggunakan macOS dengan zsh. Zona waktu: WIB.",
  noProvidersFound:
    "Tidak ada provider memori yang ditemukan di instalasi ini.",
  openProviderWebsite: "Buka situs provider",
  noMemoriesYet:
    "Belum ada memori. Hermes akan menyimpan fakta penting saat Anda chat.",
  noMemoryEntries: "Belum ada entri memori.",
  noToolsetsFound: "Tidak ada toolset ditemukan.",
  addManuallyHint:
    "Anda juga dapat menambahkan memori secara manual dengan tombol di atas.",
  userProfileHint:
    "Beri tahu Hermes tentang diri Anda - nama, peran, preferensi, dan gaya komunikasi.",
  providersHint:
    "Provider memori pluggable memberi Hermes memori jangka panjang yang lebih canggih. Memori bawaan (di atas) selalu aktif bersama provider yang dipilih.",
  providersHintActive: "Aktif: {{provider}}",
  providersHintInactive:
    "Tidak ada provider eksternal aktif - hanya memakai memori bawaan.",
  enterEnvKey: "Masukkan {{key}}",
  chars: "{{count}} karakter",
  cancel: "Batal",
  save: "Simpan",
  edit: "Edit",
  deleteConfirm: "Hapus?",
  yes: "Ya",
  no: "Tidak",
  saveProfile: "Simpan Profil",
  active: "Aktif",
  deactivate: "Nonaktifkan",
  activating: "Mengaktifkan...",
  activate: "Aktifkan",
  providers: {
    honcho:
      "Pemodelan pengguna lintas sesi berbasis AI dengan Q&A dialektik dan pencarian semantik",
    hindsight:
      "Memori jangka panjang dengan knowledge graph dan retrieval multi-strategi",
    mem0: "Ekstraksi fakta LLM sisi server dengan pencarian semantik dan auto-deduplication",
    retaindb: "API memori cloud dengan hybrid search dan 7 tipe memori",
    supermemory:
      "Memori jangka panjang semantik dengan profile recall dan ekstraksi entitas",
    holographic:
      "Penyimpanan fakta SQLite lokal dengan pencarian FTS5 dan trust scoring (tanpa API key)",
    "recall-sqlite":
      "Penyimpanan recall SQLite lokal dengan pencarian FTS tanpa memerlukan API key",
    openviking:
      "Memori terkelola sesi dengan retrieval bertingkat dan penjelajahan pengetahuan",
    byterover:
      "Pohon pengetahuan persisten dengan retrieval bertingkat melalui brv CLI",
  },
} as const;
