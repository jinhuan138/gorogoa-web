import { createApp } from "vue";
import App from "./ui/App.vue";
import { createGameUi } from "./ui/useGame.js";
import { startGame } from "./game/runtime.js";
import "./styles/game.scss";

const model = createGameUi();
createApp(App, { model }).mount("#app");
await startGame(model);
