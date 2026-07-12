/**
 * The ambient-people character pool: rigged GLBs that NPCs (bank customers,
 * building staff) are drawn from, each with the material names that form its
 * shirt so tinting recolours clothing only. man.glb names its torso material
 * "Shirt"; the Casual-family rigs use colour-named materials, so the shirt
 * material was identified per model from its torso mesh.
 */
import { useGLTF } from "@react-three/drei";
import manGlbUrl from "../assets/man.glb?url";
import personGlbUrl from "../assets/person.glb?url";
import person2GlbUrl from "../assets/person2.glb?url";
import womenGlbUrl from "../assets/women.glb?url";

export interface CharacterModel {
  url: string;
  /** Material names tinted by glb.ts#tintCharacterClone. */
  shirtMaterials: string[];
}

export const CHAR_MAN: CharacterModel = {
  url: manGlbUrl,
  shirtMaterials: ["Shirt"],
};
/** person.glb — "Casual2": LightBrown shirt, LightBlue jeans. */
export const CHAR_CASUAL2: CharacterModel = {
  url: personGlbUrl,
  shirtMaterials: ["LightBrown"],
};
/** person2.glb — "Casual": Purple shirt (also accents the sneakers). */
export const CHAR_CASUAL: CharacterModel = {
  url: person2GlbUrl,
  shirtMaterials: ["Purple"],
};
/** women.glb — female casual rig: White top, Orange trousers. */
export const CHAR_WOMAN: CharacterModel = {
  url: womenGlbUrl,
  shirtMaterials: ["White"],
};

export const CHARACTER_MODELS: CharacterModel[] = [
  CHAR_MAN,
  CHAR_CASUAL2,
  CHAR_CASUAL,
  CHAR_WOMAN,
];

/** Map a [0,1) random roll to a character model. */
export function pickCharacterModel(rand: number): CharacterModel {
  return CHARACTER_MODELS[
    Math.min(
      CHARACTER_MODELS.length - 1,
      Math.floor(rand * CHARACTER_MODELS.length),
    )
  ];
}

for (const model of CHARACTER_MODELS) useGLTF.preload(model.url);
