import { parseDocument, isScalar, isCollection, Scalar } from "yaml";

/**
 * Get a value from a YAML string at the specified dotted path.
 * Returns the string representation of the scalar, or empty collection syntax ("{}" / "[]"), or null if missing.
 */
export function getYamlValue(content: string, dottedPath: string): string | null {
  const path = dottedPath.split(".").filter(Boolean);
  if (path.length === 0) return null;

  try {
    const doc = parseDocument(content);
    // getIn returns Node or undefined
    const node = doc.getIn(path);
    if (node === undefined || node === null) return null;

    if (isScalar(node)) {
      if (node.value === null || node.value === undefined) {
        return "";
      }
      return String(node.value);
    }

    if (isCollection(node)) {
      const json = node.toJSON();
      if (Array.isArray(json) && json.length === 0) return "[]";
      if (json && typeof json === "object" && Object.keys(json).length === 0) return "{}";
      return JSON.stringify(json);
    }

    return String(node);
  } catch (err) {
    console.error(`[yaml-utils] Error getting path ${dottedPath}:`, err);
    return null;
  }
}

/**
 * Set a value in a YAML string at the specified dotted path.
 * If the parent of a multi-segment path does not exist, and options.upsert is false, this is a no-op (returns original content).
 * Forces double quotes on string values, and preserves numbers/booleans.
 */
export function setYamlValue(
  content: string,
  dottedPath: string,
  value: string,
  options?: { upsert?: boolean }
): string {
  const path = dottedPath.split(".").filter(Boolean);
  if (path.length === 0) return content;

  try {
    const doc = parseDocument(content);
    
    const upsert = options?.upsert ?? true;

    // Strict dotted path checking for missing parent blocks (no-op guard)
    if (!upsert && path.length > 1) {
      const parentPath = path.slice(0, -1);
      const parent = doc.getIn(parentPath);
      if (parent === undefined || parent === null || isScalar(parent)) {
        return content;
      }
    }

    let typedValue: string | boolean | number | Scalar = value;
    const existing = doc.getIn(path);
    if (isScalar(existing)) {
      if (typeof existing.value === "boolean") {
        if (value === "true") typedValue = true;
        if (value === "false") typedValue = false;
      } else if (typeof existing.value === "number") {
        const num = Number(value);
        if (!isNaN(num)) typedValue = num;
      } else {
        const scalar = new Scalar(value);
        scalar.type = "QUOTE_DOUBLE";
        typedValue = scalar;
      }
    } else {
      // Node is new or a collection
      if (value === "true") {
        typedValue = true;
      } else if (value === "false") {
        typedValue = false;
      } else {
        const scalar = new Scalar(value);
        scalar.type = "QUOTE_DOUBLE";
        typedValue = scalar;
      }
    }

    doc.setIn(path, typedValue);
    return doc.toString();
  } catch (err) {
    console.error(`[yaml-utils] Error setting path ${dottedPath}:`, err);
    return content;
  }
}

/**
 * Delete a value from a YAML string at the specified dotted path.
 * Preserves existing formatting, comments, and structure.
 */
export function deleteYamlValue(content: string, dottedPath: string): string {
  const path = dottedPath.split(".").filter(Boolean);
  if (path.length === 0) return content;

  try {
    const doc = parseDocument(content);
    doc.deleteIn(path);
    return doc.toString();
  } catch (err) {
    console.error(`[yaml-utils] Error deleting path ${dottedPath}:`, err);
    return content;
  }
}

