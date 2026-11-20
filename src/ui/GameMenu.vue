<script setup>
import { inject } from "vue";
import SettingsPanel from "./SettingsPanel.vue";
import ChapterPanel from "./ChapterPanel.vue";
import LanguagePanel from "./LanguagePanel.vue";
import CreditsPanel from "./CreditsPanel.vue";

const { ui, settings, actions, t } = inject("gameUi");
</script>

<template>
  <Transition name="menu-fade">
    <section
      v-show="ui.paused"
      id="game-menu"
      role="dialog"
      aria-modal="true"
      :aria-label="t('menu')"
      :aria-hidden="!ui.paused"
      :data-page="ui.page"
      :inert="!ui.paused"
      :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
    >
      <div class="menu-pages">
        <Transition name="page-fade">
          <div
            v-show="ui.page === 'settings'"
            :inert="ui.page !== 'settings'"
            class="menu-pages"
          >
            <SettingsPanel />
            <ChapterPanel />
          </div>
        </Transition>
        <Transition name="page-fade"
          ><LanguagePanel
            v-show="ui.page === 'language'"
            :inert="ui.page !== 'language'"
        /></Transition>
        <Transition name="page-fade"
          ><CreditsPanel
            v-show="ui.page === 'credits'"
            :inert="ui.page !== 'credits'"
        /></Transition>
        <p id="settings-status" role="status" :hidden="!ui.settingsStatus">
          {{ ui.settingsStatus }}
        </p>
        <Transition name="page-fade">
          <div
            id="title-panel"
            class="menu-page"
            v-show="ui.page === 'title'"
            :inert="ui.page !== 'title'"
          >
            <h2>{{ t("gameName") }}</h2>
            <button id="title-resume" type="button" @click="actions.toggleMenu">
              {{ t("resume") }}
            </button>
          </div>
        </Transition>
        <Transition name="page-fade">
          <div
            id="menu-confirm"
            class="menu-page"
            v-show="ui.page === 'confirm'"
            :inert="ui.page !== 'confirm'"
          >
            <h2 id="menu-action">
              {{
                t(ui.pendingChapter === 0 ? "restartQuestion" : "loadQuestion")
              }}
            </h2>
            <p>{{ t("replaceProgress") }}</p>
            <div class="menu-actions">
              <button
                id="menu-ok"
                type="button"
                :disabled="ui.chapterBusy"
                @click="actions.confirmChapter"
              >
                {{ t("ok") }}
              </button>
              <button
                id="menu-cancel"
                type="button"
                :disabled="ui.chapterBusy"
                @click="actions.showSettings"
              >
                {{ t("cancel") }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </section>
  </Transition>
</template>
