<script setup>
import { inject } from "vue";
import { cssImage } from "../resources/textures.js";
const { ui, actions, t } = inject("gameUi");
function style(hotspot) {
  const result = {
    left: `${hotspot.rect[0]}%`,
    top: `${hotspot.rect[1]}%`,
    width: `${hotspot.rect[2]}%`,
    height: `${hotspot.rect[3]}%`,
  };
  if (hotspot.image) {
    result["--hotspot-image"] = cssImage(ui.textures.get(hotspot.image));
    result["--hotspot-hover"] = cssImage(
      ui.textures.get(hotspot.image + "_over"),
    );
    result.transform = `rotate(${hotspot.angle}deg)`;
  }
  return result;
}
</script>

<template>
  <div id="hotspots" :aria-label="t('hotspots')">
    <button
      v-for="hotspot in ui.hotspots"
      :key="hotspot.id"
      type="button"
      class="hotspot"
      :class="{ back: hotspot.image }"
      :style="style(hotspot)"
      :aria-label="t(hotspot.label)"
      @click="actions.navigate(hotspot.card, hotspot.id)"
    ></button>
  </div>
</template>
