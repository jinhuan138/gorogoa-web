function coordsEqual(actual, encoded) {
  // AtomicPredicate.getRequiredCoords replaces an unset or invalid position with GridCoords(0, 0).
  const parsed = String(encoded ?? "")
    .split(",")
    .map(Number)
    .reverse();
  const required =
    parsed.length === 2 && parsed.every(Number.isFinite) ? parsed : [0, 0];
  return Boolean(
    actual && actual[0] === required[0] && actual[1] === required[1],
  );
}
// 原版 Formula.process 是右结合：a&b|c = a&(b|c)，!a&b = !(a&b)。
// 未实现的引用使用 null（未知），避免反向条件把未知当真。
const and = (a, b) =>
  a === false || b === false ? false : a === null || b === null ? null : true;
const or = (a, b) =>
  a === true || b === true ? true : a === null || b === null ? null : false;
const not = (a) => (a === null ? null : !a);
export function evaluateFormula(expression, values) {
  const read = (name) =>
    values instanceof Map
      ? values.has(name)
        ? values.get(name)
        : false
      : Object.hasOwn(values, name)
        ? values[name]
        : false;
  function parse(text) {
    text = String(text ?? "").trim();
    if (!text) return false;
    if (text[0] === "!") return not(parse(text.slice(1)));
    let end = 0,
      left;
    if (text[0] === "(") {
      let depth = 0;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        if (text[end] === ")" && --depth === 0) {
          end++;
          break;
        }
      }
      if (end > text.length || text[end - 1] !== ")")
        throw new Error("公式括号不匹配");
      left = parse(text.slice(1, end - 1));
    } else {
      while (end < text.length && !/[&|!()]/.test(text[end])) end++;
      if (!end) throw new Error("公式变量无效");
      left = read(text.slice(0, end).trim());
    }
    const rest = text.slice(end).trim();
    if (!rest) return left;
    if (rest[0] === "&") return and(left, parse(rest.slice(1)));
    if (rest[0] === "|") return or(left, parse(rest.slice(1)));
    throw new Error(`未知公式运算符 ${rest[0]}`);
  }
  return parse(expression);
}

