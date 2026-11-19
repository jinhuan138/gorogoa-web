import { CARD_SIZE, multiply2 } from "../render/camera.js";
import {
  AnimationSampler,
  clamp01,
  interpFraction,
  rangeFraction,
} from "../animation.js";

const TWO_PI = 2 * Math.PI;
const DIRECTIONS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];
const f = Math.fround;
function modulus(value, period) {
  const remainder = value % period;
  return remainder < 0 ? remainder + period : remainder;
}

function directionOf(angle) {
  // 原版从北开始顺时针划分，落在两个扇区的边界时取前一个。
  const octant = Math.ceil((angle / (Math.PI / 8) - 1) / 2);
  return DIRECTIONS[modulus(octant, DIRECTIONS.length)];
}

function scriptVariables(project, definition) {
  const table = project.container(definition, "varTable", "StringMap")[0];
  return new Map(
    project
      .direct(table, "entry")
      .map((entry) => [entry.attrs.key, project.get(entry.attrs.value)]),
  );
}

class NeedleScript {
  constructor(project, definition) {
    this.project = project;
    this.cardGUID = project.owner(definition, "Card").attrs.guid;
    const variables = scriptVariables(project, definition);
    this.enablingState = variables.get("enablingState");
    this.trackLocation = variables.get("trackLocation");
    this.needle = variables.get("needleGraphic");
    this.shadow = variables.get("shadowGraphic");
    this.directionField = variables.get("compassDirContainer");
    this.directionStates = new Map(
      project
        .container(this.directionField, "states")
        .filter((node) => DIRECTIONS.includes(node.attrs.id))
        .map((node) => [node.attrs.id, node]),
    );
    this.trackCardGUID = project.owner(this.trackLocation, "Card")?.attrs.guid;
    this.ready = [
      "needleGraphic",
      "shadowGraphic",
      "trackLocation",
      "enablingState",
      "compassDirContainer",
      "overLink",
    ].every((key) => variables.has(key) && variables.get(key));
    this.angle = 0;
    this.destination = 0;
    this.velocity = 0;
    this.lastUpdate = null;
    this.direction = "north";
    this.duration = 0;
  }

  destinationAngle(state, displayCoords, locked) {
    if (locked) return this.angle;
    const enablingOwner = state.stateOwners.get(this.enablingState.attrs.guid);
    const enabled =
      state.states.get(enablingOwner?.attrs.guid) ===
      this.enablingState.attrs.guid;
    const trackCard = this.trackCardGUID;
    if (
      !enabled ||
      !state.inPlay.has(trackCard) ||
      state.targets.has(trackCard) ||
      state.locations.get(trackCard) !== this.trackLocation.attrs.guid
    )
      return this.destination;
    const own = displayCoords(this.cardGUID);
    const target = displayCoords(trackCard);
    if (!own || !target) return this.destination;
    const dx = Math.fround(target[0] - own[0]);
    const dy = Math.fround(own[1] - target[1]);
    if (dx === 0 && dy === 0) return 0;
    return modulus(Math.fround(Math.atan2(dx, dy)), TWO_PI);
  }

  update(state, timeMillis, displayCoords) {
    if (!this.ready) return false;
    const previous = this.angle;
    if (this.lastUpdate === null) {
      const savedDirection = this.project.get(
        state.states.get(this.directionField.attrs.guid),
      )?.attrs.id;
      const octant = DIRECTIONS.indexOf(savedDirection);
      if (octant >= 0) this.angle = this.destination = (octant * Math.PI) / 4;
      this.lastUpdate = timeMillis;
    }
    const locked = !state.inPlay.has(this.cardGUID);
    this.destination = this.destinationAngle(state, displayCoords, locked);
    const difference = this.destination - this.angle;
    if (Math.abs(difference) <= 0.03 && Math.abs(this.velocity) <= 0.0003) {
      this.angle = this.destination;
      this.velocity = 0;
    } else if (timeMillis > 0) {
      // 原版每个时钟回调更新速度，随后用实际毫秒差积分角度。
      const direction =
        Math.sign(difference) * (Math.abs(difference) > Math.PI ? -1 : 1);
      const force = direction * 0.0003 - Math.sign(this.velocity) * 0.0002;
      this.velocity = locked ? 0 : this.velocity + force / 0.9;
      this.angle = modulus(
        this.angle + this.velocity * (timeMillis - this.lastUpdate),
        TWO_PI,
      );
    }
    this.lastUpdate = timeMillis;
    this.direction = directionOf(this.angle);
    // The compass field is the script's output. In the exported list its switch
    // follows all eight direction states, so the ordinary reverse scan cannot reach it.
    const directionState = this.directionStates.get(this.direction);
    if (
      directionState &&
      state.states.get(this.directionField.attrs.guid) !==
        directionState.attrs.guid
    ) {
      state.setState(this.directionField, directionState);
    }
    return previous !== this.angle;
  }

