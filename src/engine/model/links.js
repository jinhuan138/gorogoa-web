import { evaluateFormula } from "./state.js";
export const DIRECTIONS = Object.freeze({
  NORTH: 0,
  SOUTH: 1,
  EAST: 2,
  WEST: 3,
  OVER: 4,
  UNDER: 5,
  NONE: 6,
});
const refs = (value) =>
  String(value || "")
    .split(/[|,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const same = (a, b) =>
  Boolean(
    a &&
      b &&
      a.length === 2 &&
      b.length === 2 &&
      a.every((v, i) => Number.isFinite(v) && v === b[i]),
  );
const negate = (value) => (value === null ? null : !value);
/** 原版CardStateManager/CardViewer/GridViewerPanel的卡片关系。仅管理状态，不伪造飞行动画。 */
export class LinkModel {
  constructor(project, state) {
    this.project = project;
    this.state = state;
    this.captureSides = state.captureSides || new Map();
    state.captureSides = this.captureSides;
    this.enabled = [];
    this.active = [];
    this.unsupported = new Map();
  }
  problem(node, reason) {
    this.unsupported.set(`${node?.attrs?.guid}:${reason}`, {
      guid: node?.attrs?.guid,
      reason,
    });
    return null;
  }
  cardOf(node) {
    return node?.type === "Card" ? node : this.project.owner(node, "Card");
  }
  statusOK(node, subject) {
    const s = this.state,
      card = this.cardOf(subject);
    if (!card) return this.problem(node, "条件目标无所属卡片");
    const guid = card.attrs.guid;
    if (node.attrs.mouseOverOnly === "true" && !s.hovered.has(guid))
      return false;
    const wanted = refs(node.attrs.requiredCoords).map(Number).reverse();
    switch (node.attrs.cardStatus || "NONE") {
      case "NONE":
        return true;
      case "IN_PLAY":
        return s.inPlay.has(guid);
      case "ON_GRID":
        return s.coords.has(guid);
      case "AT_COORDS":
        return same(s.coords.get(guid), wanted);
      case "CAPTOR_AT_COORDS":
        return same(s.coords.get(s.captors.get(guid)), wanted);
      default:
        return this.problem(node, "未知cardStatus");
    }
  }
  predicate(node, seen = new Set()) {
    if (!node) return true;
    if (node.type === "CompoundPredicate" || node.type === "StateTransition") {
      const predicates = this.project.container(node, "predicates");
      if (!predicates.length) return true;
      const values = predicates.map((p) => this.predicate(p, seen)),
        op = node.attrs.predicateOperator || "ALL";
      if (op === "ALL")
        return values.includes(false)
          ? false
          : values.includes(null)
            ? null
            : true;
      if (op === "ANY")
        return values.includes(true)
          ? true
          : values.includes(null)
            ? null
            : false;
      if (op === "FORMULA") {
        try {
          return evaluateFormula(
            node.attrs.predicateFormula,
            new Map(predicates.map((p, i) => [p.attrs.id, values[i]])),
          );
        } catch (error) {
          return this.problem(node, error.message);
        }
      }
      return this.problem(node, "未知predicateOperator");
    }
    if (node.type !== "AtomicPredicate")
      return this.problem(node, "未知谓词类型");
    const target = this.project.get(node.attrs.subject);
    if (target?.type !== "CardLink" && target?.type !== "StateTransition")
      return this.state.isSatisfied(node);
    const gate = this.statusOK(node, target);
    if (gate !== true)
      return node.attrs.negated === "true" ? negate(gate) : gate;
    const value =
      target.type === "CardLink"
        ? this.isActive(target, seen)
        : this.predicate(target, seen);
    return node.attrs.negated === "true" ? negate(value) : value;
  }
  isEnabled(link, seen = new Set()) {
    const p = this.project,
      s = this.state,
      node = typeof link === "string" ? p.get(link) : link;
    if (node?.type !== "CardLink") return false;
    const owner = this.cardOf(node),
      other = p.get(node.attrs.otherCard),
      location = p.owner(node, "SceneLocation");
    if (!owner || other?.type !== "Card" || !location) return false;
    if (s.locations.get(owner.attrs.guid) !== location.attrs.guid) return false;
    const allowed = refs(node.attrs.otherCardLocations);
    if (allowed.length) {
      const transition = p.get(s.targets.get(other.attrs.guid));
      if (transition?.type === "LocationTransition") {
        if (node.attrs.enabledDuringTransition !== "true") return false;
        const from = p.owner(transition, "SceneLocation");
        if (
          !allowed.includes(from?.attrs.guid) ||
          !allowed.includes(transition.attrs.destLocation)
        )
          return false;
      } else if (!allowed.includes(s.locations.get(other.attrs.guid)))
        return false;
    }
    return this.predicate(p.container(node, "predicate")[0], seen);
  }
  direction(ownerGUID, otherGUID) {
    const a = this.state.coords.get(ownerGUID),
      b = this.state.coords.get(otherGUID);
    if (!a || !b) return "NONE";
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    if (dy === 0 && dx === 1) return "EAST";
    if (dy === 0 && dx === -1) return "WEST";
    if (dx === 0 && dy === 1) return "SOUTH";
    if (dx === 0 && dy === -1) return "NORTH";
    return "NONE";
  }
  isActive(link, seen = new Set()) {
    const p = this.project,
      s = this.state,
      node = typeof link === "string" ? p.get(link) : link;
    if (node?.type !== "CardLink") return false;
    if (seen.has(node)) return this.problem(node, "CardLink条件引用循环");
    const chain = new Set(seen);
    chain.add(node);
    const enabled = this.isEnabled(node, chain);
    if (enabled !== true) return enabled;
    const owner = this.cardOf(node).attrs.guid,
      other = node.attrs.otherCard,
      direction = node.attrs.direction;
    if (direction === "UNDER" || direction === "OVER") {
      if (
        s.captors.get(other) === owner &&
        this.captureSides.get(other) === direction
      )
        return true;
      return (
        node.attrs.isOriginator === "true" &&
        !s.inPlay.has(other) &&
        !s.captors.has(other)
      );
    }
    if (["NORTH", "SOUTH", "EAST", "WEST"].includes(direction))
      return this.direction(owner, other) === direction;
    return false;
  }
  refresh() {
    this.unsupported.clear();
    this.enabled = [];
    this.active = [];
    for (const link of this.project.all("CardLink")) {
      if (this.isEnabled(link) === true) this.enabled.push(link);
      if (this.isActive(link) === true) this.active.push(link);
    }
    const previous = this.state.activeLinks;
    const active = new Set(this.active.map((l) => l.attrs.guid));
    const changed =
      active.size !== previous.size ||
      [...active].some((g) => !previous.has(g));
    this.state.activeLinks = active;
    if (changed) this.state.version++;
    return {
      enabled: this.enabled,
      active: this.active,
      unsupported: [...this.unsupported.values()],
      changed,
    };
  }
  getCaptureCandidate(cardGUID, direction) {
    this.refresh();
    const link = this.active.find(
      (l) =>
        this.cardOf(l)?.attrs.guid === cardGUID &&
        ["OVER", "UNDER"].includes(l.attrs.direction) &&
        (!direction || l.attrs.direction === direction),
    );
    if (!link) return null;
    return {
      linkGUID: link.attrs.guid,
      ownerGUID: cardGUID,
      cardGUID: link.attrs.otherCard,
      locationGUID: this.state.locations.get(link.attrs.otherCard),
      direction: link.attrs.direction,
      originator: link.attrs.isOriginator === "true",
    };
  }
  assertCard(guid) {
    if (this.project.get(guid)?.type !== "Card")
      throw new Error("卡片GUID无效");
  }
  capture(ownerGUID, otherGUID, direction) {
    const s = this.state;
    this.assertCard(ownerGUID);
    this.assertCard(otherGUID);
    if (!["OVER", "UNDER"].includes(direction))
      throw new Error("只可捕获OVER/UNDER关系");
    if (ownerGUID === otherGUID) throw new Error("不可捕获自身");
    for (let ancestor = ownerGUID; ancestor; ancestor = s.captors.get(ancestor))
      if (ancestor === otherGUID) throw new Error("捕获关系形成循环");
    this.refresh();
    const link = this.enabled.find(
      (l) =>
        this.cardOf(l)?.attrs.guid === ownerGUID &&
        l.attrs.otherCard === otherGUID &&
        l.attrs.direction === direction,
    );
    if (!link) return false;
    s.captors.set(otherGUID, ownerGUID);
    this.captureSides.set(otherGUID, direction);
    s.coords.delete(otherGUID);
    s.inPlay.delete(otherGUID);
    s.version++;
    this.refresh();
    return true;
  }
  /** 等价于takeCard的状态部分：OVER拖出other，UNDER拖出owner并在原格释放other。 */
  release(cardGUID) {
    this.assertCard(cardGUID);
    const s = this.state,
      coords = s.coords.get(cardGUID);
    if (!s.inPlay.has(cardGUID) || !coords)
      throw new Error("只能从棋盘拿取当前可玩的卡片");
    this.refresh();
    const over = this.getCaptureCandidate(cardGUID, "OVER");
    if (over) {
      s.captors.delete(over.cardGUID);
      this.captureSides.delete(over.cardGUID);
      s.inPlay.add(over.cardGUID);
      s.coords.delete(over.cardGUID);
      s.version++;
      this.refresh();
      return {
        draggedGUID: over.cardGUID,
        revealedGUID: cardGUID,
        from: coords ? [...coords] : null,
        direction: "OVER",
      };
    }
    const under = this.getCaptureCandidate(cardGUID, "UNDER");
    s.coords.delete(cardGUID);
    if (under) {
      s.captors.delete(under.cardGUID);
      this.captureSides.delete(under.cardGUID);
      s.inPlay.add(under.cardGUID);
      if (coords) s.coords.set(under.cardGUID, [...coords]);
    }
    s.version++;
    this.refresh();
    return {
      draggedGUID: cardGUID,
      revealedGUID: under?.cardGUID || null,
      from: coords ? [...coords] : null,
      direction: under ? "UNDER" : null,
    };
  }
  /** 原版addCardToGrid捕获优先级；非法叠放只返回false，不猜测shuffle动画。 */
  place(cardGUID, coords) {
    this.assertCard(cardGUID);
    const s = this.state;
    if (s.captors.has(cardGUID)) throw new Error("被捕获的卡片需要先释放");
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      !coords.every((v) => Number.isInteger(v) && v >= 0 && v < 2)
    )
      throw new Error("棋盘坐标无效");
    const occupied = [...s.coords].find(
      ([guid, at]) => guid !== cardGUID && same(at, coords),
    )?.[0];
    if (occupied) {
      this.refresh();
      const under = this.enabled.find(
        (l) =>
          this.cardOf(l)?.attrs.guid === cardGUID &&
          l.attrs.otherCard === occupied &&
          l.attrs.direction === "UNDER",
      );
      if (under) {
        if (!this.capture(cardGUID, occupied, "UNDER")) return false;
      } else {
        const over = this.enabled.find(
          (l) =>
            this.cardOf(l)?.attrs.guid === occupied &&
            l.attrs.otherCard === cardGUID &&
            l.attrs.direction === "OVER",
        );
        if (!over) return false;
        return this.capture(occupied, cardGUID, "OVER");
      }
    }
    s.coords.set(cardGUID, [...coords]);
    s.inPlay.add(cardGUID);
    s.version++;
    this.refresh();
    return true;
  }
}