export class RuntimeState {
  constructor(
    project,
    {
      animationComplete = () => null,
      onChange = () => {},
      scriptEvaluator = () => null,
    } = {},
  ) {
    this.project = project;
    this.states = new Map();
    this.locations = new Map();
    this.inPlay = new Set();
    this.coords = new Map();
    this.captors = new Map();
    this.hovered = new Set();
    this.targets = new Map();
    this.activeLinks = new Set();
    this.unknown = new Map();
    this.animationComplete = animationComplete;
    this.onChange = onChange;
    this.scriptEvaluator = scriptEvaluator;
    this.version = 0;
    this.containers = [
      ...project.all("SceneLayer"),
      ...project.all("SceneField"),
      ...project.all("SceneLayerField"),
    ].filter((n) => project.container(n, "states").length);
    this.stateOwners = new Map();
    for (const container of this.containers) {
      const states = project.container(container, "states");
      for (const state of states)
        this.stateOwners.set(state.attrs.guid, container);
      const initial = project.get(container.attrs.initialState) || states[0];
      if (initial) this.states.set(container.attrs.guid, initial.attrs.guid);
    }
    for (const card of project.all("Card"))
      if (card.attrs.startingLocation)
        this.locations.set(card.attrs.guid, card.attrs.startingLocation);
    this.initialStates = new Map(this.states);
    this.initialLocations = new Map(this.locations);
    const first = project.tree.attrs.staringCard;
    if (first) this.inPlay.add(first);
  }
  unknownValue(node, reason) {
    this.unknown.set(`${node?.attrs?.guid || node?.type}:${reason}`, {
      guid: node?.attrs?.guid,
      type: node?.type,
      reason,
    });
    return null;
  }
  cardOf(node) {
    return node?.type === "Card" ? node : this.project.owner(node, "Card");
  }
  isSatisfied(node, seen = new Set()) {
    if (!node) return true;
    if (seen.has(node)) return this.unknownValue(node, "条件引用循环");
    const chain = new Set(seen);
    chain.add(node);
    if (node.type === "CompoundPredicate")
      return this.evaluatePredicates(node, chain);
    if (node.type !== "AtomicPredicate")
      return this.unknownValue(node, "未实现的谓词类型");
    let result;
    const reference = node.attrs.subject;
    const resolved = this.project.get(reference);
    if (!resolved && reference && this.project.getAll(reference).length)
      return this.unknownValue(node, "谓词目标多义");
    // AtomicPredicate.getPredicateSubject resolves the reference, then falls back to its parent Card.
    const subject = resolved || this.project.owner(node, "Card");
    if (!subject) result = true;
    else {
      const card = this.cardOf(subject);
      if (!card) return this.unknownValue(node, "谓词目标无所属卡片");
      const guid = card.attrs.guid,
        required = node.attrs.requiredCoords,
        status = node.attrs.cardStatus || "NONE";
      if (node.attrs.mouseOverOnly === "true" && !this.hovered.has(guid))
        result = false;
      else {
        let allowed;
        if (status === "NONE") allowed = true;
        else if (status === "IN_PLAY") allowed = this.inPlay.has(guid);
        else if (status === "ON_GRID") allowed = this.coords.has(guid);
        else if (status === "AT_COORDS")
          allowed = coordsEqual(this.coords.get(guid), required);
        else if (status === "CAPTOR_AT_COORDS")
          allowed = coordsEqual(
            this.coords.get(this.captors.get(guid)),
            required,
          );
        else return this.unknownValue(node, `未知卡片状态 ${status}`);
        if (!allowed) result = false;
        else if (subject.type === "Card") result = true;
        else if (subject.type === "SceneLocation")
          result =
            !this.targets.has(guid) &&
            this.locations.get(guid) === subject.attrs.guid;
        else if (subject.type === "LocationTransition")
          result = this.targets.get(guid) === subject.attrs.guid;
        else if (this.stateOwners.has(subject.attrs.guid))
          result =
            this.states.get(
              this.stateOwners.get(subject.attrs.guid).attrs.guid,
            ) === subject.attrs.guid;
        else if (subject.type === "CardLink")
          result = this.activeLinks.has(subject.attrs.guid);
        else if (subject.type === "StateTransition")
          result = this.evaluatePredicates(subject, chain);
        else if (subject.type === "Script")
          result = this.scriptEvaluator(subject, node);
        else return this.unknownValue(node, `未知条件目标 ${subject.type}`);
      }
    }
    return node.attrs.negated === "true" ? not(result) : result;
  }
  evaluatePredicates(node, seen = new Set()) {
    const predicates = this.project.container(node, "predicates");
    if (!predicates.length) return true;
    const op = node.attrs.predicateOperator || "ALL",
      values = predicates.map((p) => this.isSatisfied(p, seen));
    if (op === "ALL") return values.reduce(and, true);
    if (op === "ANY") return values.reduce(or, false);
    if (op === "FORMULA") {
      try {
        return evaluateFormula(
          node.attrs.predicateFormula,
          new Map(predicates.map((p, i) => [p.attrs.id, values[i]])),
        );
      } catch (error) {
        return this.unknownValue(node, error.message);
      }
    }
    return this.unknownValue(node, `未知条件组合 ${op}`);
  }
  setState(container, state, { reenter = false } = {}) {
    const owner =
        typeof container === "string" ? this.project.get(container) : container,
      value = typeof state === "string" ? this.project.get(state) : state;
    if (!owner || !value || this.stateOwners.get(value.attrs.guid) !== owner)
      throw new Error("状态不属于该容器");
    if (this.states.get(owner.attrs.guid) === value.attrs.guid && !reenter)
      return false;
    this.states.set(owner.attrs.guid, value.attrs.guid);
    this.version++;
    this.onChange({ kind: "state", container: owner, state: value });
    return true;
  }
  setLocation(cardGUID, locationGUID) {
    const card = this.project.get(cardGUID),
      location = this.project.get(locationGUID);
    if (location?.type !== "SceneLocation" || this.cardOf(location) !== card)
      throw new Error("位置不属于该卡片");
    this.locations.set(cardGUID, locationGUID);
    this.targets.delete(cardGUID);
    this.version++;
    this.onChange({ kind: "location", card, location });
  }
  getTransitions(cardGUID) {
    const location = this.project.get(this.locations.get(cardGUID));
    return this.project
      .container(location, "transitions", "LocationTransition")
      .filter((t) => {
        const destination = this.project.get(t.attrs.destLocation);
        if (destination?.type !== "SceneLocation") return false;
        const pred = this.project.container(t, "predicate")[0];
        return this.isSatisfied(pred) === true;
      });
  }
  step({ maxPasses = 256 } = {}) {
    const visited = new Set(),
      changes = [];
    for (let pass = 0; pass < maxPasses; pass++) {
      const pending = [];
      for (const container of this.containers) {
        const card = this.cardOf(container),
          cardGUID = card?.attrs.guid;
        if (!cardGUID) continue;
        const state = this.project.get(this.states.get(container.attrs.guid));
        if (!state) continue;
        const complete =
          container.type === "SceneLayer"
            ? this.animationComplete(container)
            : true;
        const check = (transition, inverse) => {
          if (transition.attrs.onGridOnly === "true") {
            const coords = this.coords.get(cardGUID);
            // 原版 getUnderCard 读取格子实体栈，CardViewer 隐藏的捕获卡不在其中。
            if (
              !coords ||
              [...this.coords].some(
                ([other, at]) =>
                  other !== cardGUID &&
                  at[0] === coords[0] &&
                  at[1] === coords[1],
              )
            )
              return false;
          }
          const result = this.evaluatePredicates(transition);
          return result === null ? false : inverse ? !result : result;
        };
        for (const transition of this.project.container(
          state,
          "transitions",
          "StateTransition",
        )) {
          if (
            complete !== true &&
            transition.attrs.interruptAnimation !== "true"
          )
            continue;
          if (check(transition, false)) {
            if (visited.has(transition)) continue;
            const destination = this.project.get(
              transition.attrs.destinationState,
            );
            if (
              destination &&
              this.stateOwners.get(destination.attrs.guid) === container
            ) {
              pending.push([container, destination, transition]);
              visited.add(transition);
            } else this.unknownValue(transition, "状态转移目标缺失或越界");
            break;
          }
        }
        if (pending.some(([owner]) => owner === container)) continue;
        for (const earlier of this.project.container(container, "states")) {
          if (earlier === state) break;
          for (const transition of this.project.container(
            earlier,
            "transitions",
            "StateTransition",
          )) {
            if (
              transition.attrs.bidirectional !== "true" ||
              transition.attrs.destinationState !== state.attrs.guid
            )
              continue;
            if (
              complete !== true &&
              transition.attrs.interruptAnimation !== "true"
            )
              continue;
            if (check(transition, true) && !visited.has(transition)) {
              pending.push([container, earlier, transition]);
              visited.add(transition);
              break;
            }
          }
          if (pending.some(([owner]) => owner === container)) break;
        }
      }
      if (!pending.length) return changes;
      for (const [container, state, transition] of pending)
        if (this.setState(container, state, { reenter: true }))
          changes.push({
            container: container.attrs.guid,
            state: state.attrs.guid,
            transition: transition.attrs.guid,
          });
    }
    this.unknownValue(this.project.tree, "状态循环超过保护上限");
    return changes;
  }
  applyCheckpoint(save) {
    if (save?.type !== "GameSaveData") throw new Error("检查点存档类型无效");
    const { storyPhase, selectedCardGUID } = save.attrs;
    if (!["PROLOGUE", "CHAPTERS", "EPILOGUE", "ENDING"].includes(storyPhase))
      throw new Error("检查点故事阶段无效");
    if (selectedCardGUID && this.project.get(selectedCardGUID)?.type !== "Card")
      throw new Error("检查点所选卡片不存在");

    const locations = new Map(this.initialLocations),
      states = new Map(this.initialStates);
    const inPlay = new Set(),
      coords = new Map(),
      captors = new Map(),
      captureSides = new Map(),
      savedCards = new Set();
    for (const entry of this.project.container(save, "cards", "CardSaveData")) {
      const { cardGUID, locationGUID, isInPlay, gridCoords } = entry.attrs;
      const card = this.project.get(cardGUID);
      if (card?.type !== "Card" || savedCards.has(cardGUID))
        throw new Error("检查点卡片不存在或重复");
      savedCards.add(cardGUID);
      if (locationGUID) {
        const location = this.project.get(locationGUID);
        if (
          location?.type !== "SceneLocation" ||
          this.cardOf(location) !== card
        )
          throw new Error("检查点位置不属于该卡片");
        locations.set(cardGUID, locationGUID);
      }
      if (isInPlay === "true") inPlay.add(cardGUID);
      if (gridCoords) {
        const point = gridCoords.split(",").map(Number).reverse();
        if (
          point.length !== 2 ||
          point.some((v) => !Number.isInteger(v) || v < 0 || v > 1)
        )
          throw new Error("检查点棋盘坐标无效");
        coords.set(cardGUID, point);
      }
      for (const map of this.project.container(entry, "stateGUIDMap"))
        for (const pair of this.project.direct(map, "entry")) {
          const { key, value } = pair.attrs,
            owner = this.stateOwners.get(value);
          if (owner?.attrs.guid !== key || this.cardOf(owner) !== card)
            throw new Error("检查点状态不属于该卡片");
          states.set(key, value);
        }
      for (const [attribute, side] of [
        ["underCardGUIDs", "UNDER"],
        ["overCardGUIDs", "OVER"],
      ]) {
        for (const child of (entry.attrs[attribute] || "")
          .split("|")
          .filter(Boolean)) {
          if (this.project.get(child)?.type !== "Card" || captors.has(child))
            throw new Error("检查点捕获卡片不存在或重复");
          captors.set(child, cardGUID);
          captureSides.set(child, side);
        }
      }
    }
    for (const [child, captor] of captors) {
      if (inPlay.has(child) || coords.has(child))
        throw new Error("检查点捕获卡片不能同时在棋盘上");
      const seen = new Set([child]);
      for (let parent = captor; parent; parent = captors.get(parent)) {
        if (seen.has(parent)) throw new Error("检查点捕获关系形成循环");
        seen.add(parent);
      }
    }

    this.locations = locations;
    this.states = states;
    this.inPlay = inPlay;
    this.coords = coords;
    this.captors = captors;
    // LinkModel 可已持有此映射，载入时保留对象引用。
    this.captureSides ??= new Map();
    this.captureSides.clear();
    for (const [child, side] of captureSides)
      this.captureSides.set(child, side);
    this.hovered.clear();
    this.targets.clear();
    this.activeLinks.clear();
    this.storyPhase = storyPhase;
    this.selectedCardGUID = selectedCardGUID;
    this.version++;
    for (const [guid, location] of locations)
      this.onChange({
        kind: "location",
        card: this.project.get(guid),
        location: this.project.get(location),
      });
    for (const [guid, value] of states)
      this.onChange({
        kind: "state",
        container: this.project.get(guid),
        state: this.project.get(value),
      });
  }
}
