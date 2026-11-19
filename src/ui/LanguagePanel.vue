<script setup>
import { inject } from "vue";
const { settings, actions, t, languages } = inject("gameUi");
</script>

<template>
  <div id="language-panel" class="menu-page">
    <h2>{{ t("language") }}</h2>
    <div id="language-list">
      <button
        v-for="(label, code) in languages"
        :key="code"
        type="button"
        :lang="code"
        :aria-pressed="code === settings.language"
        @click="actions.chooseLanguage(code)"
      >
        {{ label }}
      </button>
    </div>
    <button id="language-back" type="button" @click="actions.showSettings">
      {{ t("back") }}
    </button>
  </div>
</template>
