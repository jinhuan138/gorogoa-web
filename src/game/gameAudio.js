import { AudioBank } from "../engine/audio/audio.js";
import { SoundtrackDirector } from "../engine/audio/soundtrack.js";
import { InterfaceSounds } from "../engine/audio/interface.js";

export function createGameAudio({
  ui,
  settings,
  preferences,
  read,
  baseUrl,
  pageNow,
  isBackgrounded,
  isDisposed,
  isBootReady,
  getState,
  getProject,
  getMove,
  actions,
}) {
  const soundBank = new AudioBank({ baseUrl });
  const interfaceBank = new AudioBank({ baseUrl });
  const interfaceSounds = new InterfaceSounds(interfaceBank);
  let soundDirector, audioFocus, lastCardsInPlay;
  let uiSoundGeneration = 0;

  for (const [channel, value] of [
    ["music", settings.volumeMusic],
    ["effects", settings.volumeEffects],
  ]) {
    soundBank.setChannelVolume(channel, value);
    interfaceBank.setChannelVolume(channel, value);
    interfaceSounds.initializeSlider(channel, value);
  }

  actions.setVolume = (channel, volume) => {
    soundBank.setChannelVolume(channel, volume);
    interfaceBank.setChannelVolume(channel, volume);
    if (!isBackgrounded() && !isDisposed())
      interfaceSounds.adjustVolume(channel, volume, pageNow() / 1000);
  };
  actions.playUiSound = async (name) => {
    if (settings.soundMuted || isDisposed() || isBackgrounded()) return;
    const generation = uiSoundGeneration;
    if (!soundDirector) {
      if (!(globalThis.AudioContext || globalThis.webkitAudioContext)) return;
      const snapshot = getState();
      await setSound(true);
      if (getState() !== snapshot) return;
    }
    if (isDisposed() || isBackgrounded() || generation !== uiSoundGeneration)
      return;
    return interfaceSounds.play(name);
  };
  actions.disposeInterfaceSounds = () =>
    interfaceSounds
      .dispose()
      .catch((error) => console.warn("界面音频关闭失败", error));
  actions.toggleSound = () =>
    setSound(!soundDirector || settings.soundMuted, true);

  function syncSoundtrack() {
    const state = getState();
    for (const guid of state.inPlay)
      if (!lastCardsInPlay.has(guid)) audioFocus = guid;
    lastCardsInPlay = new Set(state.inPlay);
    if (audioFocus && !state.inPlay.has(audioFocus)) audioFocus = undefined;
    const move = getMove();
    const moving = move?.card === audioFocus && move?.plan.durationSeconds > 0;
    soundDirector?.syncLocation(
      moving ? move.destination : state.locations.get(audioFocus),
      moving ? move.plan.durationSeconds : audioFocus ? 0.01 : 1,
    );
    soundDirector?.syncScore(state, move);
  }

  async function unlockBank(bank) {
    await bank.resume();
    if (isDisposed()) {
      if (bank.context.state !== "closed") await bank.context.close();
    } else if (isBackgrounded()) await bank.context.suspend();
  }

  async function syncAudioBank(bank, shouldPause, director) {
    if (!bank.context || bank.context.state === "closed" || isDisposed())
      return;
    let pause;
    do {
      pause = shouldPause();
      if (pause) {
        if (director) await director.suspend();
        else await bank.context.suspend();
      } else if (bank.context.state !== "running") {
        await bank.resume();
        if (isDisposed() && bank.context.state !== "closed")
          await bank.context.close();
      }
    } while (
      !isDisposed() &&
      bank.context.state !== "closed" &&
      pause !== shouldPause()
    );
  }

  async function updatePause() {
    await Promise.all([
      syncAudioBank(
        soundBank,
        () => isBackgrounded() || settings.soundMuted || ui.paused,
        soundDirector,
      ),
      syncAudioBank(
        interfaceBank,
        () => isBackgrounded() || settings.soundMuted,
      ),
    ]);
    if (
      soundDirector &&
      !isDisposed() &&
      !isBackgrounded() &&
      !settings.soundMuted &&
      !ui.paused
    )
      syncSoundtrack();
  }

  async function setSound(enabled, remember = false) {
    if (!isBootReady() || ui.soundBusy || interfaceSounds.disposed) return;
    ui.soundBusy = true;
    const previousMuted = settings.soundMuted;
    try {
      if (enabled) {
        // 两个上下文都在用户手势内发起解锁，必须早于任何网络请求。
        await Promise.all([unlockBank(soundBank), unlockBank(interfaceBank)]);
        if (interfaceSounds.disposed) return;
        if (!soundDirector) {
          const { events } = await read("assets/audio/events.json");
          if (interfaceSounds.disposed) return;
          soundDirector = new SoundtrackDirector(
            getProject(),
            events,
            soundBank,
          );
        }
      }
      settings.soundMuted = !enabled;
      interfaceSounds.setEnabled(enabled);
      await updatePause();
      if (interfaceSounds.disposed) return;
      if (remember) preferences.rememberSound();
      ui.soundLabel =
        soundDirector && !settings.soundMuted ? "soundOff" : "soundOn";
    } catch (error) {
      settings.soundMuted = previousMuted;
      interfaceSounds.setEnabled(!previousMuted && Boolean(soundDirector));
      ui.soundLabel = "retrySound";
      console.warn("声音暂未就绪", error);
    } finally {
      ui.soundBusy = false;
    }
  }

  return {
    soundBank,
    async resumeStartup() {
      await unlockBank(soundBank);
      await syncAudioBank(
        soundBank,
        () => isBackgrounded() || settings.soundMuted,
      );
    },
    enableStartupAudio(enableMusic) {
      if (isBackgrounded() || isDisposed()) return;
      if (
        !settings.soundMuted &&
        (globalThis.AudioContext || globalThis.webkitAudioContext)
      ) {
        unlockBank(interfaceBank).catch((error) =>
          console.warn("界面声音暂未解锁", error),
        );
        enableMusic();
      }
    },
    enableBoardAudio() {
      if (
        !isBackgrounded() &&
        !isDisposed() &&
        !settings.soundMuted &&
        !soundDirector &&
        (globalThis.AudioContext || globalThis.webkitAudioContext)
      )
        setSound(true);
    },
    enable: () => setSound(true),
    updatePause,
    enterBackground() {
      uiSoundGeneration++;
    },
    stopInterface() {
      interfaceSounds.stop();
    },
    stopForRestart() {
      soundDirector?.stop();
      interfaceSounds.stop();
    },
    resetFocus() {
      const { inPlay } = getState();
      lastCardsInPlay = new Set(inPlay);
      audioFocus = [...inPlay].at(-1);
    },
    focusCard(guid) {
      audioFocus = guid;
    },
    focusRevealedCard(drag) {
      lastCardsInPlay.add(drag.draggedGUID);
      audioFocus = drag.revealedGUID;
    },
    playInterface(name) {
      return soundDirector?.playInterface(name);
    },
    playHint(name, options) {
      return interfaceSounds.play(name, options);
    },
    playGraphic(guid) {
      return soundDirector?.playGraphic(
        getProject().get(guid),
        getState(),
        getMove(),
      );
    },
    syncSoundtrack,
    dispose() {
      soundDirector?.stop();
      soundBank.stopAll();
      actions.disposeInterfaceSounds();
      soundBank.context
        ?.close()
        .catch((error) => console.warn("游戏音频关闭失败", error));
    },
  };
}
