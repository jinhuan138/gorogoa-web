<script setup>
import { inject } from "vue";
const { ui, settings, actions, t } = inject("gameUi");
const channels = [
  { name: "effects", field: "volumeEffects" },
  { name: "music", field: "volumeMusic" },
];
function setVolume(channel, event) {
  const value = Number(event.target.value);
  settings[channel.field] = value;
  actions.setVolume(channel.name, value);
}
async function toggleFullscreen(event) {
  await actions.toggleFullscreen();
  event.target.checked = ui.fullscreen;
}
</script>

<template>
  <div id="menu-controls" class="menu-page">
    <div class="settings-audio">
      <label class="settings-check">
        <input id="show-hints" v-model="settings.showHints" type="checkbox" />
        <span class="hint-sample" aria-hidden="true"></span>
        <span class="sr-only">{{ t("hints") }}</span>
      </label>
      <label
        v-for="channel in channels"
        :key="channel.name"
        class="volume-control"
        :class="channel.name"
      >
        <span class="sr-only">{{ t(channel.name) }}</span>
        <input
          :id="`volume-${channel.name}`"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="settings[channel.field]"
          @input="setVolume(channel, $event)"
        />
      </label>
      <button
        id="sound"
        class="settings-link"
        type="button"
        :disabled="!ui.ready || ui.soundBusy"
        :aria-label="t(ui.soundBusy ? 'loading' : ui.soundLabel)"
        @click="actions.toggleSound"
      >
        {{ t(ui.soundBusy ? "loading" : ui.soundLabel) }}
      </button>
    </div>
    <div class="settings-display">
      <button
        id="language-open"
        class="paper-button"
        type="button"
        @click="actions.openLanguages"
      >
        {{ t("language") }}
      </button>
      <label
        class="settings-check"
        :class="{ unavailable: !ui.fullscreenSupported }"
      >
        <span>{{ t("fullscreen") }}</span>
        <input
          id="game-fullscreen"
          type="checkbox"
          :checked="ui.fullscreen"
          :disabled="!ui.fullscreenSupported"
          :aria-describedby="
            ui.fullscreenSupported ? undefined : 'fullscreen-unavailable'
          "
          @change="toggleFullscreen"
        />
      </label>
      <span
        v-if="!ui.fullscreenSupported"
        id="fullscreen-unavailable"
        class="settings-explanation"
        >{{ t("fullscreenError") }}</span
      >
      <button
        id="exit-game"
        class="paper-button"
        type="button"
        @click="actions.exitToTitle"
      >
        {{ t("exit") }}
      </button>
    </div>
  </div>
</template>
