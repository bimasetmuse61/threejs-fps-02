// The look plan, in one place. A dusk desert yard: warm sand and rust under a cold
// violet sky, one amber accent, and two team colours (teal Vanguard, ember Ember).
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191512', // dusk sky / fog
  surface: '#2e2620', // walls, dark metal
  hairline: '#4a3f33', // crates, trim
  sand: '#8a6b45', // ground
  sandLight: '#a8875c', // ground variation
  rust: '#7a4a2c', // silos, pipes
  ink: '#f2ead9', // text, light
  muted: '#a89a86', // secondary text
  accent: '#f0a830', // amber accent, muzzle flash, site markers
  teal: '#3fb8a6', // Vanguard (player team)
  ember: '#e05a2b', // Ember (enemy team)
  danger: '#d8442c', // damage, bomb light
};

export function hex(name) {
  return PALETTE[name];
}
