import React, { useState, useEffect } from "react";
import { Icon } from "../components/Icon";

interface JournalEntry {
  id: string;
  timestamp: number;
  text_raw: string;
  voice_transcription?: string;
  mood_score?: number;
  tags: string[];
  media?: Array<{
    id: string;
    file_path: string;
    mime_type: string;
    parsed_payload?: {
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      foodName?: string;
    };
  }>;
}

interface BiometricLog {
  id: string;
  timestamp: number;
  weight_kg?: number;
  skeletal_muscle_mass_kg?: number;
  body_fat_pct?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  fasting_glucose_mgdl?: number;
  sleep_score?: number;
  hrv_ms?: number;
}

interface MedicationProtocol {
  id: string;
  name: string;
  substance_type: string;
  vial_size_mg?: number;
  diluent_ml?: number;
  dosage_unit: string;
  syringe_units_per_ml: number;
  half_life_hours?: number;
  schedule_cron: string;
  titration_steps?: Array<{ week: number; dose: number }>;
}

interface MedicalDoc {
  id: string;
  file_name: string;
  file_path: string;
  uploaded_at: number;
  doc_type: string;
  ocr_content_text?: string;
  extracted_biomarkers?: Array<{
    name: string;
    value: number | string;
    unit: string;
    referenceRangeLow?: number;
    referenceRangeHigh?: number;
    isOutOfRange: boolean;
  }>;
}

