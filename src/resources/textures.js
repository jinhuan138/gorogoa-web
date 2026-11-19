export const UI_STYLE_TEXTURES = [
  "scrollbox_back",
  "scrollbox_border_small",
  "scrollbox_scr_back",
  "button_border",
  "checkbox",
  "hotspots_reveal_check",
  "ping_image_on",
  "volume_slider_background",
  "volume_slider_handle",
  "volume_min_icon",
  "volume_max_icon",
  "music_min_icon",
  "music_max_icon",
  "cursor_default_instruct",
  "cursor_hand",
  "cursor_move",
  "hourglass",
];

export const UI_TEXTURES = [
  "PaperTex1_tile",
  "hs_button",
  "hs_button_over",
  "hs_back_button",
  "hs_back_button_over",
  "win_screen_tex_tile",
  "final_transition_rim",
  "win_screen_foreground",
  "win_screen_title",
  "credits_back",
  "credits_forward",
  "corner_flip_button",
  "new_game_select",
  ...UI_STYLE_TEXTURES,
  "credits_select",
  ...[1, 2, 3, 4, 5].map((chapter) => `chapter${chapter}_end_select`),
  ...[1, 2, 3, 4, 5].flatMap((chapter) =>
    ["l", "r", "t", "b"].map((side) => `chapter${chapter}_margin_${side}`),
  ),
];

export const cssImage = (url) => `url("${url}")`;

export function createTextureUrls(manifest, baseUrl) {
  const urls = new Map();
  for (const texture of manifest.textures) {
    if (!urls.has(texture.name)) {
      urls.set(texture.name, new URL(texture.url, baseUrl).href);
    }
  }
  return urls;
}
