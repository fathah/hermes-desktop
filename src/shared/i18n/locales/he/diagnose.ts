export default {
  title: "תקינות התצורה",
  description:
    "ביקורת על תצורת שולחן העבודה (משתני סביבה, config.yaml, מודלים). מציפה אי-התאמות שגורמות לעיתים קרובות לכשל בצ'אט, עם תיקונים בלחיצה אחת היכן שבטוח להחיל אותם אוטומטית.",
  rerun: "הרצת ביקורת מחדש",
  allGood: "לא זוהו בעיות. התצורה שלכם נראית עקבית.",
  banner: {
    lead: "זוהו בעיות בתצורה:",
    errors: "{{count}} שגיאות",
    warnings: "{{count}} אזהרות",
    infos: "{{count}} הערות",
    showDetails: "הצג פרטים",
  },
  apiKeyBanner: {
    lead: "מפתח שרת ה-API לא הוגדר — הצ'אט ייכשל.",
    setNow: "הגדירו עכשיו",
  },
  apiKeyModal: {
    title: "הגדרת מפתח שרת API",
    description:
      "‏API_SERVER_KEY נדרש כדי ששער ה-Hermes יוכל לאמת בקשות. הגדירו אותו עכשיו כדי לאפשר צ'אט.",
    label: "מפתח שרת API",
    placeholder: "‏sk-… או כל סוד אחר",
    autoGenerate: "יצירה אוטומטית",
    hint: "תוכלו להדביק מפתח משלכם או ליצור UUID אקראי.",
  },
  fix: {
    apply: "החל תיקון",
    running: "מחיל…",
    success: "התיקון הוחל.",
    failure: "התיקון נכשל.",
  },
};