export function PersonalHealthDashboard(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<
    "journal" | "peptide" | "vault" | "news"
  >("journal");
  const [profile, setProfile] = useState<any>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [biometricLogs, setBiometricLogs] = useState<BiometricLog[]>([]);
  const [protocols, setProtocols] = useState<MedicationProtocol[]>([]);
  const [medLogs, setMedLogs] = useState<any[]>([]);
  const [medicalDocs, setMedicalDocs] = useState<MedicalDoc[]>([]);
  const [clinicalDigest, setClinicalDigest] = useState<any[]>([]);

  // Form states
  const [quickWeight, setQuickWeight] = useState("");
  const [quickGlucose, setQuickGlucose] = useState("");
  const [quickBP, setQuickBP] = useState("");
  const [quickJournalText, setQuickJournalText] = useState("");
  const [quickMood, setQuickMood] = useState(7);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingFood, setIsUploadingFood] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Reconstitution state
  const [vialMg, setVialMg] = useState(5);
  const [diluentMl, setDiluentMl] = useState(2);
  const [targetMcg, setTargetMcg] = useState(250);
  const [syringeCalib, setSyringeCalib] = useState(100); // U-100

  // Medication Protocol Form
  const [newProtocolName, setNewProtocolName] = useState("");
  const [newProtocolType, setNewProtocolType] = useState("peptide");
  const [newProtocolUnit, setNewProtocolUnit] = useState("mcg");
  const newProtocolHalfLife = 120; // 5 days in hrs

  // Load profile and tables
  const loadData = async (): Promise<void> => {
    try {
      const api = window.hermesAPI;
      if (!api) return;

      const p = await api.spsHealthGetProfile();
      setProfile(p);

      const entries = await api.spsHealthGetJournalEntries();
      setJournalEntries(entries);

      const bios = await api.spsHealthGetBiometricLogs();
      setBiometricLogs(bios);

      const prots = await api.spsHealthGetMedicationProtocols();
      setProtocols(prots);

      const mLogs = await api.spsHealthGetMedicationLogs();
      setMedLogs(mLogs);

      const docs = await api.spsHealthGetMedicalDocs();
      setMedicalDocs(docs);

      const digest = await api.spsRssGetClinicalDigest();
      setClinicalDigest(digest);
    } catch (err) {
      console.error("[Health UI] Load error:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddBiometric = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    let sys: number | undefined;
    let dia: number | undefined;
    if (quickBP.includes("/")) {
      const parts = quickBP.split("/");
      sys = parseInt(parts[0], 10);
      dia = parseInt(parts[1], 10);
    }

    await api.spsHealthAddBiometricLog({
      weight_kg: quickWeight ? parseFloat(quickWeight) : undefined,
      fasting_glucose_mgdl: quickGlucose ? parseFloat(quickGlucose) : undefined,
      systolic_bp: sys,
      diastolic_bp: dia,
      timestamp: Date.now(),
    });

    setQuickWeight("");
    setQuickGlucose("");
    setQuickBP("");
    loadData();
  };

  const handleAddJournalText = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    if (!quickJournalText.trim()) return;

    await api.spsHealthAddJournalEntry({
      text_raw: quickJournalText,
      mood_score: quickMood,
      tags: ["daily", "journal"],
      timestamp: Date.now(),
    });

    setQuickJournalText("");
    loadData();
  };

  const simulateVoiceRecording = (): void => {
    setIsRecording(true);
    setTimeout(async () => {
      const api = window.hermesAPI;
      if (!api) return;

      await api.spsHealthAddJournalEntry({
        text_raw:
          "Completed evening deep meditation session. HRV felt high. Logged BPC-157 administration.",
        voice_transcription:
          "Completed evening deep meditation session. HRV felt high. Logged BPC-157 administration.",
        mood_score: 9,
        tags: ["voice", "meditation"],
        timestamp: Date.now(),
      });
      setIsRecording(false);
      loadData();
    }, 2500);
  };

  const simulateFoodUpload = (): void => {
    setIsUploadingFood(true);
    setUploadProgress(10);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 25;
      });
    }, 400);

    setTimeout(async () => {
      clearInterval(interval);
      const api = window.hermesAPI;
      if (!api) return;

      await api.spsHealthAddJournalEntry({
        text_raw:
          "Logged high-protein dinner: Grilled Salmon with Asparagus and Quinoa.",
        mood_score: 8,
        tags: ["diet", "dinner"],
        media: [
          {
            id: Math.random().toString(36),
            file_path: "sps-asset://asset/salmon-dinner.png",
            mime_type: "image/png",
            parsed_payload: {
              foodName: "Grilled Salmon & Quinoa",
              calories: 580,
              protein: 42,
              carbs: 35,
              fat: 22,
            },
          },
        ],
        timestamp: Date.now(),
      });

      setIsUploadingFood(false);
      setUploadProgress(0);
      loadData();
    }, 2200);
  };

  const handleAddProtocol = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || !newProtocolName) return;

    await api.spsHealthSaveMedicationProtocol({
      name: newProtocolName,
      substance_type: newProtocolType,
      dosage_unit: newProtocolUnit,
      half_life_hours: newProtocolHalfLife,
      vial_size_mg: newProtocolType === "peptide" ? vialMg : undefined,
      diluent_ml: newProtocolType === "peptide" ? diluentMl : undefined,
      schedule_cron: "0 9 * * *",
    });

    setNewProtocolName("");
    loadData();
  };

  const handleDeleteProtocol = async (id: string): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;
    await api.spsHealthDeleteMedicationProtocol(id);
    loadData();
  };

  const logAdministration = async (
    proto: MedicationProtocol,
  ): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    let dose = 1;
    if (proto.substance_type === "peptide") {
      dose = targetMcg;
    }

    await api.spsHealthAddMedicationLog({
      protocol_id: proto.id,
      dose_administered: dose,
      injection_site: "Left Lower Abdomen",
      side_effects: ["no-side-effects"],
      timestamp: Date.now(),
    });
    loadData();
  };

  // Reconstitution syringe units formula
  // Syringe Dose (Units) = (Target Dose mcg / (Vial Size mg * 1000) * Diluent ml) * Syringe Calibration
  const calculatedSyringeUnits =
    (targetMcg / (vialMg * 1000)) * diluentMl * syringeCalib;

  // Visual SVG Syringe position calculation
  // Max plunger draw = 100 units = 200px width.
  const plungerWidthPx = Math.min(
    200,
    Math.max(0, (calculatedSyringeUnits / 100) * 200),
  );

  // Visual custom chart calculation for biometrics
  // We extract weights to plot
  const activeLogs = biometricLogs.filter((b) => b.weight_kg !== null);
  const maxWeight =
    activeLogs.length > 0
      ? Math.max(...activeLogs.map((l) => l.weight_kg!)) + 2
      : 100;
  const minWeight =
    activeLogs.length > 0
      ? Math.min(...activeLogs.map((l) => l.weight_kg!)) - 2
      : 50;

  // Simple local file uploader simulator for PDF lab reports
  const simulateOcrDocument = (): void => {
    const api = window.hermesAPI;
    if (!api) return;

    setTimeout(async () => {
      await api.spsHealthAddMedicalDoc({
        file_name: "LabCorp_BloodPanel_2026.pdf",
        file_path: "/Users/amar/Desktop/LabCorp_BloodPanel_2026.pdf",
        uploaded_at: Date.now(),
        doc_type: "lab_report",
        ocr_content_text:
          "LabCorp Diagnostic report. HbA1c: 5.4%. ApoB: 82 mg/dL. Fasting Insulin: 6.8 uIU/mL. LDL Cholesterol: 88 mg/dL. HDL Cholesterol: 52 mg/dL. BP: 118/74 mmHg. Fasting Glucose: 92 mg/dL.",
      });
      loadData();
    }, 1000);
  };

  const handleDeleteDoc = async (id: string): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;
    await api.spsHealthDeleteMedicalDoc(id);
    loadData();
  };

  return (
    <div className="health-dashboard">
      <header className="health-header">
        <div className="health-title">
          <span className="emoji-large">❤️</span>
          <span>My Health & Ledger</span>
        </div>
        <div className="flex-row-gap-12">
          <button
            className="log-submit-btn refresh-btn-style"
            onClick={() => loadData()}
          >
            <Icon name="refresh" size={13} className="refresh-icon-style" />{" "}
            Refresh
          </button>
        </div>
      </header>

      <div className="tabs-bar">
        <button
          className={`tab-btn ${activeTab === "journal" ? "active" : ""}`}
          onClick={() => setActiveTab("journal")}
        >
          <Icon name="comment" size={14} className="tab-icon-style" /> Apple
          Journal (Timeline)
        </button>
        <button
          className={`tab-btn ${activeTab === "peptide" ? "active" : ""}`}
          onClick={() => setActiveTab("peptide")}
        >
          <Icon name="board" size={14} className="tab-icon-style" /> Peptide
          Ledger & Math
        </button>
        <button
          className={`tab-btn ${activeTab === "vault" ? "active" : ""}`}
          onClick={() => setActiveTab("vault")}
        >
          <Icon name="doc" size={14} className="tab-icon-style" /> Medical Vault
          & Trends
        </button>
        <button
          className={`tab-btn ${activeTab === "news" ? "active" : ""}`}
          onClick={() => setActiveTab("news")}
        >
          <span className="tab-icon-style">📰</span> Clinical Digest (
          {clinicalDigest.length})
        </button>
      </div>

      <div className="dashboard-content scroll">
        {activeTab === "journal" && (
          <div className="journal-timeline">
            {/* Autonomous reflection prompt */}
            <div className="glass-panel reflection-banner">
              <div className="reflection-title">
                💡 Personal Reflection Prompts
              </div>
              <p className="reflection-text">
                {biometricLogs.length > 0 &&
                biometricLogs[biometricLogs.length - 1].weight_kg
                  ? `Your current weight is logged at ${biometricLogs[biometricLogs.length - 1].weight_kg} kg. Reflect on how your appetite levels have settled over this GLP-1 dosing week.`
                  : "You haven't logged biometrics today. Take a moment to log your weight, sleep status, or peptide regimens."}
              </p>
            </div>

            {/* Quick Log Form */}
            <div className="glass-panel quick-log-box">
              <h3 className="heading-quick-log">Quick Log Biometrics</h3>
              <div className="log-grid">
                <div className="log-input-group">
                  <label htmlFor="quick-weight">Weight (kg)</label>
                  <input
                    id="quick-weight"
                    type="number"
                    step="0.1"
                    value={quickWeight}
                    placeholder="e.g. 78.4"
                    title="Weight in kilograms"
                    onChange={(e) => setQuickWeight(e.target.value)}
                  />
                </div>
                <div className="log-input-group">
                  <label htmlFor="quick-glucose">Fasting Glucose (mg/dL)</label>
                  <input
                    id="quick-glucose"
                    type="number"
                    value={quickGlucose}
                    placeholder="e.g. 92"
                    title="Fasting Glucose in mg/dL"
                    onChange={(e) => setQuickGlucose(e.target.value)}
                  />
                </div>
                <div className="log-input-group">
                  <label htmlFor="quick-bp">Blood Pressure (SYS/DIA)</label>
                  <input
                    id="quick-bp"
                    type="text"
                    value={quickBP}
                    placeholder="e.g. 120/80"
                    title="Blood Pressure SYS/DIA"
                    onChange={(e) => setQuickBP(e.target.value)}
                  />
                </div>
                <button className="log-submit-btn" onClick={handleAddBiometric}>
                  Save Metrics
                </button>
              </div>
            </div>

            {/* Apple Journal Paradigm - Log Ingest Card */}
            <div className="glass-panel journal-reflection-panel">
              <h3 className="journal-reflection-heading">
                New Journal Reflection
              </h3>
              <textarea
                className="journal-textarea"
                placeholder="How do you feel today? Reflect on your energy levels, meditation metrics, and stack compliance..."
                title="New Journal Reflection text"
                value={quickJournalText}
                onChange={(e) => setQuickJournalText(e.target.value)}
              />
              <div className="journal-actions-row">
                <div className="flex-row-gap-10">
                  <button
                    className={`log-submit-btn record-audio-btn ${isRecording ? "recording" : ""}`}
                    onClick={simulateVoiceRecording}
                    disabled={isRecording}
                  >
                    🎙️ {isRecording ? "Listening..." : "Record Audio Note"}
                  </button>
                  <button
                    className="log-submit-btn snap-food-btn"
                    onClick={simulateFoodUpload}
                    disabled={isUploadingFood}
                  >
                    📸{" "}
                    {isUploadingFood
                      ? `Scanning food (${uploadProgress}%)`
                      : "Snap Food Photo"}
                  </button>
                </div>
                <div className="flex-row-gap-12-center">
                  <label htmlFor="quick-mood" className="mood-label">
                    Mood: {quickMood}/10
                  </label>
                  <input
                    id="quick-mood"
                    type="range"
                    min="1"
                    max="10"
                    value={quickMood}
                    title="Mood score out of 10"
                    onChange={(e) => setQuickMood(parseInt(e.target.value))}
                  />
                  <button
                    className="log-submit-btn save-journal-entry-btn"
                    onClick={handleAddJournalText}
                  >
                    Save Entry
                  </button>
                </div>
              </div>
            </div>

            {/* Timeline Feed */}
            <h3 className="timeline-heading">Timeline Activity</h3>
            {journalEntries.map((entry) => (
              <div key={entry.id} className="glass-panel timeline-card">
                <button
                  className="timeline-delete-btn"
                  onClick={() => {
                    const api = window.hermesAPI;
                    if (api) {
                      api.spsHealthDeleteJournalEntry(entry.id);
                      loadData();
                    }
                  }}
                  title="Delete Entry"
                  aria-label="Delete Entry"
                >
                  <Icon name="trash" size={14} />
                </button>
                <div className="card-meta">
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                  {entry.mood_score && (
                    <span className="mood-badge">
                      Mood: {entry.mood_score}/10
                    </span>
                  )}
                </div>
                <div className="card-text">{entry.text_raw}</div>
                {entry.voice_transcription && (
                  <div className="voice-transcription-row">
                    <span>🎙️ Voice Transcribed:</span>
                    <span>{entry.voice_transcription}</span>
                  </div>
                )}
                {entry.media && entry.media.length > 0 && (
                  <div className="media-grid">
                    {entry.media.map((m) => (
                      <div key={m.id} className="media-item-box">
                        <div className="media-item-placeholder">
                          <span className="media-emoji">🥗</span>
                        </div>
                        <div className="media-overlay-info">
                          <div className="media-overlay-title">
                            {m.parsed_payload?.foodName}
                          </div>
                          <div className="media-overlay-subtitle">
                            {m.parsed_payload?.calories} cal · P:
                            {m.parsed_payload?.protein}g · C:
                            {m.parsed_payload?.carbs}g · F:
                            {m.parsed_payload?.fat}g
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="tag-container">
                  {entry.tags.map((t) => (
                    <span key={t} className="timeline-tag">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "peptide" && (
          <div className="flex-col-gap-24">
            {/* Reconstitution Calculator */}
            <div className="glass-panel peptide-reconstitution-panel">
              <h3 className="peptide-reconstitution-heading">
                Peptide Reconstitution Calculator
              </h3>
              <div className="peptide-reconstitution-box">
                <div className="flex-col-gap-16">
                  <div className="log-input-group">
                    <label htmlFor="recalc-vial-mg">Vial Size (mg)</label>
                    <input
                      id="recalc-vial-mg"
                      type="number"
                      value={vialMg}
                      title="Vial Size"
                      placeholder="Vial size in mg"
                      onChange={(e) => setVialMg(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="log-input-group">
                    <label htmlFor="recalc-diluent-ml">
                      Diluent Added (mL of Bacteriostatic Water)
                    </label>
                    <input
                      id="recalc-diluent-ml"
                      type="number"
                      step="0.1"
                      value={diluentMl}
                      title="Diluent Volume"
                      placeholder="Diluent in mL"
                      onChange={(e) => setDiluentMl(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="log-input-group">
                    <label htmlFor="recalc-target-mcg">Target Dose (mcg)</label>
                    <input
                      id="recalc-target-mcg"
                      type="number"
                      value={targetMcg}
                      title="Target Dose"
                      placeholder="Target dose in mcg"
                      onChange={(e) => setTargetMcg(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="log-input-group">
                    <label htmlFor="recalc-syringe-calib">
                      Syringe Marking (Units)
                    </label>
                    <select
                      id="recalc-syringe-calib"
                      value={syringeCalib}
                      title="Syringe calibration (units)"
                      onChange={(e) =>
                        setSyringeCalib(parseInt(e.target.value))
                      }
                    >
                      <option value={100}>U-100 (100 units = 1.0mL)</option>
                      <option value={50}>U-50 (50 units = 0.5mL)</option>
                      <option value={40}>U-40 (40 units = 1.0mL)</option>
                    </select>
                  </div>
                  <div className="syringe-plunger-result">
                    <div className="syringe-plunger-label">
                      Required Syringe Plunger Position:
                    </div>
                    <div className="syringe-plunger-value">
                      {calculatedSyringeUnits.toFixed(1)} Units
                    </div>
                    <div className="syringe-plunger-formula">
                      Formula: ({targetMcg}mcg / ({vialMg}mg * 1000) *{" "}
                      {diluentMl}mL) * {syringeCalib} calib
                    </div>
                  </div>
                </div>

                {/* SVG Visual Syringe */}
                <div className="syringe-container">
                  <div className="flex-row-center-align">
                    <div className="syringe-label-title">
                      Interactive Syringe Plunger Overlay
                    </div>
                    <svg
                      width="260"
                      height="80"
                      className="syringe-svg"
                      aria-label="Syringe layout"
                    >
                      {/* Syringe barrel */}
                      <rect
                        x="10"
                        y="20"
                        width="220"
                        height="40"
                        fill="rgba(255,255,255,0.05)"
                        stroke="#64748b"
                        strokeWidth="2"
                        rx="4"
                      />
                      {/* Needle connector */}
                      <polygon
                        points="230,35 240,35 240,45 230,45"
                        fill="#94a3b8"
                      />
                      <line
                        x1="240"
                        y1="40"
                        x2="255"
                        y2="40"
                        stroke="#cbd5e1"
                        strokeWidth="2"
                      />
                      {/* Syringe grid ticks */}
                      <line x1="10" y1="20" x2="10" y2="30" stroke="#94a3b8" />
                      <line x1="30" y1="20" x2="30" y2="26" stroke="#64748b" />
                      <line x1="50" y1="20" x2="50" y2="30" stroke="#94a3b8" />
                      <line x1="70" y1="20" x2="70" y2="26" stroke="#64748b" />
                      <line x1="90" y1="20" x2="90" y2="30" stroke="#94a3b8" />
                      <line
                        x1="110"
                        y1="20"
                        x2="110"
                        y2="26"
                        stroke="#64748b"
                      />
                      <line
                        x1="130"
                        y1="20"
                        x2="130"
                        y2="30"
                        stroke="#94a3b8"
                      />
                      <line
                        x1="150"
                        y1="20"
                        x2="150"
                        y2="26"
                        stroke="#64748b"
                      />
                      <line
                        x1="170"
                        y1="20"
                        x2="170"
                        y2="30"
                        stroke="#94a3b8"
                      />
                      <line
                        x1="190"
                        y1="20"
                        x2="190"
                        y2="26"
                        stroke="#64748b"
                      />
                      <line
                        x1="210"
                        y1="20"
                        x2="210"
                        y2="30"
                        stroke="#94a3b8"
                      />
                      <line
                        x1="230"
                        y1="20"
                        x2="230"
                        y2="30"
                        stroke="#94a3b8"
                      />
                      {/* Plunger liquid fills up to plunger position */}
                      <rect
                        x="10"
                        y="22"
                        width={plungerWidthPx}
                        height="36"
                        fill="rgba(52,211,153,0.3)"
                      />
                      {/* Syringe Plunger shaft */}
                      <rect
                        x={10 + plungerWidthPx}
                        y="22"
                        width="2"
                        height="36"
                        fill="#34d399"
                      />
                      <rect
                        x="0"
                        y="38"
                        width={10 + plungerWidthPx}
                        height="4"
                        fill="rgba(100,116,139,0.5)"
                      />
                      <rect
                        x="0"
                        y="24"
                        width="10"
                        height="32"
                        fill="#475569"
                      />
                    </svg>
                    <div className="syringe-label-bottom">
                      Fill to:{" "}
                      <span className="syringe-label-highlight">
                        {calculatedSyringeUnits.toFixed(1)} units
                      </span>{" "}
                      (marked in green above)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Protocols Manager */}
            <div className="glass-panel regimen-scheduler-panel">
              <h3 className="regimen-scheduler-heading">Regimen Scheduler</h3>

              {/* Add Protocol Form */}
              <div className="create-protocol-row">
                <div className="log-input-group">
                  <label htmlFor="new-protocol-name">Name</label>
                  <input
                    id="new-protocol-name"
                    type="text"
                    value={newProtocolName}
                    placeholder="e.g. Tirzepatide"
                    title="Protocol Name"
                    onChange={(e) => setNewProtocolName(e.target.value)}
                  />
                </div>
                <div className="log-input-group">
                  <label htmlFor="new-protocol-type">Type</label>
                  <select
                    id="new-protocol-type"
                    value={newProtocolType}
                    title="Protocol Type"
                    onChange={(e) => setNewProtocolType(e.target.value)}
                  >
                    <option value="peptide">Peptide / GLP1</option>
                    <option value="supplement">Supplement</option>
                    <option value="rx">Prescription Rx</option>
                  </select>
                </div>
                <div className="log-input-group">
                  <label htmlFor="new-protocol-unit">Dosage Unit</label>
                  <select
                    id="new-protocol-unit"
                    value={newProtocolUnit}
                    title="Dosage Unit"
                    onChange={(e) => setNewProtocolUnit(e.target.value)}
                  >
                    <option value="mcg">mcg</option>
                    <option value="mg">mg</option>
                    <option value="pill">pill</option>
                  </select>
                </div>
                <button className="log-submit-btn" onClick={handleAddProtocol}>
                  Create Protocol
                </button>
              </div>

              {/* Protocol Grid */}
              <div className="protocol-grid">
                {protocols.map((p) => {
                  const pLogs = medLogs.filter((l) => l.protocol_id === p.id);
                  return (
                    <div key={p.id} className="glass-panel protocol-card">
                      <button
                        className="protocol-delete-btn"
                        onClick={() => handleDeleteProtocol(p.id)}
                        title="Delete Protocol"
                        aria-label="Delete Protocol"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                      <h4 className="protocol-name">{p.name}</h4>
                      <div className="protocol-info-list">
                        <div>
                          Type:{" "}
                          <span className="protocol-info-value">
                            {p.substance_type}
                          </span>
                        </div>
                        <div>
                          Schedule:{" "}
                          <span className="protocol-info-value">
                            {p.schedule_cron}
                          </span>
                        </div>
                        <div>
                          Dose Units:{" "}
                          <span className="protocol-info-value">
                            {p.dosage_unit}
                          </span>
                        </div>
                        {p.vial_size_mg && (
                          <div>
                            Dilution:{" "}
                            <span className="protocol-info-value">
                              {p.vial_size_mg}mg / {p.diluent_ml}mL
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="protocol-card-footer">
                        <span className="protocol-admin-count">
                          Administered: {pLogs.length} times
                        </span>
                        <button
                          className="log-submit-btn protocol-record-btn"
                          onClick={() => logAdministration(p)}
                        >
                          ⚡ Record Administration
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "vault" && (
          <div className="medical-vault-layout">
            <div className="doc-list-sidebar">
              <button
                className="log-submit-btn scan-pdf-btn"
                onClick={simulateOcrDocument}
              >
                📁 Scan Lab PDF (Simulate OCR)
              </button>

              <h3 className="doc-list-heading">Reports</h3>
              {medicalDocs.map((doc) => (
                <div key={doc.id} className="doc-card-item">
                  <div className="doc-card-header">
                    <span className="doc-card-title-text">{doc.file_name}</span>
                    <button
                      className="doc-card-delete-btn"
                      onClick={() => handleDeleteDoc(doc.id)}
                      title="Delete Document"
                      aria-label="Delete Document"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="doc-card-date">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </div>
                  <div className="doc-card-biomarkers">
                    {doc.extracted_biomarkers?.map((b) => (
                      <span
                        key={b.name}
                        className={`biomarker-tag ${b.isOutOfRange ? "out-of-range" : "normal-range"}`}
                      >
                        {b.name}: {b.value}
                        {b.unit}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Trends Section */}
            <div className="glass-panel biomarker-trends-panel">
              <h3 className="trends-heading">Biometric & Biomarker Charts</h3>

              <div className="flex-row-gap-12">
                <span className="trend-tab-label">Weight Trend</span>
                <span className="trend-tab-label">HbA1c</span>
                <span className="trend-tab-label">ApoB</span>
              </div>

              {/* Custom SVG Line Chart */}
              <div className="trends-chart-container">
                <div className="trends-chart-title">
                  Weight Ledger (kg) over Time
                </div>
                {activeLogs.length > 1 ? (
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 500 200"
                    preserveAspectRatio="none"
                    aria-label="Weight trend chart"
                  >
                    {/* Vertical grid lines */}
                    <line
                      x1="50"
                      y1="20"
                      x2="50"
                      y2="170"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <line
                      x1="150"
                      y1="20"
                      x2="150"
                      y2="170"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <line
                      x1="250"
                      y1="20"
                      x2="250"
                      y2="170"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <line
                      x1="350"
                      y1="20"
                      x2="350"
                      y2="170"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <line
                      x1="450"
                      y1="20"
                      x2="450"
                      y2="170"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    {/* Shaded baseline weight goal target */}
                    <rect
                      x="50"
                      y="80"
                      width="400"
                      height="2"
                      fill="rgba(52,211,153,0.4)"
                    />
                    <text x="400" y="75" fill="#34d399" fontSize="8">
                      Goal: 80kg
                    </text>

                    {/* Plot Line */}
                    <path
                      d={activeLogs
                        .map((log, index) => {
                          const x =
                            50 + (index / (activeLogs.length - 1)) * 400;
                          const y =
                            170 -
                            ((log.weight_kg! - minWeight) /
                              (maxWeight - minWeight)) *
                              150;
                          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2.5"
                    />

                    {/* Data dots */}
                    {activeLogs.map((log, index) => {
                      const x = 50 + (index / (activeLogs.length - 1)) * 400;
                      const y =
                        170 -
                        ((log.weight_kg! - minWeight) /
                          (maxWeight - minWeight)) *
                          150;
                      return (
                        <g key={log.id}>
                          <circle
                            cx={x}
                            cy={y}
                            r="4"
                            fill="#3b82f6"
                            stroke="#fff"
                            strokeWidth="1"
                          />
                          <text x={x - 10} y={y - 8} fill="#fff" fontSize="8">
                            {log.weight_kg}kg
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <div className="trends-chart-empty">
                    Not enough biometric logs to plot weight chart. Log multiple
                    weights on the journal timeline first.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "news" && (
          <div className="news-list-container">
            <h3 className="news-main-heading">Personalized Clinical digests</h3>
            <p className="news-intro-text">
              These research updates are synthesized periodically by matching
              articles in your RSS subscription against active conditions:{" "}
              {profile?.active_conditions?.map((c: string) => (
                <span key={c} className="news-condition-tag">
                  {c}
                </span>
              ))}
            </p>

            {clinicalDigest.map((art) => (
              <div key={art.id} className="glass-panel digest-card">
                <div className="digest-card-header">
                  <span className="relevance-score-badge">
                    Relevance Match: {art.relevance_score}%
                  </span>
                  <span className="digest-card-feed-title">
                    {art.feed_title}
                  </span>
                </div>
                <h4 className="digest-card-title">{art.title}</h4>
                <p className="digest-card-excerpt">{art.summary_excerpt}</p>
                <div className="digest-card-footer">
                  <span className="digest-card-date">
                    Published: {new Date(art.published_at).toLocaleDateString()}
                  </span>
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noreferrer"
                    className="digest-card-link"
                  >
                    Read Full Paper →
                  </a>
                </div>
              </div>
            ))}

            {clinicalDigest.length === 0 && (
              <div className="digest-empty-text">
                No active RAG research digest matches. Add clinical RSS feeds in
                the RSS Reader and click Sync to match articles.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
