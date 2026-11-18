import { CARD_SIZE } from './camera.js';

const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * .5 + .5;
  gl_Position = vec4(position, 0., 1.);
}`;

// WinCircle, sharedassets0.assets shader 108.
const fragmentSource = `
precision mediump float;
varying vec2 uv;
uniform sampler2D paper, rim, foreground, title;
uniform vec2 oval;
uniform float radius, opacity, titleFade;
void main() {
  vec2 point = (uv - .5) * oval;
  float alpha = clamp(1. - (length(point) - radius) / .0025, 0., 1.) * opacity;
  if (alpha < .001) discard;
  vec4 mainImage = texture2D(foreground, .5 + point);
  mainImage.rgb *= mix(.375, 1., titleFade);
  vec4 titleImage = texture2D(title, .5 + point);
  vec4 front = mix(mainImage, titleImage, titleImage.a * titleFade);
  vec3 background = texture2D(paper, uv * oval * 3.).rgb;
  vec4 border = texture2D(rim, .5 + point / (2. * radius));
  gl_FragColor = vec4(mix(mix(background, front.rgb, front.a), border.rgb, border.a), alpha);
}`;

export function endingFrame(width, height, elapsed, titleFade) {
  const shortest = Math.min(width, height);
  const progress = Math.min(1, Math.max(0, elapsed / 1.6));
  const outerRadius = Math.fround(.707) * CARD_SIZE;
  const startScale = outerRadius / (CARD_SIZE / 10);
  const zoom = Math.max(outerRadius / Math.max(width, height), startScale + (1 - startScale) * progress * 4 / 3);
  return {
    oval: [width / shortest, height / shortest],
    radius: outerRadius / zoom / shortest,
    opacity: Math.min(1, progress * 8),
    titleFade
  };
}

function programFor(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(program);
      throw new Error(message);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export class EndingScreen {
  constructor(canvas, manifest, project, baseUrl) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!this.gl) return;
    const gl = this.gl;
    const program = programFor(gl);
    gl.useProgram(program);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(['oval','radius','opacity','titleFade'].map(name => [name,gl.getUniformLocation(program,name)]));
    const attrs = project.tree.attrs;
    this.ready = Promise.all(Object.entries({
      paper: attrs.winScreenTextureFilename, rim: attrs.finalTransOverlayFilename,
      foreground: attrs.winScreenForegroundFilename, title: 'win_screen_title.png'
    }).map(async ([uniform, filename], unit) => {
      const image = new Image();
      const name = filename?.replace(/\.png$/i, '');
      const texture = manifest.textures.find(entry => entry.name === name);
      if (!texture) throw new Error(`结局图像缺失 ${filename}`);
      image.src = new URL(texture.url, baseUrl).href;
      await image.decode();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, axis, uniform === 'paper' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, uniform), unit);
    })).then(() => { this.loaded = true; });
  }

  draw(elapsed, titleFade) {
    const { canvas, gl, uniforms } = this;
    if (!this.loaded) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const density = globalThis.devicePixelRatio || 1;
    const rasterWidth = Math.round(width * density), rasterHeight = Math.round(height * density);
    const frame = endingFrame(width, height, elapsed, titleFade);
    const key = [rasterWidth,rasterHeight,frame.radius,frame.opacity,titleFade].join(',');
    if (key === this.lastFrame) return;
    this.lastFrame = key;
    if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
    if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
    gl.viewport(0, 0, rasterWidth, rasterHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.oval, ...frame.oval);
    for (const name of ['radius','opacity','titleFade']) gl.uniform1f(uniforms[name], frame[name]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