  evaluate(predicate) {
    const transition = this.project.owner(predicate, "StateTransition");
    const destination = this.project.get(transition?.attrs.destinationState);
    return destination?.attrs.id === this.direction;
  }

  graphics(matrix) {
    const [a, b, c, d, tx, ty] = matrix;
    const half = CARD_SIZE / 2;
    const pivotX = (a + c) * half;
    const pivotY = (b + d) * half;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const rotated = multiply2(
      [cos, sin, -sin, cos, 0, 0],
      [a, b, c, d, -pivotX, -pivotY],
    );
    rotated[4] += tx + pivotX;
    rotated[5] += ty + pivotY;
    const shadow = [...rotated];
    shadow[5] += CARD_SIZE * Math.fround(0.01);
    return [
      { node: this.shadow, matrix: shadow },
      { node: this.needle, matrix: rotated },
    ];
  }
}

const EMBER_COLORS = [
  [99, 45, 41],
  [101, 47, 43],
  [102, 47, 44],
  [102, 48, 44],
];
const FLAME_COLORS = {
  SDFlameScript: [
    0, 1, 1, 2, 3, 0, 0, 2, 1, 1, 3, 2, 3, 2, 1, 1, 1, 3, 2, 0,
  ].map((i) => EMBER_COLORS[i]),
  FlameScript: [210, 240, 240, 250, 255, 210, 210, 250].map((g) => [255, g, 0]),
  FruitFlamesScript: [144, 150, 150, 152, 153, 144, 144, 152, 150, 150].map(
    (value) => [value, value, value],
  ),
};
const SECTION_COUNT = 40;
const ENERGY_START = f(0.2);
const ENERGY_END = f(0.8);
const SHAPE_PEAK = f(0.3);

function energy(fraction) {
  if (fraction < ENERGY_START)
    return f(interpFraction("SINE", rangeFraction(fraction, 0, ENERGY_START)));
  if (fraction > ENERGY_END)
    return f(
      interpFraction("SINE", 1 - rangeFraction(fraction, ENERGY_END, 1)),
    );
  return 1;
}

class FlamePath {
  constructor(sampler, keyframes) {
    this.sections = Array.from({ length: SECTION_COUNT }, (_, index) => {
      const fraction = f(index / (SECTION_COUNT - 1));
      const [x, y] = sampler.sample(keyframes, "positionByKeyframe", fraction);
      const [, , rotation] = sampler.sample(
        keyframes,
        "rotationByKeyframe",
        fraction,
      );
      return [f(x), f(y), f(Math.cos(rotation)), f(Math.sin(rotation))];
    });
    const frames = sampler.channel(keyframes, "positionByKeyframe");
    const pathLength = frames.slice(1).reduce((sum, frame, index) => {
      const previous = frames[index];
      return (
        sum +
        f(
          Math.hypot(
            ...frame.value.map((value, i) => f(value - previous.value[i])),
          ),
        )
      );
    }, 0);
    this.lifetime = f(pathLength / f(2.2));
  }

  createParticles(random) {
    const particles = [];
    for (let i = 0; i <= 100; i++) {
      const start = f(f(i / 100) * f(1 - this.lifetime));
      const pathFraction = energy(start);
      if (f(random()) >= f(pathFraction * f(0.3))) continue;
      const maxSize = f(pathFraction * f(0.07));
      const offset =
        f(f(random()) * f(maxSize / 2.5)) * (random() < 0.5 ? 1 : -1);
      particles.push({
        start,
        end: f(start + this.lifetime),
        pathFraction,
        maxSize,
        offset,
      });
    }
    return particles;
  }

