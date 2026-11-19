const refs = (value) =>
  String(value || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
/** 按原 HoleGraphic.getCapturedCardViewers/getUnderCardViewer/isSealed 解析下层内容。 */
export function resolveHoleContent(project, state, node) {
  const owner = project.owner(node, "Card"),
    location = project.owner(node, "SceneLocation");
  if (!owner || !location) return { sealed: true };
  const ownerGUID = owner.attrs.guid,
    captured = [];
  for (const [child, captor] of state.captors)
    if (captor === ownerGUID && state.captureSides?.get(child) === "UNDER")
      captured.push(child);
  // 原版此处仅检查originator与捕获/inPlay，不使用CardLink启用条件和direction。
  for (const link of project.container(location, "cardLinks", "CardLink"))
    if (
      link.attrs.isOriginator === "true" &&
      !state.inPlay.has(link.attrs.otherCard) &&
      !state.captors.has(link.attrs.otherCard) &&
      !captured.includes(link.attrs.otherCard)
    )
      captured.push(link.attrs.otherCard);
  const wanted = refs(node.attrs.showCards);
  let under;
  if (wanted.length) under = wanted.find((guid) => captured.includes(guid));
  else
    under =
      captured[0] ||
      (state.captureSides?.get(ownerGUID) === "OVER"
        ? state.captors.get(ownerGUID)
        : null);
  const open = project.container(node, "openPredicate")[0],
    layer = project.owner(node, "LocationLayer"),
    current = layer && state.states.get(layer.attrs.sceneLayer);
  const sealed =
    (open && state.isSatisfied(open) !== true) ||
    refs(node.attrs.blankFillStates).includes(current) ||
    (!captured.length && state.targets.has(ownerGUID)) ||
    (!captured.length &&
      !open &&
      state.locations.get(ownerGUID) !== location.attrs.guid);
  return {
    sealed: Boolean(sealed),
    locationGUID: sealed ? undefined : state.locations.get(under),
    cardGUID: under,
  };
}
