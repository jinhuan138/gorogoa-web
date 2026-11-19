<script setup>
import { inject } from "vue";
const { ui, actions, t } = inject("gameUi");
</script>

<template>
  <div id="settings-credits" class="menu-page">
    <h2>{{ t("credits") }}</h2>
    <div id="settings-credits-lines" lang="en">
      <p v-for="(text, index) in ui.creditsLines" :key="index">{{ text }}</p>
    </div>
    <button
      id="settings-credits-back"
      type="button"
      @click="actions.showSettings"
    >
      {{ t("back") }}
    </button>
  </div>
</template>
