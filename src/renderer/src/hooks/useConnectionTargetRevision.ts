import { useEffect, useState } from "react";

/** Reset a screen when the current connection is edited without changing its id. */
export function useConnectionTargetRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      window.hermesAPI.onConnectionConfigChanged(() =>
        setRevision((current) => current + 1),
      ),
    [],
  );
  return revision;
}