  polygons(particles, fraction) {
    const width = new Float32Array(SECTION_COUNT);
    const offset = new Float32Array(SECTION_COUNT);
    const maxPosition = energy(fraction);
    const step = f(1 / (SECTION_COUNT - 1));
    for (const particle of particles) {
      const age = f(rangeFraction(fraction, particle.start, particle.end));
      const position = f(f(age * particle.pathFraction) + f(f(0.1) * age));
      const progress = f(position / particle.pathFraction);
      if (!(progress >= 0) || fraction >= 1 || position > maxPosition) continue;
      const shapeProgress =
        progress < SHAPE_PEAK
          ? rangeFraction(progress, 0, SHAPE_PEAK)
          : 1 - rangeFraction(progress, SHAPE_PEAK, 1);
      const size = Math.max(
        0,
        f(interpFraction("SINE", shapeProgress) * particle.maxSize),
      );
      const radius = f(size * 2);
      if (radius <= 0) continue;
      const first = Math.floor(f(clamp01(position - radius) / step));
      const last = Math.min(
        SECTION_COUNT - 1,
        Math.max(first, Math.ceil(f(clamp01(position + radius) / step))),
      );
      for (let i = first; i <= last; i++) {
        const delta = f(Math.abs(f(i / (SECTION_COUNT - 1)) - position));
        const weight = Math.max(0, f(1 - f(delta / radius)));
        width[i] += f(weight * size);
        offset[i] += f(weight * particle.offset);
      }
    }

    const polygons = [];
    for (let i = 0; i < SECTION_COUNT - 1; i++) {
      if (width[i] <= 0) continue;
      const first = i;
      while (i + 1 < SECTION_COUNT - 1 && width[i + 1] > 0) i++;
      if (i - first < 2) continue;
      const left = [],
        right = [];
      for (let j = first; j <= i; j++) {
        const [x, y, cos, sin] = this.sections[j];
        const end = j === first || j === i;
        const halfWidth = end ? 0 : f(width[j] * 0.5);
        const leftOffset = f(offset[j] - halfWidth),
          rightOffset = f(offset[j] + halfWidth);
        left.push([
          f(f(x + f(cos * leftOffset)) * CARD_SIZE),
          f(f(y + f(sin * leftOffset)) * CARD_SIZE),
        ]);
        if (!end)
          right.push([
            f(f(x + f(cos * rightOffset)) * CARD_SIZE),
            f(f(y + f(sin * rightOffset)) * CARD_SIZE),
          ]);
      }
      polygons.push(left.concat(right.reverse()));
    }
    return polygons;
  }
}

class FireScript {
  constructor(project, definition, random) {
    const variables = scriptVariables(project, definition);
    const colors = FLAME_COLORS[definition.attrs.id];
    const path = variables.get("flamePathGraphic");
    const keyframes = project.container(
      path,
      "motionKeyframes",
      "MotionKeyframes",
    );
    this.duration = 7500;
    this.ready =
      path?.type === "MotionKeyframesGraphic" &&
      variables.get("colorGraphic")?.type === "LayeredImageGraphic" &&
      keyframes.length > 0 &&
      colors?.length >= keyframes.length * 2;
    if (!this.ready) return;
    const sampler = new AnimationSampler(project);
    this.paths = keyframes.map((frame, index) => {
      const path = new FlamePath(sampler, frame);
      return {
        path,
        primary: path.createParticles(random),
        alternate: path.createParticles(random),
        colors: colors.slice(index * 2, index * 2 + 2),
      };
    });
  }

  graphics(matrix, { fraction = 0 } = {}) {
    const progress = f(clamp01(fraction));
    const bands = [
      [0, f(0.4), false, progress < f(0.4)],
      [f(0.2), f(0.6), true, progress > f(0.2) && progress < f(0.6)],
      [f(0.4), f(0.8), false, progress >= f(0.4) && progress < f(0.8)],
      [f(0.6), 1, true, progress >= f(0.6)],
    ];
    const shapes = [];
    for (const [from, to, alternate, active] of bands) {
      if (!active) continue;
      const phase = f(rangeFraction(progress, from, to));
      for (const { path, primary, alternate: secondary, colors } of this
        .paths) {
        const polygons = path.polygons(alternate ? secondary : primary, phase);
        for (const polygon of polygons)
          shapes.push({ polygon, matrix, color: colors[Number(alternate)] });
      }
    }
    return shapes;
  }
}

export class ProjectScripts {
  constructor(project, { random = Math.random } = {}) {
    this.instances = new Map();
    for (const definition of project.all("Script")) {
      const className = definition.attrs.className?.split(".").at(-1);
      let script;
      if (className === "NeedleScript")
        script = new NeedleScript(project, definition);
      if (className === "FireScript")
        script = new FireScript(project, definition, random);
      // 该发布版本的 TwinkleScript 没有覆盖基类的空图形实现。
      if (className === "TwinkleScript")
        script = { ready: true, duration: 1000, graphics: () => [] };
      if (script?.ready) this.instances.set(definition.attrs.guid, script);
    }
  }

  update(
    state,
    timeSeconds,
    { displayCoords = (guid) => state.coords.get(guid) } = {},
  ) {
    let changed = false;
    const timeMillis = Math.max(0, Math.trunc(timeSeconds * 1000));
    for (const script of this.instances.values())
      changed = script.update?.(state, timeMillis, displayCoords) || changed;
    return changed;
  }

  evaluate(definition, predicate) {
    return (
      this.instances.get(definition.attrs.guid)?.evaluate?.(predicate) ?? null
    );
  }

  durationMillis(graphic) {
    return this.instances.get(graphic.attrs.script)?.duration ?? null;
  }

  graphics(graphic, matrix, options) {
    return (
      this.instances.get(graphic.attrs.script)?.graphics(matrix, options) ??
      null
    );
  }
}
