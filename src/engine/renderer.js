import {
  AnimationSampler,
  interpFraction,
  clamp01,
  graphicBounds,
} from "./animation.js";
import {
  Camera,
  CARD_SIZE,
  identity4,
  identity2,
  multiply4,
  invert4,
  point3,
  multiply2,
  affine,
  vector,
  resolveViewpoint,
  parallaxTransform,
} from "./camera.js";
import { AtlasStore } from "./atlas.js";
import { hazeColor, hazeDrawList, paintHaze } from "./effects.js";
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const refs = (value) =>
  String(value || "")
    .split(/[|,]/)
    .filter(Boolean);
const clamp = (x) => Math.max(0, Math.min(1, x));
function drawLeaves(list, leaves = []) {
  for (const item of list) {
    if (!item.kind) leaves.push(item);
    for (const key of ["mask", "children", "caster", "receiver"])
      if (item[key]) drawLeaves(item[key], leaves);
  }
  return leaves;
}
export function reportTextureUrls(reports) {
  return [
    ...new Set(
      reports.flatMap((report) =>
        drawLeaves(report.drawn).map((item) => item.region.textureUrl),
      ),
    ),
  ];
}

export class SceneRenderer {
  constructor(
    project,
    manifest,
    atlases,
    {
      isSatisfied = () => null,
      holeContent = () => null,
      scriptGraphics = () => null,
      scriptDurationMillis,
      baseUrl = globalThis.document?.baseURI,
    } = {},
  ) {
    this.project = project;
    this.atlas = new AtlasStore(manifest, atlases, { baseUrl });
    this.isSatisfied = isSatisfied;
    this.holeContent = holeContent;
    this.scriptGraphics = scriptGraphics;
    this.sequenceCache = new WeakMap();
    this.animation = new AnimationSampler(project, {
      sequenceFrames: (node) => this.sequenceFrames(node),
      scriptDurationMillis,
    });
  }
  sequenceFrames(node) {
    if (this.sequenceCache.has(node)) return this.sequenceCache.get(node);
    const p = this.project,
      card = p.owner(node, "Card"),
      scene = p.owner(node, "Scene"),
      name = node.attrs.animationName;
    const roots = [
      `animations/${card?.attrs.id}/${scene?.attrs.id}/${name}`,
      `animations/${name}`,
    ].map((value) => value.toLowerCase());
    for (const root of roots) {
      const frames = [];
      for (const [source, regions] of this.atlas.regions) {
        if (!source.startsWith(root + ".")) continue;
        const index = Number(source.slice(root.length + 1));
        if (!Number.isInteger(index) || index < 0) continue;
        if (regions.length !== 1) throw new Error(`逐帧资源多义 ${source}`);
        frames[index] = regions[0];
      }
      if (frames.length) {
        for (let i = 0; i < frames.length; i++)
          if (!frames[i]) throw new Error(`逐帧资源缺帧 ${root}.${i}`);
        this.sequenceCache.set(node, frames);
        return frames;
      }
    }
    throw new Error(`逐帧图集不存在 ${roots.join(" / ")}`);
  }
  firstPartTexture(node, seen = new Set()) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const p = this.project;
    // MotionKeyframesGraphic.getPartImage takes GetTextures()[0].
    // For a direct graphic link the shipped GetTextures delegates to its target.
    if (node.type === "LinkedGraphic")
      return this.firstPartTexture(p.get(node.attrs.graphic), seen);
    if (node.type !== "LayeredImageGraphic") return;
    for (const image of p.container(
      p.container(node, "layeredImage")[0],
      "imageLayers",
    )) {
      const region = this.atlas.find(image.attrs.inputFilename);
      if (region) return { image, region };
    }
  }
  buildDrawList(
    locationGUID,
    {
      timeSeconds = 0,
      viewpoint,
      graphicTimes = new Map(),
      locationTrail = new Set(),
      transitionLocations,
    } = {},
  ) {
    const p = this.project,
      location = p.get(locationGUID),
      report = {
        drawn: [],
        unsupported: [],
        missing: [],
        layers: [],
        locations: [],
        animations: [],
        timeSeconds,
      };
    if (locationTrail.has(locationGUID)) {
      report.unsupported.push({
        type: "SceneLocation",
        guid: locationGUID,
        reason: "远程场景引用循环",
      });
      return report;
    }
    const remoteTrail = new Set(locationTrail);
    remoteTrail.add(locationGUID);
    if (location?.type !== "SceneLocation") {
      report.missing.push({ kind: "location", guid: locationGUID });
      return report;
    }
    const warn = (node, reason) =>
      report.unsupported.push({
        type: node?.type,
        guid: node?.attrs.guid,
        id: node?.attrs.id,
        reason,
      });
    const find = (guid, node) => {
      const found = p.get(guid);
      if (!found)
        report.missing.push({
          kind: "reference",
          guid,
          from: node?.attrs.guid,
        });
      return found;
    };
    const satisfied = (node) => {
      const result = this.isSatisfied(node);
      if (result !== true && result !== false) warn(node, "谓词语义未实现");
      return result === true;
    };
    let current;
    try {
      current = viewpoint || resolveViewpoint(p, location);
    } catch (error) {
      warn(location, error.message);
      return report;
    }
    const visible = [];
    const visit = (loc, coord, trail) => {
      if (trail.has(loc)) {
        warn(loc, "背景/其他位置引用循环");
        return;
      }
      const seen = new Set(trail);
      seen.add(loc);
      report.locations.push(loc.attrs.guid);
      try {
        const locView = resolveViewpoint(p, loc),
          home = {
            camera: new Camera(multiply4(coord, locView.camera.matrix)),
            viewport: locView.viewport,
          };
        const layers = [
          ...refs(loc.attrs.otherLocationLayers)
            .map((guid) => find(guid, loc))
            .filter(Boolean),
          ...p.container(loc, "sceneLocationLayers"),
        ];
        for (const layer of layers) {
          const sceneLayer = find(layer.attrs.sceneLayer, layer);
          if (!sceneLayer) continue;
          const originalPoint = vector(sceneLayer.attrs.refPoint, 3, [0, 0, 0]),
            offset = vector(sceneLayer.attrs.offset, 3, [0, 0, 0]);
          const refPoint = point3(
              coord,
              originalPoint.map((x, i) => x + offset[i]),
            ),
            background = sceneLayer.attrs.isBackground === "true";
          visible.push({
            layer,
            sceneLayer,
            home,
            refPoint,
            background,
            coord,
          });
        }
        for (const guid of refs(loc.attrs.otherLocations)) {
          const other = find(guid, loc);
          if (other) visit(other, coord, seen);
        }
        if (loc.attrs.backgroundLocation) {
          const bg = find(loc.attrs.backgroundLocation, loc);
          if (bg) {
            const bgView = resolveViewpoint(p, bg);
            const bgCoord = multiply4(
              coord,
              multiply4(locView.camera.matrix, invert4(bgView.camera.matrix)),
            );
            visit(bg, bgCoord, seen);
          }
        }
      } catch (error) {
        warn(loc, error.message);
      }
    };
    for (const candidate of transitionLocations?.length
      ? transitionLocations
      : [location]) {
      const node = typeof candidate === "string" ? p.get(candidate) : candidate;
      if (node?.type === "SceneLocation") visit(node, identity4(), new Set());
      else
        report.missing.push({
          kind: "transition-location",
          guid:
            typeof candidate === "string" ? candidate : candidate?.attrs?.guid,
        });
    }
    const enabled = (entry) => {
      const hasStates = p.container(entry.sceneLayer, "states").length > 0,
        hasScript = Boolean(entry.layer.attrs.script);
      if (hasScript) warn(entry.layer, "图层脚本尚未实现");
      return p.container(entry.layer, "graphics").filter((g) => {
        const pred = p.container(g, "predicate")[0];
        return pred ? satisfied(pred) : !hasStates && !hasScript;
      });
    };
    const byLayer = new Map();
    for (const entry of visible) {
      entry.graphics = enabled(entry);
      if (!entry.graphics.length) continue;
      if (
        !entry.background &&
        current.camera.globalToCamera(entry.refPoint)[2] > -0.1
      )
        continue;
      const key = entry.sceneLayer.attrs.guid,
        list = byLayer.get(key) || [];
      list.push(entry);
      byLayer.set(key, list);
    }
    const selected = [];
    for (const entries of byLayer.values()) {
      const same = (a, b) =>
        a.home.camera.position.every((v, i) => v === b.home.camera.position[i]);
      const metric = (a, b) =>
        same(a, b)
          ? [
              distance(
                current.viewport.slice(0, 2),
                a.home.viewport.slice(0, 2),
              ),
              distance(
                current.viewport.slice(0, 2),
                b.home.viewport.slice(0, 2),
              ),
            ]
          : [
              distance(current.camera.position, a.home.camera.position),
              distance(current.camera.position, b.home.camera.position),
            ];
      const sourceOrder = new Map(entries.map((entry, i) => [entry, i]));
      entries.sort((a, b) => {
        const [da, db] = metric(a, b);
        return da - db || sourceOrder.get(b) - sourceOrder.get(a);
      });
      let chosen = entries.slice(0, 2).map((entry) => ({ ...entry, alpha: 1 }));
      if (chosen.length === 2) {
        let [a, b] = chosen;
        const sameCamera = same(a, b),
          [da, db] = metric(a, b),
          between = sameCamera
            ? distance(a.home.viewport.slice(0, 2), b.home.viewport.slice(0, 2))
            : distance(a.home.camera.position, b.home.camera.position);
        const lateral =
          sameCamera &&
          Math.abs(a.home.viewport[2] - b.home.viewport[2]) < 0.001 &&
          Math.abs(a.home.viewport[3] - b.home.viewport[3]) < 0.001;
        const sum = da + db;
        let weights = lateral ? [1, 1] : sum ? [db / sum, da / sum] : [1, 0];
        if (!lateral && (Math.abs(weights[0] - 1) < 0.001 || db >= between))
          chosen = [a];
        else {
          const reverse = sameCamera
            ? a.home.viewport[2] < b.home.viewport[2]
            : current.camera.globalToCamera(b.home.camera.position)[2] >
              current.camera.globalToCamera(a.home.camera.position)[2];
          if (reverse) {
            chosen.reverse();
            weights.reverse();
          }
          const approach = Number(
            chosen[1].layer.attrs.approachTransition ?? 0.5,
          );
          chosen[0].alpha =
            1 - approach === 0
              ? Number(weights[0] > 0)
              : clamp(weights[0] / (1 - approach));
          chosen[1].alpha =
            approach === 0
              ? Number(weights[1] > 0)
              : clamp(weights[1] / approach);
        }
      }
      for (const entry of chosen) {
        entry.depth = entry.background
          ? Infinity
          : -current.camera.globalToCamera(entry.refPoint)[2];
        selected.push(entry);
      }
    }
    selected.sort((a, b) => b.depth - a.depth);
    const renderGraphic = (
      graphic,
      matrix,
      alpha,
      trail,
      force = false,
      fractionOverride,
    ) => {
      if (!graphic) return;
      if (trail.has(graphic)) {
        warn(graphic, "图形引用循环");
        return;
      }
      const seen = new Set(trail);
      seen.add(graphic);
      if (!force && graphic.attrs.enabled === "false") return;
      const locationOwner = p.owner(graphic, "SceneLocation");
      let fraction = fractionOverride;
      try {
        if (fraction === undefined) {
          const durationSeconds = this.animation.durationMillis(graphic) / 1000,
            started = graphicTimes.get(graphic.attrs.guid) ?? 0,
            elapsedSeconds = Math.max(0, timeSeconds - started),
            layer = p.owner(graphic, "LocationLayer");
          fraction = durationSeconds
            ? clamp01(elapsedSeconds / durationSeconds)
            : 0;
          report.animations.push({
            guid: graphic.attrs.guid,
            sceneLayerGUID: layer?.attrs.sceneLayer,
            durationSeconds,
            elapsedSeconds,
            complete: elapsedSeconds >= durationSeconds,
          });
        }
        fraction = interpFraction(graphic.attrs.interpFunction, fraction);
      } catch (error) {
        warn(graphic, error.message);
        return;
      }
      const shape = String(graphic.attrs.clipShapePoints || "")
        .split(";")
        .filter(Boolean)
        .map((p) => p.split(",").map(Number));
      let clip = null;
      if (
        shape.length >= 3 &&
        shape.every((p) => p.length === 2 && p.every(Number.isFinite))
      ) {
        if (graphic.attrs.clipShapeValueMode === "RELATIVE_TO_CARD")
          warn(graphic, "卡片坐标裁切待原版核对");
        else {
          const [x, y, w, h] = graphicBounds(p, graphic);
          clip = shape.map(([px, py]) => [x + px * w, y + py * h]);
        }
      }
      let transformed = clip ? identity2() : [...matrix];
      const graphicStart = report.drawn.length;
      const finish = () => {
        hazeDrawList(
          report.drawn.slice(graphicStart),
          hazeColor(graphic.attrs),
        );
        if (clip && report.drawn.length > graphicStart) {
          const children = report.drawn.splice(graphicStart);
          report.drawn.push({
            kind: "polygon",
            guid: graphic.attrs.guid,
            region: { textureUrl: "" },
            matrix,
            alpha: 1,
            clip,
            children,
          });
        }
      };
      try {
        const grid = vector(graphic.attrs.sourceOffset, 2, [0, 0]),
          proportional = vector(
            graphic.attrs.sourceProportionalOffset,
            2,
            [0, 0],
          ),
          pixel = vector(graphic.attrs.sourcePixelOffset, 2, [0, 0]);
        const dx =
            grid[0] * CARD_SIZE +
            Math.trunc(proportional[0] * CARD_SIZE) +
            pixel[0],
          dy =
            grid[1] * CARD_SIZE +
            Math.trunc(proportional[1] * CARD_SIZE) +
            pixel[1];
        transformed = multiply2(transformed, affine(1, 1, dx, dy));
        if (
          graphic.attrs.flipHorizontal === "true" ||
          graphic.attrs.flipVertical === "true"
        )
          transformed = multiply2(
            transformed,
            affine(
              graphic.attrs.flipHorizontal === "true" ? -1 : 1,
              graphic.attrs.flipVertical === "true" ? -1 : 1,
              graphic.attrs.flipHorizontal === "true" ? CARD_SIZE : 0,
              graphic.attrs.flipVertical === "true" ? CARD_SIZE : 0,
            ),
          );
        const rotation = Number(graphic.attrs.rotationRadians || 0);
        if (rotation) {
          const cs = Math.cos(rotation),
            sn = Math.sin(rotation),
            cx = ((transformed[0] + transformed[2]) * CARD_SIZE) / 2,
            cy = ((transformed[1] + transformed[3]) * CARD_SIZE) / 2,
            linear = multiply2(
              [cs, sn, -sn, cs, 0, 0],
              [...transformed.slice(0, 4), 0, 0],
            );
          linear[4] = transformed[4] + cx - (cs * cx - sn * cy);
          linear[5] = transformed[5] + cy - (sn * cx + cs * cy);
          transformed = linear;
        }
        // This Unity build reads blurRadius/marginFade only in hasEffects for cache policy.
        // Its sprite path does not apply either value as a live rendering filter.
        if (graphic.type === "LayeredImageGraphic") {
          const margin = vector(
            graphic.attrs.marginsRegion ?? locationOwner?.attrs.marginsRegion,
            4,
            [0, 0, 1, 1],
          );
          const placed = multiply2(
            transformed,
            affine(
              margin[2],
              margin[3],
              margin[0] * CARD_SIZE,
              margin[1] * CARD_SIZE,
            ),
          );
          const image = p.container(graphic, "layeredImage")[0];
          if (!image) {
            warn(graphic, "缺少LayeredImage");
            return;
          }
          for (const source of p.container(image, "imageLayers")) {
            const region = this.atlas.find(source.attrs.inputFilename);
            if (!region) {
              report.missing.push({
                kind: "image",
                source: source.attrs.inputFilename,
                from: graphic.attrs.guid,
              });
              continue;
            }
            let virtual = [0, 0, region.originalW, region.originalH];
            if (source.attrs.sourceRect) {
              virtual = vector(source.attrs.sourceRect, 4);
              if (source.attrs.sourceRectIsProportional === "true")
                virtual = virtual.map(
                  (v, i) =>
                    v * (i % 2 === 0 ? region.originalW : region.originalH),
                );
            }
            const [vx, vy, vw, vh] = virtual;
            if (!(vw > 0 && vh > 0)) {
              warn(source, "虚拟图片裁切尺寸无效");
              continue;
            }
            const dest = [
              ((region.offsetX - vx) / vw) * CARD_SIZE,
              ((region.originalH - region.offsetY - region.h - vy) / vh) *
                CARD_SIZE,
              (region.w / vw) * CARD_SIZE,
              (region.h / vh) * CARD_SIZE,
            ];
            report.drawn.push({
              guid: graphic.attrs.guid,
              id: graphic.attrs.id,
              source: region.source,
              region,
              matrix: placed,
              alpha,
              dest,
            });
          }
        } else if (graphic.type === "LinkedGraphic") {
          const target = find(graphic.attrs.graphic, graphic);
          if (!target) return;
          if (target.type === "SceneLocation") {
            const embedded = this.buildDrawList(target.attrs.guid, {
              timeSeconds,
              graphicTimes,
              locationTrail: remoteTrail,
            });
            for (const item of embedded.drawn)
              report.drawn.push({
                ...item,
                matrix: multiply2(transformed, item.matrix),
                alpha: alpha * item.alpha,
              });
            report.animations.push(...embedded.animations);
            report.layers.push(...embedded.layers);
            report.locations.push(...embedded.locations);
            report.unsupported.push(...embedded.unsupported);
            report.missing.push(...embedded.missing);
            finish();
            return;
          }
          let linked = transformed;
          const targetLayer = p.owner(target, "LocationLayer"),
            targetSceneLayer =
              targetLayer && p.get(targetLayer.attrs.sceneLayer);
          if (
            graphic.attrs.useRemoteCamera === "true" &&
            target.attrs.trackCamera !== "true" &&
            targetSceneLayer?.attrs.isBackground !== "true"
          ) {
            const targetLocation = p.owner(target, "SceneLocation");
            const from = resolveViewpoint(
                p,
                target.attrs.overrideViewpoint
                  ? find(target.attrs.overrideViewpoint, target)
                  : targetLocation,
              ),
              to = resolveViewpoint(
                p,
                graphic.attrs.overrideViewpoint
                  ? find(graphic.attrs.overrideViewpoint, graphic)
                  : locationOwner,
              );
            const pt = vector(targetSceneLayer?.attrs.refPoint, 3, [0, 0, 0]),
              off = vector(targetSceneLayer?.attrs.offset, 3, [0, 0, 0]);
            linked = multiply2(
              linked,
              parallaxTransform(
                from,
                to,
                pt.map((v, i) => v + off[i]),
              ),
            );
          }
          renderGraphic(target, linked, alpha, seen, true, fraction);
        } else if (graphic.type === "HoleGraphic") {
          const content = this.holeContent(graphic);
          if (!content || typeof content.sealed !== "boolean") {
            warn(graphic, "孔洞的卡片捕获状态未知");
            return;
          }
          const take = (callback) => {
            const start = report.drawn.length;
            callback();
            return report.drawn.splice(start);
          };
          const maskGraphic = graphic.attrs.maskGraphic
              ? find(graphic.attrs.maskGraphic, graphic)
              : null,
            mask = maskGraphic
              ? take(() =>
                  renderGraphic(
                    maskGraphic,
                    transformed,
                    1,
                    seen,
                    true,
                    fraction,
                  ),
                )
              : [];
          let children = [];
          if (content.sealed)
            children = [
              {
                kind: "fill",
                color: "#f2f2f0",
                matrix: transformed,
                alpha: 1,
                dest: [0, 0, CARD_SIZE, CARD_SIZE],
                region: { textureUrl: "" },
              },
            ];
          else if (content.locationGUID) {
            const embedded = this.buildDrawList(content.locationGUID, {
              timeSeconds,
              graphicTimes,
              locationTrail: remoteTrail,
            });
            children = embedded.drawn.map((item) => ({
              ...item,
              matrix: multiply2(transformed, item.matrix),
            }));
            for (const key of [
              "animations",
              "layers",
              "locations",
              "unsupported",
              "missing",
            ])
              report[key].push(...embedded[key]);
          }
          if (mask.length)
            report.drawn.push({
              kind: "mask",
              guid: graphic.attrs.guid,
              source: graphic.attrs.guid,
              region: { textureUrl: "" },
              matrix: identity2(),
              dest: [0, 0, CARD_SIZE, CARD_SIZE],
              alpha,
              mask,
              children,
              erase: !content.sealed && !content.locationGUID,
            });
          else
            for (const item of children)
              report.drawn.push({ ...item, alpha: item.alpha * alpha });
        } else if (graphic.type === "ShadowGraphic") {
          const casting = find(graphic.attrs.castingGraphic, graphic);
          if (!casting) return;
          const take = (callback) => {
            const start = report.drawn.length;
            callback();
            return report.drawn.splice(start);
          };
          const offset = vector(graphic.attrs.shadowOffset, 2, [0, 0]),
            m = multiply2(transformed, affine(1, 1, ...offset));
          const caster = take(() =>
              renderGraphic(casting, m, 1, seen, false, fraction),
            ),
            receiving = graphic.attrs.receivingGraphic
              ? find(graphic.attrs.receivingGraphic, graphic)
              : null,
            receiver = receiving
              ? take(() =>
                  renderGraphic(
                    receiving,
                    transformed,
                    1,
                    seen,
                    false,
                    fraction,
                  ),
                )
              : [];
          if (caster.length)
            report.drawn.push({
              kind: "shadow",
              guid: graphic.attrs.guid,
              source: graphic.attrs.guid,
              region: { textureUrl: "" },
              matrix: identity2(),
              dest: [0, 0, CARD_SIZE, CARD_SIZE],
              alpha: alpha * Number(graphic.attrs.shadowAlpha ?? 0.5),
              caster,
              receiver,
              fillWithBlack: graphic.attrs.fillWithBlack === "true",
              haze:
                graphic.attrs.fillWithBlack === "true"
                  ? [0, 0, 0, 1]
                  : [0, 0, 0, 0],
            });
        } else if (graphic.type === "SpriteSequenceGraphic") {
          const frames = this.sequenceFrames(graphic),
            index = Math.max(
              0,
              Math.min(frames.length - 1, Math.floor(fraction * frames.length)),
            ),
            region = frames[index];
          const margin = vector(
              graphic.attrs.marginsRegion ?? locationOwner?.attrs.marginsRegion,
              4,
              [0, 0, 1, 1],
            ),
            placed = multiply2(
              transformed,
              affine(
                margin[2],
                margin[3],
                margin[0] * CARD_SIZE,
                margin[1] * CARD_SIZE,
              ),
            );
          const dest = [
            (region.offsetX / region.originalW) * CARD_SIZE,
            ((region.originalH - region.offsetY - region.h) /
              region.originalH) *
              CARD_SIZE,
            (region.w / region.originalW) * CARD_SIZE,
            (region.h / region.originalH) * CARD_SIZE,
          ];
          report.drawn.push({
            guid: graphic.attrs.guid,
            id: graphic.attrs.id,
            source: region.source,
            region,
            matrix: placed,
            alpha,
            dest,
            frame: index,
          });
        } else if (graphic.type === "PlayListGraphic") {
          // The shipped player imports playbackSampled, but no playback code reads it.
          for (const sample of this.animation.playlist(graphic, fraction))
            renderGraphic(
              sample.graphic,
              transformed,
              alpha * sample.alpha,
              seen,
              false,
              sample.fraction,
            );
        } else if (graphic.type === "MotionKeyframesGraphic") {
          for (const part of this.animation.motionParts(graphic, fraction)) {
            const partMatrix = multiply2(transformed, part.matrix);
            if (!part.cutout) {
              renderGraphic(
                part.target,
                partMatrix,
                alpha,
                seen,
                false,
                part.fraction,
              );
              continue;
            }
            const texture = this.firstPartTexture(part.target);
            if (!texture) {
              warn(graphic, "动画部件缺少可解析的首个纹理");
              continue;
            }
            const { image, region } = texture;
            if (image.attrs.sourceRect) {
              warn(graphic, "动画部件的二次虚拟裁切尚未实现");
              continue;
            }
            const [cx, cy, cw, ch] = part.cutout.map(
                (v, i) =>
                  v * (i % 2 === 0 ? region.originalW : region.originalH),
              ),
              trimTop = region.originalH - region.offsetY - region.h;
            const left = Math.max(cx, region.offsetX),
              top = Math.max(cy, trimTop),
              right = Math.min(cx + cw, region.offsetX + region.w),
              bottom = Math.min(cy + ch, trimTop + region.h);
            if (right <= left || bottom <= top) continue;
            const w = right - left,
              h = bottom - top,
              subRegion = {
                ...region,
                u: region.u + left - region.offsetX,
                v: region.v + region.h - (top - trimTop) - h,
                w,
                h,
              };
            const dest = [
              ((left - cx) / region.originalW) * part.targetBounds[2],
              ((top - cy) / region.originalH) * part.targetBounds[3],
              (w / region.originalW) * part.targetBounds[2],
              (h / region.originalH) * part.targetBounds[3],
            ];
            report.drawn.push({
              guid: graphic.attrs.guid,
              id: graphic.attrs.id,
              part: part.keyframe.attrs.id,
              source: region.source,
              region: subRegion,
              matrix: partMatrix,
              alpha,
              dest,
            });
          }
        } else if (graphic.type === "ConditionalOffsetGraphic") {
          // The shipped update method sums every satisfied entry and hides an empty result.
          const offsets = String(graphic.attrs.offsetValues || "")
            .split(";")
            .filter(Boolean)
            .map((v) => vector(v, 2));
          const predicates = p.container(graphic, "predicates");
          if (offsets.length !== predicates.length) {
            warn(graphic, "条件位移表与谓词不对应");
            return;
          }
          const active = offsets.filter((_, i) => satisfied(predicates[i]));
          if (active.length) {
            const moved = [...transformed];
            moved[4] +=
              active.reduce((sum, point) => sum + point[0], 0) * CARD_SIZE;
            moved[5] +=
              active.reduce((sum, point) => sum + point[1], 0) * CARD_SIZE;
            renderGraphic(
              find(graphic.attrs.targetGraphic, graphic),
              moved,
              alpha,
              seen,
              false,
              fraction,
            );
          }
        } else if (graphic.type === "ProgressiveRevealGraphic") {
          // Unity's shipped implementation renders the revealed graphic with fractional alpha.
          renderGraphic(
            find(graphic.attrs.revealedGraphic, graphic),
            transformed,
            alpha * fraction,
            seen,
            false,
            fraction,
          );
        } else if (graphic.type === "ScriptedGraphic") {
          const items = this.scriptGraphics(graphic, transformed, {
            fraction,
            timeSeconds,
          });
          if (!Array.isArray(items)) warn(graphic, "图形脚本尚未实现");
          else
            for (const item of items) {
              if (item.polygon)
                report.drawn.push({
                  kind: "painted-polygon",
                  guid: graphic.attrs.guid,
                  matrix: item.matrix,
                  points: item.polygon,
                  color: item.color,
                  alpha,
                });
              else
                renderGraphic(
                  item.node,
                  item.matrix,
                  alpha,
                  seen,
                  true,
                  fraction,
                );
            }
        } else if (graphic.type === "ConditionalGraphic") {
          if (graphic.attrs.script) {
            warn(graphic, "条件图形脚本尚未实现");
            return;
          }
          const definition = graphic.attrs.instanceOfGraphic
            ? find(graphic.attrs.instanceOfGraphic, graphic)
            : graphic;
          if (!definition) return;
          const choices = refs(definition.attrs.graphics),
            predicates = p.container(definition, "predicates");
          const enabled = choices.filter(
            (guid, i) => predicates[i] && satisfied(predicates[i]),
          );
          for (const guid of graphic.attrs.evaluationMode === "MATCH_ALL"
            ? enabled
            : enabled.slice(0, 1))
            renderGraphic(
              find(guid, graphic),
              transformed,
              alpha,
              seen,
              true,
              fraction,
            );
        } else warn(graphic, "图形类型尚未实现");
      } catch (error) {
        warn(graphic, error.message);
      }
      finish();
    };
    for (const entry of selected) {
      report.layers.push({
        guid: entry.layer.attrs.guid,
        id: entry.layer.attrs.id,
        sceneLayer: entry.sceneLayer.attrs.guid,
        depth: entry.depth,
        alpha: entry.alpha,
      });
      let matrix;
      try {
        matrix = entry.background
          ? identity2()
          : parallaxTransform(entry.home, current, entry.refPoint);
      } catch (error) {
        warn(entry.layer, error.message);
        continue;
      }
      for (const graphic of entry.graphics)
        renderGraphic(
          graphic,
          graphic.attrs.trackCamera === "true" ? identity2() : matrix,
          entry.alpha,
          new Set(),
        );
      hazeDrawList(report.drawn, hazeColor(entry.layer.attrs), true);
    }
    return report;
  }
  async render(ctx, locationGUID, options = {}) {
    const report = options.report ?? this.buildDrawList(locationGUID, options);
    const leaves = drawLeaves(report.drawn);
    this.atlas.retainActive([
      ...new Set([
        ...(options.activeTextureUrls || []),
        ...leaves.map((item) => item.region.textureUrl),
      ]),
    ]);
    const images = new Map();
    await Promise.all(
      leaves.map(async (item) => {
        try {
          images.set(item, await this.atlas.image(item.region));
        } catch (error) {
          report.missing.push({
            kind: "image-load",
            source: item.source,
            reason: error.message,
          });
        }
      }),
    );
    const surface = () => {
      const canvas =
        typeof OffscreenCanvas === "function"
          ? new OffscreenCanvas(CARD_SIZE * 2, CARD_SIZE * 2)
          : ctx.canvas?.ownerDocument?.createElement("canvas");
      if (!canvas) throw new Error("合成需要Canvas离屏画布");
      canvas.width = canvas.height = CARD_SIZE * 2;
      const context = canvas.getContext("2d");
      context.scale(2, 2);
      return [canvas, context];
    };
    const paint = (target, list) => {
      for (const item of list) {
        target.save();
        target.globalAlpha *= item.alpha;
        if (!item.kind) {
          const image = images.get(item);
          if (image) {
            if (item.haze?.[3]) {
              const [canvas, layer] = surface();
              layer.transform(...item.matrix);
              layer.drawImage(
                image,
                ...this.atlas.crop(item.region),
                ...item.dest,
              );
              layer.setTransform(2, 0, 0, 2, 0, 0);
              paintHaze(layer, item.haze, CARD_SIZE, CARD_SIZE);
              target.drawImage(canvas, 0, 0, CARD_SIZE, CARD_SIZE);
            } else {
              target.transform(...item.matrix);
              target.drawImage(
                image,
                ...this.atlas.crop(item.region),
                ...item.dest,
              );
            }
          }
        } else if (item.kind === "polygon") {
          target.transform(...item.matrix);
          target.beginPath();
          target.moveTo(...item.clip[0]);
          for (const point of item.clip.slice(1)) target.lineTo(...point);
          target.closePath();
          target.clip();
          paint(target, item.children);
        } else if (item.kind === "painted-polygon") {
          target.transform(...item.matrix);
          target.beginPath();
          target.moveTo(...item.points[0]);
          for (const point of item.points.slice(1)) target.lineTo(...point);
          target.closePath();
          const haze = item.haze ?? [0, 0, 0, 0];
          const rgb = item.color.map(
            (value, index) =>
              value * (1 - haze[3]) + 255 * haze[index] * haze[3],
          );
          target.fillStyle = `rgb(${rgb.join(",")})`;
          target.fill();
        } else if (item.kind === "fill") {
          if (item.haze?.[3]) {
            const [canvas, layer] = surface();
            layer.transform(...item.matrix);
            layer.fillStyle = item.color;
            layer.fillRect(...item.dest);
            layer.setTransform(2, 0, 0, 2, 0, 0);
            paintHaze(layer, item.haze, CARD_SIZE, CARD_SIZE);
            target.drawImage(canvas, 0, 0, CARD_SIZE, CARD_SIZE);
          } else {
            target.transform(...item.matrix);
            target.fillStyle = item.color;
            target.fillRect(...item.dest);
          }
        } else if (item.kind === "shadow") {
          target.transform(...item.matrix);
          const [canvas, layer] = surface();
          paint(layer, item.caster);
          if (item.fillWithBlack) {
            layer.globalCompositeOperation = "source-in";
            layer.fillStyle = "#000";
            layer.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
          }
          if (item.receiver.length) {
            const [mask, maskCtx] = surface();
            paint(maskCtx, item.receiver);
            layer.globalCompositeOperation = "destination-in";
            layer.drawImage(mask, 0, 0, CARD_SIZE, CARD_SIZE);
          }
          paintHaze(layer, item.haze, CARD_SIZE, CARD_SIZE);
          target.drawImage(canvas, 0, 0, CARD_SIZE, CARD_SIZE);
        } else if (item.kind === "mask") {
          target.transform(...item.matrix);
          const [mask, maskCtx] = surface();
          paint(maskCtx, item.mask);
          if (item.erase) {
            target.globalCompositeOperation = "destination-out";
            target.drawImage(mask, 0, 0, CARD_SIZE, CARD_SIZE);
          } else {
            const [canvas, layer] = surface();
            paint(layer, item.children);
            layer.globalCompositeOperation = "destination-in";
            layer.drawImage(mask, 0, 0, CARD_SIZE, CARD_SIZE);
            target.drawImage(canvas, 0, 0, CARD_SIZE, CARD_SIZE);
          }
        }
        target.restore();
      }
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CARD_SIZE, CARD_SIZE);
    ctx.clip();
    paint(ctx, report.drawn);
    ctx.restore();
    return report;
  }
}
export function buildDrawList(
  project,
  manifest,
  atlases,
  locationGUID,
  options = {},
) {
  return new SceneRenderer(project, manifest, atlases, options).buildDrawList(
    locationGUID,
    options,
  );
}
