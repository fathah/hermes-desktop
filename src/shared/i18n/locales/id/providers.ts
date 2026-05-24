export default {
  title: "Provider",
  subtitle: "Konfigurasikan provider LLM, API key, dan kumpulan kredensial",
  oauth: {
    sectionTitle: "Langganan / Paket OAuth",
    sectionHint:
      "Masuk dengan langganan provider alih-alih API key. Otorisasi dilakukan di browser Anda.",
    signIn: "Masuk",
    runningHint:
      "Ikuti langkah-langkah di bawah untuk menyelesaikan proses masuk.",
    successHint: "Berhasil masuk. Anda sekarang dapat memilih provider ini.",
    failed: "Gagal masuk.",
    codexDesc: "Gunakan paket ChatGPT Codex Anda",
    xaiDesc: "Gunakan langganan xAI Grok Anda",
    qwenDesc: "Gunakan langganan Qwen Anda",
    geminiDesc: "Gunakan paket Google AI Pro / Gemini Anda",
    minimaxDesc: "Gunakan langganan MiniMax Anda",
  },
} as const;
