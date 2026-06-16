import { getSharedDb } from "../db";
import { safeHandle } from "./safe-handle";
import { randomUUID } from "crypto";
import {
  discoverSubstackFeed,
  fetchRssArticles,
  type ParsedRssArticle,
} from "../rss-discovery";

type JsonRecord = Record<string, unknown>;

export function addRssFeedRecord(feedData: JsonRecord | undefined): string {
  const db = getSharedDb(false);
  if (!db) throw new Error("Database not available");

  const id = randomUUID();
  const url = feedData?.url;
  const title = feedData?.title || "Untitled Feed";
  const site_url = feedData?.site_url || "";
  const description = feedData?.description || "";
  const category = feedData?.category || "Uncategorized";

  if (typeof url === "string") {
    const existing = db
      .prepare("SELECT id FROM rss_feeds WHERE url = ?")
      .get(url) as { id: string } | undefined;
    if (existing?.id) return existing.id;
  }

  try {
    db.prepare(
      `INSERT INTO rss_feeds (id, url, title, site_url, description, category, last_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, url, title, site_url, description, category, Date.now());
  } catch (err) {
    if (typeof url === "string") {
      const existing = db
        .prepare("SELECT id FROM rss_feeds WHERE url = ?")
        .get(url) as { id: string } | undefined;
      if (existing?.id) return existing.id;
    }
    throw err;
  }

  return id;
}

interface RssArticleQuery {
  feedId?: string;
  readStatus?: number;
  starStatus?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

interface MockArticle {
  guid: string;
  title: string;
  author: string;
  url: string;
  published_at: number;
  content_raw: string;
  content_text: string;
  summary_excerpt: string;
  relevance_score: number;
}

type RssArticleInsert = ParsedRssArticle | MockArticle;

export function registerHealthRssIpc(): void {
  // --- HEALTH MODULE ---

  // Get active health profile
  safeHandle("sps-health-get-profile", async () => {
    const db = getSharedDb(false);
    if (!db) return null;

    let row = db
      .prepare("SELECT * FROM health_profiles WHERE id = ?")
      .get("default") as JsonRecord | undefined;
    if (!row) {
      db.prepare(
        `INSERT INTO health_profiles (id, weight_goal_kg, muscle_goal_kg, active_conditions, med_and_supp_list, rss_feeds)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "default",
        80,
        35,
        JSON.stringify(["Metabolic Health", "Sleep Quality"]),
        JSON.stringify(["Vitamin D3", "Omega-3", "Magnesium Glycinate"]),
        JSON.stringify([]),
      );
      row = db
        .prepare("SELECT * FROM health_profiles WHERE id = ?")
        .get("default") as JsonRecord | undefined;
    }

    if (row) {
      // Deserialize JSON fields
      row.active_conditions = JSON.parse(String(row.active_conditions || "[]"));
      row.med_and_supp_list = JSON.parse(String(row.med_and_supp_list || "[]"));
      row.rss_feeds = JSON.parse(String(row.rss_feeds || "[]"));
    }
    return row;
  });

  // Save/Update health profile
  safeHandle("sps-health-save-profile", async (_event, ...args) => {
    const profileData = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) return false;

    db.prepare(
      `INSERT INTO health_profiles (id, weight_goal_kg, muscle_goal_kg, active_conditions, med_and_supp_list, rss_feeds)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         weight_goal_kg = excluded.weight_goal_kg,
         muscle_goal_kg = excluded.muscle_goal_kg,
         active_conditions = excluded.active_conditions,
         med_and_supp_list = excluded.med_and_supp_list,
         rss_feeds = excluded.rss_feeds`,
    ).run(
      "default",
      profileData?.weight_goal_kg || 80,
      profileData?.muscle_goal_kg || 35,
      JSON.stringify(profileData?.active_conditions || []),
      JSON.stringify(profileData?.med_and_supp_list || []),
      JSON.stringify(profileData?.rss_feeds || []),
    );
    return true;
  });

  // Add/Update journal entry
  safeHandle("sps-health-add-journal-entry", async (_event, ...args) => {
    const entry = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) throw new Error("Database not available");

    const id = entry?.id || randomUUID();
    const timestamp = entry?.timestamp || Date.now();
    const text_raw = entry?.text_raw || "";
    const voice_transcription = entry?.voice_transcription || "";
    const mood_score = entry?.mood_score || null;
    const tags = JSON.stringify(entry?.tags || []);

    db.prepare(
      `INSERT INTO journal_entries (id, timestamp, text_raw, voice_transcription, mood_score, tags)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text_raw = excluded.text_raw,
         voice_transcription = excluded.voice_transcription,
         mood_score = excluded.mood_score,
         tags = excluded.tags`,
    ).run(id, timestamp, text_raw, voice_transcription, mood_score, tags);

    // Handle media attachments if present
    if (Array.isArray(entry?.media)) {
      db.prepare("DELETE FROM journal_media WHERE entry_id = ?").run(id);
      const insertMedia = db.prepare(
        `INSERT INTO journal_media (id, entry_id, file_path, mime_type, parsed_payload)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const m of entry.media) {
        insertMedia.run(
          m.id || randomUUID(),
          id,
          m.file_path,
          m.mime_type || "image/png",
          JSON.stringify(m.parsed_payload || {}),
        );
      }
    }

    return id;
  });

  // Get all journal entries
  safeHandle("sps-health-get-journal-entries", async () => {
    const db = getSharedDb(true);
    if (!db) return [];

    const entries = db
      .prepare("SELECT * FROM journal_entries ORDER BY timestamp DESC")
      .all() as JsonRecord[];
    for (const entry of entries) {
      entry.tags = JSON.parse(String(entry.tags || "[]"));
      // Load associated media
      entry.media = db
        .prepare("SELECT * FROM journal_media WHERE entry_id = ?")
        .all(entry.id) as JsonRecord[];
      for (const m of entry.media as JsonRecord[]) {
        m.parsed_payload = JSON.parse(String(m.parsed_payload || "{}"));
      }
    }
    return entries;
  });

  // Delete journal entry
  safeHandle("sps-health-delete-journal-entry", async (_event, ...args) => {
    const entryId = args[0] as string;
    const db = getSharedDb(false);
    if (!db) return false;
    db.prepare("DELETE FROM journal_entries WHERE id = ?").run(entryId);
    return true;
  });

  // Add biometric log
  safeHandle("sps-health-add-biometric-log", async (_event, ...args) => {
    const logData = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) throw new Error("Database not available");

    const id = logData?.id || randomUUID();
    const timestamp = logData?.timestamp || Date.now();
    const weight_kg =
      logData?.weight_kg !== undefined ? logData.weight_kg : null;
    const skeletal_muscle_mass_kg =
      logData?.skeletal_muscle_mass_kg !== undefined
        ? logData.skeletal_muscle_mass_kg
        : null;
    const body_fat_pct =
      logData?.body_fat_pct !== undefined ? logData.body_fat_pct : null;
    const systolic_bp =
      logData?.systolic_bp !== undefined ? logData.systolic_bp : null;
    const diastolic_bp =
      logData?.diastolic_bp !== undefined ? logData.diastolic_bp : null;
    const fasting_glucose_mgdl =
      logData?.fasting_glucose_mgdl !== undefined
        ? logData.fasting_glucose_mgdl
        : null;
    const sleep_duration_min =
      logData?.sleep_duration_min !== undefined
        ? logData.sleep_duration_min
        : null;
    const sleep_deep_min =
      logData?.sleep_deep_min !== undefined ? logData.sleep_deep_min : null;
    const sleep_score =
      logData?.sleep_score !== undefined ? logData.sleep_score : null;
    const hrv_ms = logData?.hrv_ms !== undefined ? logData.hrv_ms : null;

    db.prepare(
      `INSERT INTO biometric_ledger (
         id, timestamp, weight_kg, skeletal_muscle_mass_kg, body_fat_pct,
         systolic_bp, diastolic_bp, fasting_glucose_mgdl,
         sleep_duration_min, sleep_deep_min, sleep_score, hrv_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      timestamp,
      weight_kg,
      skeletal_muscle_mass_kg,
      body_fat_pct,
      systolic_bp,
      diastolic_bp,
      fasting_glucose_mgdl,
      sleep_duration_min,
      sleep_deep_min,
      sleep_score,
      hrv_ms,
    );
    return id;
  });

  // Get biometric logs (ordered chronologically for charts)
  safeHandle("sps-health-get-biometric-logs", async () => {
    const db = getSharedDb(true);
    if (!db) return [];
    return db
      .prepare("SELECT * FROM biometric_ledger ORDER BY timestamp ASC")
      .all();
  });

  // Save/Update Medication Protocol
  safeHandle("sps-health-save-medication-protocol", async (_event, ...args) => {
    const protocol = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) throw new Error("Database not available");

    const id = protocol?.id || randomUUID();
    const name = protocol?.name;
    const substance_type = protocol?.substance_type || "supplement";
    const vial_size_mg = protocol?.vial_size_mg || null;
    const diluent_ml = protocol?.diluent_ml || null;
    const dosage_unit = protocol?.dosage_unit || "mg";
    const syringe_units_per_ml = protocol?.syringe_units_per_ml || 100;
    const half_life_hours = protocol?.half_life_hours || null;
    const schedule_cron = protocol?.schedule_cron || "0 9 * * *";
    const titration_steps = JSON.stringify(protocol?.titration_steps || []);

    db.prepare(
      `INSERT INTO medication_protocols (
         id, name, substance_type, vial_size_mg, diluent_ml,
         dosage_unit, syringe_units_per_ml, half_life_hours, schedule_cron, titration_steps
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         substance_type = excluded.substance_type,
         vial_size_mg = excluded.vial_size_mg,
         diluent_ml = excluded.diluent_ml,
         dosage_unit = excluded.dosage_unit,
         syringe_units_per_ml = excluded.syringe_units_per_ml,
         half_life_hours = excluded.half_life_hours,
         schedule_cron = excluded.schedule_cron,
         titration_steps = excluded.titration_steps`,
    ).run(
      id,
      name,
      substance_type,
      vial_size_mg,
      diluent_ml,
      dosage_unit,
      syringe_units_per_ml,
      half_life_hours,
      schedule_cron,
      titration_steps,
    );
    return id;
  });

  // Get all protocols
  safeHandle("sps-health-get-medication-protocols", async () => {
    const db = getSharedDb(true);
    if (!db) return [];
    const rows = db
      .prepare("SELECT * FROM medication_protocols")
      .all() as JsonRecord[];
    for (const row of rows) {
      row.titration_steps = JSON.parse(String(row.titration_steps || "[]"));
    }
    return rows;
  });

  // Delete Medication Protocol
  safeHandle(
    "sps-health-delete-medication-protocol",
    async (_event, ...args) => {
      const protocolId = args[0] as string;
      const db = getSharedDb(false);
      if (!db) return false;
      db.prepare("DELETE FROM medication_protocols WHERE id = ?").run(
        protocolId,
      );
      return true;
    },
  );

  // Add Medication Administration Log
  safeHandle("sps-health-add-medication-log", async (_event, ...args) => {
    const mLog = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) throw new Error("Database not available");

    const id = mLog?.id || randomUUID();
    const protocol_id = mLog?.protocol_id;
    const timestamp = mLog?.timestamp || Date.now();
    const dose_administered = mLog?.dose_administered;
    const injection_site = mLog?.injection_site || null;
    const side_effects = JSON.stringify(mLog?.side_effects || []);

    db.prepare(
      `INSERT INTO medication_logs (id, protocol_id, timestamp, dose_administered, injection_site, side_effects)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      protocol_id,
      timestamp,
      dose_administered,
      injection_site,
      side_effects,
    );
    return id;
  });

  // Get Medication Logs
  safeHandle("sps-health-get-medication-logs", async () => {
    const db = getSharedDb(true);
    if (!db) return [];
    const rows = db
      .prepare("SELECT * FROM medication_logs ORDER BY timestamp DESC")
      .all() as JsonRecord[];
    for (const row of rows) {
      row.side_effects = JSON.parse(String(row.side_effects || "[]"));
    }
    return rows;
  });

  // Get all Medical Vault Documents
  safeHandle("sps-health-get-medical-docs", async () => {
    const db = getSharedDb(true);
    if (!db) return [];
    const rows = db
      .prepare("SELECT * FROM medical_vault_docs ORDER BY uploaded_at DESC")
      .all() as JsonRecord[];
    for (const row of rows) {
      row.extracted_biomarkers = JSON.parse(
        String(row.extracted_biomarkers || "[]"),
      );
    }
    return rows;
  });

  // Add Medical Vault Document
  safeHandle("sps-health-add-medical-doc", async (_event, ...args) => {
    const doc = args[0] as JsonRecord | undefined;
    const db = getSharedDb(false);
    if (!db) throw new Error("Database not available");

    const id = doc?.id || randomUUID();
    const file_name = doc?.file_name;
    const file_path = doc?.file_path;
    const uploaded_at = doc?.uploaded_at || Date.now();
    const doc_type = doc?.doc_type || "lab_report";
    const ocr_content_text = String(doc?.ocr_content_text || "");

    // Simple layout-aware NER/Biomarker extraction using regex matches on the text
    const extracted: JsonRecord[] = [];

    // Regular expression helpers for key biomarkers
    const patterns = [
      {
        name: "HbA1c",
        regex: /(?:hba1c|a1c)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i,
        unit: "%",
        low: 4.0,
        high: 5.6,
      },
      {
        name: "ApoB",
        regex: /(?:apob|apolipoprotein\s*b)\s*[:=]?\s*(\d+)\s*(?:mg\/dl)?/i,
        unit: "mg/dL",
        low: 0,
        high: 90,
      },
      {
        name: "LDL Cholesterol",
        regex: /(?:ldl|ldl-c)\s*[:=]?\s*(\d+)\s*(?:mg\/dl)?/i,
        unit: "mg/dL",
        low: 0,
        high: 99,
      },
      {
        name: "HDL Cholesterol",
        regex: /(?:hdl|hdl-c)\s*[:=]?\s*(\d+)\s*(?:mg\/dl)?/i,
        unit: "mg/dL",
        low: 40,
        high: 100,
      },
      {
        name: "Fasting Insulin",
        regex:
          /(?:fasting\s+)?insulin\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:u[iu]\/ml|pmol\/l)?/i,
        unit: "uIU/mL",
        low: 2.0,
        high: 8.0,
      },
      {
        name: "Fasting Glucose",
        regex: /(?:fasting\s+)?glucose\s*[:=]?\s*(\d+)\s*(?:mg\/dl)?/i,
        unit: "mg/dL",
        low: 70,
        high: 99,
      },
    ];

    for (const pat of patterns) {
      const match = ocr_content_text.match(pat.regex);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        extracted.push({
          name: pat.name,
          value: val,
          unit: pat.unit,
          referenceRangeLow: pat.low,
          referenceRangeHigh: pat.high,
          isOutOfRange: val < pat.low || val > pat.high,
        });
      }
    }

    // Also look for Blood Pressure e.g., 120/80
    const bpMatch = ocr_content_text.match(
      /(?:blood\s*pressure|bp)\s*[:=]?\s*(\d{2,3})\s*[/\\]\s*(\d{2,3})/i,
    );
    if (bpMatch && bpMatch[1] && bpMatch[2]) {
      const sys = parseInt(bpMatch[1], 10);
      const dia = parseInt(bpMatch[2], 10);
      extracted.push({
        name: "Blood Pressure",
        value: `${sys}/${dia}`,
        unit: "mmHg",
        referenceRangeLow: 90 / 60,
        referenceRangeHigh: 120 / 80,
        isOutOfRange: sys > 120 || dia > 80,
      });
    }

    const extracted_biomarkers = JSON.stringify(extracted);

    db.prepare(
      `INSERT INTO medical_vault_docs (id, file_name, file_path, uploaded_at, doc_type, ocr_content_text, extracted_biomarkers)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      file_name,
      file_path,
      uploaded_at,
      doc_type,
      ocr_content_text,
      extracted_biomarkers,
    );

    return id;
  });

  // Delete Medical Vault Doc
  safeHandle("sps-health-delete-medical-doc", async (_event, ...args) => {
    const docId = args[0] as string;
    const db = getSharedDb(false);
    if (!db) return false;
    db.prepare("DELETE FROM medical_vault_docs WHERE id = ?").run(docId);
    return true;
  });

  // --- RSS MODULE ---

  // Get RSS Feeds
  safeHandle("sps-rss-get-feeds", async () => {
    const db = getSharedDb(true);
    if (!db) return [];
    return db.prepare("SELECT * FROM rss_feeds").all();
  });

  // Discover public Substack feed metadata from a publication or article URL
  safeHandle("sps-rss-discover-substack", async (_event, ...args) => {
    const inputUrl = String(args[0] || "");
    return discoverSubstackFeed(inputUrl);
  });

  // Add Feed
  safeHandle("sps-rss-add-feed", async (_event, ...args) => {
    const feedData = args[0] as JsonRecord | undefined;
    return addRssFeedRecord(feedData);
  });

  // Delete Feed
  safeHandle("sps-rss-delete-feed", async (_event, ...args) => {
    const feedId = args[0] as string;
    const db = getSharedDb(false);
    if (!db) return false;
    db.prepare("DELETE FROM rss_feeds WHERE id = ?").run(feedId);
    return true;
  });

  // Get Articles with FTS Search & filters
  safeHandle("sps-rss-get-articles", async (_event, ...args) => {
    const query = args[0] as RssArticleQuery | undefined;
    const db = getSharedDb(true);
    if (!db) return [];

    let sql =
      "SELECT a.*, f.title as feed_title FROM rss_articles a JOIN rss_feeds f ON a.feed_id = f.id";
    const params: Array<string | number> = [];
    const clauses: string[] = [];

    if (query?.feedId) {
      clauses.push("a.feed_id = ?");
      params.push(query.feedId);
    }
    if (query?.readStatus !== undefined) {
      clauses.push("a.read_status = ?");
      params.push(query.readStatus);
    }
    if (query?.starStatus !== undefined) {
      clauses.push("a.star_status = ?");
      params.push(query.starStatus);
    }
    if (query?.search) {
      // Join on FTS virtual table
      sql = `
        SELECT a.*, f.title as feed_title
        FROM rss_articles a
        JOIN rss_feeds f ON a.feed_id = f.id
        JOIN rss_articles_fts fts ON fts.rowid = a.rowid
        WHERE rss_articles_fts MATCH ?
      `;
      params.push(query.search);
    }

    if (clauses.length > 0) {
      if (sql.includes("WHERE")) {
        sql += " AND " + clauses.join(" AND ");
      } else {
        sql += " WHERE " + clauses.join(" AND ");
      }
    }

    sql += " ORDER BY a.published_at DESC";

    if (query?.limit) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }
    if (query?.offset) {
      sql += " OFFSET ?";
      params.push(query.offset);
    }

    return db.prepare(sql).all(...params);
  });

  // Mark Article Read
  safeHandle("sps-rss-mark-article-read", async (_event, ...args) => {
    const articleId = args[0] as string;
    const readStatus = args[1] as number;
    const db = getSharedDb(false);
    if (!db) return false;
    db.prepare("UPDATE rss_articles SET read_status = ? WHERE id = ?").run(
      readStatus,
      articleId,
    );
    return true;
  });

  // Star / Bookmark Article
  safeHandle("sps-rss-toggle-article-star", async (_event, ...args) => {
    const articleId = args[0] as string;
    const starStatus = args[1] as number;
    const db = getSharedDb(false);
    if (!db) return false;
    db.prepare("UPDATE rss_articles SET star_status = ? WHERE id = ?").run(
      starStatus,
      articleId,
    );
    return true;
  });

  // Sync RSS Feeds (fetches public RSS/Atom articles, with mock fallback for legacy seeded feeds)
  safeHandle("sps-rss-sync-feeds", async () => {
    const db = getSharedDb(false);
    if (!db) return { success: false, count: 0 };

    const feeds = db.prepare("SELECT * FROM rss_feeds").all() as JsonRecord[];
    let count = 0;

    for (const feed of feeds) {
      try {
        const feedUrl = String(feed.url || "");
        let articles: RssArticleInsert[] = [];
        if (feedUrl.startsWith("http://") || feedUrl.startsWith("https://")) {
          articles = await fetchRssArticles(feedUrl);
        }
        if (articles.length === 0) {
          articles = getMockArticlesForFeed(
            String(feed.id || ""),
            String(feed.title || ""),
          );
        }

        const insertArticle = db.prepare(
          `INSERT OR IGNORE INTO rss_articles (
            id, feed_id, guid, title, author, url, published_at, content_raw, content_text, summary_excerpt, relevance_score
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const art of articles) {
          const id = randomUUID();
          const result = insertArticle.run(
            id,
            feed.id,
            art.guid,
            art.title,
            art.author,
            art.url,
            art.published_at,
            art.content_raw,
            art.content_text,
            art.summary_excerpt,
            art.relevance_score,
          );
          count += result.changes;
        }

        db.prepare("UPDATE rss_feeds SET last_fetched_at = ? WHERE id = ?").run(
          Date.now(),
          feed.id,
        );
      } catch (err) {
        console.error(`[RSS SYNC] Failed for feed ${feed.title}:`, err);
      }
    }

    return { success: true, count };
  });

  // Clinical Digest: RSS Curation based on Health conditions
  safeHandle("sps-rss-get-clinical-digest", async () => {
    const db = getSharedDb(true);
    if (!db) return [];

    const profile = db
      .prepare("SELECT * FROM health_profiles WHERE id = ?")
      .get("default") as JsonRecord | undefined;
    if (!profile) return [];

    const conditions: string[] = JSON.parse(
      String(profile.active_conditions || "[]"),
    );
    if (conditions.length === 0) return [];

    // Search RSS articles for text matches against our conditions
    const searchQuery = conditions.map((c) => `"${c}"`).join(" OR ");

    // We do a text FTS5 query to get matches, sorting by score and date
    const sql = `
      SELECT a.*, f.title as feed_title
      FROM rss_articles a
      JOIN rss_feeds f ON a.feed_id = f.id
      JOIN rss_articles_fts fts ON fts.rowid = a.rowid
      WHERE rss_articles_fts MATCH ?
      ORDER BY a.published_at DESC
      LIMIT 10
    `;

    return db.prepare(sql).all(searchQuery);
  });
}

// Helpers for mock articles
function getMockArticlesForFeed(
  feedId: string,
  feedTitle: string,
): MockArticle[] {
  const now = Date.now();
  if (
    feedTitle.toLowerCase().includes("health") ||
    feedTitle.toLowerCase().includes("medical") ||
    feedTitle.toLowerCase().includes("biotech")
  ) {
    return [
      {
        guid: `${feedId}-art-1`,
        title:
          "Dosing and Titration Schedules of GLP-1 Receptor Agonists: A Clinical Review",
        author: "Dr. Sarah Jenkins",
        url: "https://example.com/glp1-titration",
        published_at: now - 3600000 * 2, // 2h ago
        content_raw:
          "<p>Optimal titration regimens for Tirzepatide show significant reductions in transient gastrointestinal side effects when escalating doses by 2.5mg increments over 4-week intervals. Body composition analysis confirms preservation of lean muscle mass when coupled with resistance exercise and adequate dietary protein intake.</p>",
        content_text:
          "Optimal titration regimens for Tirzepatide show significant reductions in transient gastrointestinal side effects when escalating doses by 2.5mg increments over 4-week intervals. Body composition analysis confirms preservation of lean muscle mass when coupled with resistance exercise and adequate dietary protein intake. Metabolic Health conditions show major improvement.",
        summary_excerpt:
          "A clinical breakdown of safe titration intervals for Semaglutide and Tirzepatide therapies.",
        relevance_score: 95,
      },
      {
        guid: `${feedId}-art-2`,
        title:
          "HRV and Sleep Latency: The Impact of Late-Night Nutritional Intake",
        author: "Neurology Journal",
        url: "https://example.com/hrv-sleep-latency",
        published_at: now - 3600000 * 24, // 1d ago
        content_raw:
          "<p>Elevated heart rate variability (HRV) correlates strongly with high-quality slow-wave sleep. Eating complex macronutrient meals less than 3 hours before bed reduces HRV by an average of 15% and extends sleep latency, compromising recovery metrics tracked by watchOS and WearOS devices.</p>",
        content_text:
          "Elevated heart rate variability (HRV) correlates strongly with high-quality slow-wave sleep. Eating complex macronutrient meals less than 3 hours before bed reduces HRV by an average of 15% and extends sleep latency, compromising recovery metrics tracked by watchOS and WearOS devices. Sleep Quality suffers as a result.",
        summary_excerpt:
          "Study detailing how eating windows directly suppress overnight HRV and slow-wave sleep cycles.",
        relevance_score: 88,
      },
    ];
  }

  // Tech / general feeds
  return [
    {
      guid: `${feedId}-art-1`,
      title:
        "Local-First Desktop Paradigms: Building with SQLite and SQLCipher",
      author: "Alex Rivers",
      url: "https://example.com/local-first-sqlite",
      published_at: now - 3600000 * 4, // 4h ago
      content_raw:
        "<p>Securing local desktop application data requires deep integration of file system access privileges and secure databases like SQLCipher. Storing key assets locally bypasses cloud interception concerns and guarantees full offline usability.</p>",
      content_text:
        "Securing local desktop application data requires deep integration of file system access privileges and secure databases like SQLCipher. Storing key assets locally bypasses cloud interception concerns and guarantees full offline usability.",
      summary_excerpt:
        "Exploring SQLCipher key storage and filesystem performance benchmarks in Electron.",
      relevance_score: 75,
    },
    {
      guid: `${feedId}-art-2`,
      title: "The Evolution of Multimodal AI Agents on the Edge",
      author: "AI Frontiers",
      url: "https://example.com/multimodal-agents-edge",
      published_at: now - 3600000 * 12, // 12h ago
      content_raw:
        "<p>Edge computing allows developers to deploy local Vision-Language Models directly on user machines. Scenarios such as on-device OCR, meal photo parsing, and voice dictation transcription function in zero-latency offline sandboxes, keeping user inputs completely private.</p>",
      content_text:
        "Edge computing allows developers to deploy local Vision-Language Models directly on user machines. Scenarios such as on-device OCR, meal photo parsing, and voice dictation transcription function in zero-latency offline sandboxes, keeping user inputs completely private.",
      summary_excerpt:
        "Deploying local vision LLMs for OCR, image parsing, and voice notes without remote API costs.",
      relevance_score: 90,
    },
  ];
}
