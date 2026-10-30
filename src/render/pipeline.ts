import * as THREE from 'three';
import { CONFIG } from '../config';
import { Palette } from './palette';

THREE.ColorManagement.enabled = false;

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly palette = new Palette(42);

  private rt!: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMaterial: THREE.ShaderMaterial;

  constructor() {
    // явный WebGL2 (инвариант проекта). Если контекст недоступен — понятная
    // ошибка в консоль вместо молчаливого чёрного экрана.
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    if (!gl) {
      throw new Error(
        'ПУСТОТА: WebGL2 недоступен. Обновите браузер или включите аппаратное ускорение.',
      );
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);

    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ih = CONFIG.render.internalHeight;
    const iw = Math.max(1, Math.round((w / h) * ih));

    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(iw, ih, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      });
      this.postMaterial.uniforms.tDiffuse.value = this.rt.texture;
    } else {
      this.rt.setSize(iw, ih);
    }
    this.postMaterial.uniforms.uRes.value.set(iw, ih);

    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, t: number) {
    this.palette.update(dt);
    this.postMaterial.uniforms.uTime.value = t;

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    float m[16] = float[16](
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0
    );
    return m[i.y * 4 + i.x] / 16.0 - 0.5;
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;

    // chromatic aberration (light)
    float sh = 0.0025;
    c.r = mix(c.r, texture2D(tDiffuse, vUv + vec2(sh, 0.0)).r, 0.5);
    c.b = mix(c.b, texture2D(tDiffuse, vUv - vec2(sh, 0.0)).b, 0.5);

    // vignette
    vec2 d = vUv - 0.5;
    float v = smoothstep(0.95, 0.25, length(d));
    c *= mix(0.35, 1.0, v);

    // dither
    c += bayer4(gl_FragCoord.xy) * 0.055;

    // crunch (5-bit per channel)
    c = floor(c * 32.0 + 0.5) / 32.0;

    // film grain
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) + uTime * 0.03);
    c += (n - 0.5) * 0.025;

    gl_FragColor = vec4(c, 1.0);
  }
`;