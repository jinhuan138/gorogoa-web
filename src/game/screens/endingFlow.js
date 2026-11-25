import { EndingScreen } from "./ending.js";
import { EndingCredits } from "./credits.js";

export function createEndingFlow(canvas, loadCredits) {
  let project,
    manifest,
    creditsPredicate,
    creditsScreen,
    creditsData,
    endingScreen;
  let endingStarted = null;
  let titleFadeStarted = null;
  let creditsRequested = false;

  function configure({
    project: loadedProject,
    manifest: loadedManifest,
    predicate,
    textureUrl,
  }) {
    project = loadedProject;
    manifest = loadedManifest;
    creditsPredicate = predicate;
    creditsScreen = new EndingCredits(
      ...["credits", "credits-page", "credits-prev", "credits-next"].map((id) =>
        document.getElementById(id),
      ),
      {
        previous: textureUrl("credits_back"),
        next: textureUrl("credits_forward"),
      },
    );
  }

  function reset(phase) {
    endingStarted = phase === "ENDING" ? -1.6 : null;
    titleFadeStarted = null;
    canvas.hidden = true;
    creditsScreen?.reset();
  }

  function update(time, state) {
    if (state.storyPhase !== "EPILOGUE" && state.storyPhase !== "ENDING")
      return;
    if (!creditsRequested) {
      creditsRequested = true;
      loadCredits()
        .then((data) => {
          creditsData = data;
        })
        .catch((error) => console.warn("片尾名单载入失败", error));
    }
    if (endingScreen === undefined) {
      endingScreen = null;
      try {
        const screen = new EndingScreen(
          canvas,
          manifest,
          project,
          document.baseURI,
        );
        if (screen.gl) {
          endingScreen = screen;
          screen.ready.catch((error) => {
            endingScreen = null;
            console.warn("结局画面载入失败", error);
          });
        }
      } catch (error) {
        console.warn("结局画面暂不可用", error);
      }
    }
    if (endingStarted === null) return;
    if (
      titleFadeStarted === null &&
      creditsPredicate &&
      state.isSatisfied(creditsPredicate) === true
    )
      titleFadeStarted = time;
    const fade =
      titleFadeStarted === null
        ? 1
        : Math.max(0, 1 - (time - titleFadeStarted) / 0.5);
    canvas.hidden = !endingScreen?.loaded;
    endingScreen?.draw(time - endingStarted, fade);
    if (titleFadeStarted !== null && creditsData && !creditsScreen.data)
      creditsScreen.start(creditsData, titleFadeStarted);
    creditsScreen.update(time);
  }

  return {
    configure,
    reset,
    start(time) {
      endingStarted = time;
    },
    update,
    dispose() {
      creditsScreen?.reset();
    },
  };
}
