<script setup>
import { computed, inject } from "vue";
const { ui, settings, actions, t } = inject("gameUi");
const chapters = computed(() =>
  Array.from({ length: settings.maxChapter }, (_, index) => {
    const chapter = index + 1;
    return {
      chapter: chapter === 1 ? 0 : chapter,
      label:
        chapter === 1
          ? t("restart")
          : chapter === 6
            ? t("ending")
            : t("chapter", chapter),
      image:
        chapter === 1 ? "new_game_select" : `chapter${chapter - 1}_end_select`,
    };
  }),
);
</script>

<template>
  <div id="chapter-panel" class="menu-page">
    <h2>{{ t("chapters") }}</h2>
    <div id="chapter-list">
      <button
        v-for="chapter in chapters"
        :key="chapter.chapter"
        type="button"
        :aria-label="chapter.label"
        @click="actions.requestChapter(chapter.chapter)"
      >
        <img
          v-if="ui.ready"
          :src="ui.textures.get(chapter.image)"
          alt=""
          draggable="false"
        />
      </button>
      <button
        type="button"
        :aria-label="t('credits')"
        @click="actions.openCredits"
      >
        <img
          v-if="ui.ready"
          :src="ui.textures.get('credits_select')"
          alt=""
          draggable="false"
        />
      </button>
    </div>
  </div>
</template>
