export const CARD_SIZE = 350;
export const CAMERA_FOV = 0.7853981852531433;
export const identity4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const identity2 = () => [1, 0, 0, 1, 0, 0];
export function vector(value, count, fallback) {
  if (value === undefined || value === "") {
    if (fallback) return [...fallback];
    throw new Error("缺少坐标数据");
  }
  const values = String(value).split(",").map(Number);
  if (values.length !== count || !values.every(Number.isFinite))
    throw new Error(`坐标格式无效: ${value}`);
  return values;
}
export function multiply4(a, b) {
  const out = Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}
export function invert4(matrix) {
  const rows = Array.from({ length: 4 }, (_, r) => [
    ...matrix.slice(r * 4, r * 4 + 4),
    ...identity4().slice(r * 4, r * 4 + 4),
  ]);
  for (let c = 0; c < 4; c++) {
    let best = c;
    for (let r = c + 1; r < 4; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[best][c])) best = r;
    if (Math.abs(rows[best][c]) < 1e-14) throw new Error("相机矩阵不可逆");
    [rows[c], rows[best]] = [rows[best], rows[c]];
    const scale = rows[c][c];
    for (let j = 0; j < 8; j++) rows[c][j] /= scale;
    for (let r = 0; r < 4; r++)
      if (r !== c) {
        const f = rows[r][c];
        for (let j = 0; j < 8; j++) rows[r][j] -= f * rows[c][j];
      }
  }
  return rows.flatMap((row) => row.slice(4));
}
export function point3(matrix, point, w = 1) {
  return [0, 1, 2].map(
    (r) =>
      matrix[r * 4] * point[0] +
      matrix[r * 4 + 1] * point[1] +
      matrix[r * 4 + 2] * point[2] +
      matrix[r * 4 + 3] * w,
  );
}
export function translation4(offset) {
  const m = identity4();
  [m[3], m[7], m[11]] = offset;
  return m;
}
export function multiply2(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const affine = (sx = 1, sy = sx, x = 0, y = 0) => [sx, 0, 0, sy, x, y];
export class Camera {
  constructor(matrix = identity4()) {
    this.matrix = [...matrix];
    this.inverse = invert4(this.matrix);
    this.position = point3(this.matrix, [0, 0, 0]);
  }
  globalToCamera(point) {
    return point3(this.inverse, point);
  }
  cameraToDisplay(point, viewport, size = CARD_SIZE) {
    const z = -point[2];
    if (!(z > 0)) return [NaN, NaN, z];
    const factor = 1 / (Math.tan(CAMERA_FOV) * z);
    return [
      ((point[0] * factor - viewport[0]) / viewport[2]) * size,
      ((-point[1] * factor - viewport[1]) / viewport[3]) * size,
      z,
    ];
  }
  globalToDisplay(point, viewport, size = CARD_SIZE) {
    return this.cameraToDisplay(this.globalToCamera(point), viewport, size);
  }
  offset(offset, local = false) {
    const move = translation4(offset);
    return new Camera(
      local ? multiply4(this.matrix, move) : multiply4(move, this.matrix),
    );
  }
}
export function getRefRect(
  camera,
  viewport,
  point,
  radius = 1,
  size = CARD_SIZE,
) {
  const p = camera.globalToCamera(point),
    a = camera.cameraToDisplay(
      [p[0] - radius, p[1] + radius, p[2]],
      viewport,
      size,
    ),
    b = camera.cameraToDisplay(
      [p[0] + radius, p[1] - radius, p[2]],
      viewport,
      size,
    );
  return [a[0], a[1], b[0] - a[0], b[1] - a[1]];
}
export function parallaxTransform(home, current, point) {
  const a = getRefRect(home.camera, home.viewport, point),
    b = getRefRect(current.camera, current.viewport, point),
    scale = b[2] / a[2];
  const result = affine(scale, scale, b[0] - a[0] * scale, b[1] - a[1] * scale);
  if (!result.every(Number.isFinite))
    throw new Error("参考点位于相机之后或视口无效");
  return result;
}
export function resolveViewpoint(project, node, stack = new Set()) {
  if (!node) throw new Error("缺少视点");
  const token = node.attrs.guid || node;
  if (stack.has(token)) throw new Error(`视点引用循环: ${node.attrs.guid}`);
  const seen = new Set(stack);
  seen.add(token);
  if (node.type === "SceneLocation") {
    const view = project.container(node, "viewpoint")[0];
    if (!view) throw new Error(`场景缺少视点: ${node.attrs.guid}`);
    return resolveViewpoint(project, view, seen);
  }
  if (node.type === "StandardViewpoint") {
    const camera = new Camera(vector(node.attrs.camera, 16));
    return {
      camera: camera.offset(
        vector(node.attrs.cameraOffset, 3, [0, 0, 0]),
        true,
      ),
      viewport: vector(node.attrs.viewport, 4),
    };
  }
  if (node.type === "InterpViewpoint") {
    const from = resolveViewpoint(
        project,
        project.get(node.attrs.fromLocation),
        seen,
      ),
      to = resolveViewpoint(project, project.get(node.attrs.toLocation), seen),
      f = Number(node.attrs.interpFraction);
    if (!Number.isFinite(f)) throw new Error("插值比例无效");
    return {
      camera: from.camera.offset(
        to.camera.position.map((x, i) => (x - from.camera.position[i]) * f),
      ),
      viewport: from.viewport.map((x, i) => x + (to.viewport[i] - x) * f),
    };
  }
  if (node.type === "OffsetViewpoint") {
    const from = resolveViewpoint(
        project,
        project.get(node.attrs.fromLocation),
        seen,
      ),
      offset = vector(node.attrs.viewportOffset, 2, [0, 0]),
      scale = Number(node.attrs.viewportScale ?? 1),
      [x, y, w, h] = from.viewport;
    return {
      camera: from.camera.offset(vector(node.attrs.offset, 3, [0, 0, 0])),
      viewport: [
        x + offset[0] + (1 - scale) / 2,
        y + offset[1] + (1 - scale) / 2,
        w - (1 - scale),
        h - (1 - scale),
      ],
    };
  }
  throw new Error(`尚未支持视点类型: ${node.type}`);
}
