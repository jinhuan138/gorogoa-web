<script setup>
import { computed, provide } from "vue";
import GameMenu from "./GameMenu.vue";
import Hotspots from "./Hotspots.vue";
import { cssImage } from "../resources/textures.js";

const props = defineProps({ model: { type: Object, required: true } });
const { ui, settings, actions, t } = props.model;
const startupPercent = computed(() => {
  if (!ui.startupProgress.length) return 0;
  if (!ui.loading) return 100;
  // 按阶段等权合并已处理比例；首帧就绪前不显示 100%。
  const completed = ui.startupProgress.reduce((sum, stage) => {
    if (stage.total === null) return sum;
    return (
      sum +
      (stage.total === 0 ? 1 : (stage.completed + stage.failed) / stage.total)
    );
  }, 0);
  return Math.min(
    99,
    Math.floor((completed / ui.startupProgress.length) * 100),
  );
});
const startupLabel = computed(
  () =>
    ui.startupProgress.find(
      (stage) =>
        stage.total === null || stage.completed + stage.failed < stage.total,
    )?.key ?? "loading",
);
const startupFailed = computed(() =>
  ui.startupProgress.reduce((sum, stage) => sum + stage.failed, 0),
);
provide("gameUi", props.model);
</script>

<template>
  <button id="startup" type="button" :aria-label="t('startup')"></button>
  <section
    id="startup-progress"
    role="status"
    :hidden="!ui.startupActive || ui.loadFailed || !ui.startupProgress.length"
    :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
  >
    <div class="startup-progress-label">
      <span>{{ t(startupLabel) }}</span>
      <span>
        {{ startupPercent }}%
        <span v-if="startupFailed">
          · {{ t("loadingFailed") }} {{ startupFailed }}</span
        >
      </span>
    </div>
    <div
      class="startup-progress-track"
      role="progressbar"
      :aria-label="t('loading')"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="startupPercent"
    >
      <div
        class="startup-progress-fill"
        :style="{ width: `${startupPercent}%` }"
      ></div>
    </div>
  </section>
  <main id="game-shell" :inert="ui.startupActive">
    <h1 class="sr-only">{{ t("gameName") }}</h1>
    <div
      id="board"
      :inert="ui.paused"
      :aria-label="t('board')"
      :data-hints="settings.showHints ? 'on' : 'off'"
    >
      <canvas
        id="game"
        width="700"
        height="700"
        :aria-label="t('board')"
      ></canvas>
      <Hotspots />
      <div id="loading" role="status" :hidden="!ui.loading">
        {{ t(ui.loadFailed ? "loadError" : "loading") }}
      </div>
    </div>
    <p id="hint" class="sr-only">
      {{ t(ui.phase === "CHAPTERS" ? "boardTip" : "prologueTip") }}
    </p>
    <p id="notice" role="status" :hidden="!ui.notice">{{ ui.notice }}</p>
  </main>
  <button
    id="pause"
    type="button"
    :aria-label="t(ui.paused ? 'resume' : 'pause')"
    aria-controls="game-menu"
    :aria-expanded="ui.paused"
    :disabled="!ui.ready || ui.startupActive"
    :style="{
      backgroundImage: ui.ready
        ? cssImage(ui.textures.get('corner_flip_button'))
        : 'none',
    }"
    @click="actions.toggleMenu"
  ></button>
  <GameMenu />
  <canvas
    id="ending"
    :aria-label="`${t('gameName')} · ${t('ending')}`"
    hidden
  ></canvas>
  <section id="credits" :aria-label="t('credits')" hidden>
    <div id="credits-page" lang="en"></div>
    <button
      id="credits-prev"
      type="button"
      :aria-label="t('previous')"
      hidden
    ></button>
    <button id="credits-next" type="button" :aria-label="t('next')"></button>
  </section>
</template>
