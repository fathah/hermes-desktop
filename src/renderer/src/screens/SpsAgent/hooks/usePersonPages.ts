// usePersonPages.ts — the data source for the assignee who-picker. Person
// records are folder-backed rows (vault/people/<id>.md, schema:"person"), so we
// query them through the note-index exactly like tasks. "Me" (SELF_PERSON_ID)
// is always present even before any contact exists, so a task always has a
// valid default assignee.
import { useMemo } from "react";
import { useVaultQuery, type VaultFilter } from "./useNoteIndex";
import { pageIdFromPath } from "../lib/pageId";
import { PEOPLE } from "../data/seed";
import {
  PERSON_FOLDER,
  SELF_PERSON_ID,
  personRefFrom,
  type PersonRef,
} from "../../../../../shared/contacts";

const PERSON_FILTER: VaultFilter[] = [
  { prop: "schema", op: "eq", value: "person" },
];
const PERSON_SORT = { prop: "title", dir: "asc" as const };

function selfRef(): PersonRef {
  const seeded = PEOPLE[SELF_PERSON_ID];
  return { id: SELF_PERSON_ID, name: seeded?.name ?? "You", isSelf: true };
}

export function usePersonPages(): {
  persons: PersonRef[];
  refetch: () => void;
} {
  const { rows, refetch } = useVaultQuery(
    PERSON_FOLDER,
    PERSON_FILTER,
    PERSON_SORT,
  );
  const persons = useMemo(() => {
    const list = rows.map((row) =>
      personRefFrom(pageIdFromPath(row.path), row.title, row.props),
    );
    const hasSelf = list.some((p) => p.id === SELF_PERSON_ID);
    if (!hasSelf) return [selfRef(), ...list];
    return list.map((p) =>
      p.id === SELF_PERSON_ID ? { ...p, isSelf: true } : p,
    );
  }, [rows]);
  return { persons, refetch };
}
