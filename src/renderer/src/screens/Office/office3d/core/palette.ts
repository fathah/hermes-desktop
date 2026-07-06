// The world's day/night look (floor, walls, lighting) is driven by the system
// clock, NOT the app's UI theme — so future 3D worlds can reuse this same
// time-of-day model. Only the canvas background follows the app theme.
export interface WorldPalette {
  floor: string;
  rug: string;
  wallNS: string;
  wallEW: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  directional: number;
  // Image-based-lighting (Lightformer environment) strength + warmth. With
  // ACES tone mapping the punchier directional + soft IBL replace the old flat
  // fill, so ambient/hemi are dialled down to avoid washing the scene out.
  envIntensity: number;
  keyColor: string;
}

export const DAY_PALETTE: WorldPalette = {
  floor: "#e7e2d8",
  rug: "#cdd7e5",
  wallNS: "#c9c2b4",
  wallEW: "#d2ccbf",
  hemiSky: "#ffffff",
  hemiGround: "#b9b4a8",
  hemiIntensity: 0.45,
  ambient: 0.22,
  directional: 2.0,
  envIntensity: 0.75,
  keyColor: "#fff4e2",
};
