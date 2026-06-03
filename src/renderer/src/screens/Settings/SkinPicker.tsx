import { useEffect, useState } from "react";
import type { LoadedSkin } from "../../../../shared/skins";
import {
  loadAndApplyActiveSkin,
  applySkinVars,
  getActiveSkinId,
  setActiveSkinId,
} from "../../utils/skin";

/**
 * Skin selector (idea A6) for the Settings appearance section. Lists skins
 * found under <profileHome>/skins/ and applies the chosen one at the app root.
 * "Default" clears any skin overrides.
 */
export function SkinPicker({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const [skins, setSkins] = useState<LoadedSkin[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    loadAndApplyActiveSkin(profile).then((list) => {
      setSkins(list);
      setActive(getActiveSkinId(profile));
    });
  }, [profile]);

  const onSelect = (id: string): void => {
    if (id === "") {
      setActiveSkinId(profile, null);
      applySkinVars({});
      setActive(null);
      return;
    }
    const skin = skins.find((s) => s.id === id);
    if (!skin) return;
    setActiveSkinId(profile, id);
    applySkinVars(skin.cssVars);
    setActive(id);
  };

  return (
    <div className="settings-field">
      <label className="settings-field-label">Skin</label>
      <select
        className="settings-select"
        value={active ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">Default</option>
        {skins.map((s) => (
          <option key={s.id} value={s.id}>
            {s.skin.name}
          </option>
        ))}
      </select>
      <div className="settings-field-hint">
        Drop a .yaml or .json skin into the profile&apos;s skins/ folder to add
        your own.
      </div>
    </div>
  );
}
