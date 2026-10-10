import React, { useEffect, useRef, useCallback } from "react";
import "../liquid-glass.css";

const DEFAULT_VIDEO = "https://img.blacklead.work/blacklead-fish.mp4";

// Fixed preset values matching the user's screenshot
const GLASS_AMP = 0.26;
const GLASS_CHROM = 0.25;
const GLASS_SPEED = 0.46;
const GLASS_CELL = 56.0;
const GLASS_SHAPE = 0; // 0: Hexagon

const vertSrc = `
attribute vec2 aPos; varying vec2 vUV;
void main(){ vUV=0.5*(aPos+1.0); gl_Position=vec4(aPos,0.0,1.0); }
`;

const fragSrc = `
#ifdef GL_ES
precision mediump float;
#endif
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
uniform vec2  iResolution;
uniform float iTime;
uniform vec2  iMouse;
uniform sampler2D iChannel0;

uniform float uCell, uAmp, uChrom, uSpeed, uAnimate;
uniform int   uShape; // 0..4
uniform vec2  uUVOffset;
uniform float uUVScale, uWireframe, uEnableRipple, uEnableParallax, uUseMouseLight;
uniform vec2  uRippleC;
uniform float uRippleT;

varying vec2 vUV;

float safeFwidth(float x){
  #ifdef GL_OES_standard_derivatives
  return fwidth(x);
  #else
  return 1.0;
  #endif
}

vec2 hex_pixel_to_axial(vec2 p, float s){
  float q = (1.7320508/3.0*p.x - 0.3333333*p.y)/s;
  float r = (0.6666667*p.y)/s;
  return vec2(q,r);
}
vec3 cube_round(vec3 c){
  float rx=floor(c.x+0.5), ry=floor(c.y+0.5), rz=floor(c.z+0.5);
  float dx=abs(rx-c.x), dy=abs(ry-c.y), dz=abs(rz-c.z);
  if(dx>dy && dx>dz) rx=-ry-rz; else if(dy>dz) ry=-rx-rz; else rz=-rx-ry;
  return vec3(rx,ry,rz);
}
vec2 hex_axial_round(vec2 qr){
  vec3 cube=vec3(qr.x, -qr.x-qr.y, qr.y);
  vec3 rc=cube_round(cube);
  return vec2(rc.x, rc.z);
}
vec2 hex_axial_to_pixel(vec2 qr, float s){
  float x=s*(1.7320508*qr.x + 0.8660254*qr.y);
  float y=s*(1.5*qr.y);
  return vec2(x,y);
}

float sdHex(vec2 p, float r){
  p=abs(p);
  return max(dot(p, normalize(vec2(1.0,1.7320508))) - r, p.x - r);
}
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p)-b; return max(d.x,d.y); }
float sdCircle(vec2 p, float r){ return length(p)-r; }
float sdTriIso(vec2 p, float r){
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r/k;
  if(p.x + k*p.y > 0.0){
    p = vec2(p.x - k*p.y, -k*p.x - p.y)/2.0;
  }
  p.x -= clamp(p.x, -2.0*r, 0.0);
  return -length(p)*sign(p.y);
}

void nearestCenter(int shape, vec2 p, float cell, out vec2 c, out vec2 lp){
  if(shape==0){
    vec2 qr  = hex_pixel_to_axial(p, cell);
    vec2 qrr = hex_axial_round(qr);
    c = hex_axial_to_pixel(qrr, cell);
    lp = p - c;
  } else if(shape==3){
    vec2 e1 = vec2(cell, 0.0);
    vec2 e2 = vec2(cell*0.5, cell*0.8660254);
    float det = e1.x*e2.y - e1.y*e2.x;
    vec2 k; 
    k.x = ( p.x*e2.y - p.y*e2.x) / det;
    k.y = (-p.x*e1.y + p.y*e1.x) / det;
    vec2 kR = floor(k + 0.5);
    c = e1*kR.x + e2*kR.y;
    lp = p - c;
  } else {
    vec2 g = floor(p/cell + 0.5);
    c = g * cell;
    lp = p - c;
  }
}

float shapeSDF(int shape, vec2 lp, float cell){
  if(shape==0){ return sdHex(lp, cell*0.95); }
  if(shape==1){ return sdBox(lp, vec2(cell*0.5)); }
  if(shape==2){
    float a = 0.78539816339; // 45°
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    return sdBox(R*lp, vec2(cell*0.5));
  }
  if(shape==3){ return sdTriIso(lp, cell*0.6); }
  return sdCircle(lp, cell*0.55);
}

vec3 sampleImage(vec2 uv){ return texture2D(iChannel0, uv).rgb; }

void main(){
  vec2 res=iResolution, frag=gl_FragCoord.xy, p=frag-0.5*res, uv=vUV;
  vec2 mouse=iMouse; bool hasMouse=(mouse.x>=0.0 && mouse.y>=0.0); vec2 mp=mouse-0.5*res;

  vec2 par=vec2(0.0);
  if(uEnableParallax>0.01 && hasMouse){ par=(mp/max(res.x,res.y))*0.05*uEnableParallax; }
  vec2 uvw=(uv-0.5)/max(1.0e-3,uUVScale) + uUVOffset + 0.5 + par;

  float cell=max(6.0,uCell);

  float t=iTime*uSpeed;
  float wave=(uAnimate>0.5)?(sin(p.x*0.01 + p.y*0.015 + t)*0.25):0.0;
  float localCell=cell*(1.0+wave*0.2);

  vec2 c, lp; nearestCenter(uShape, p, localCell, c, lp);
  float d = shapeSDF(uShape, lp, localCell);
  float inside = smoothstep(0.0, 1.5, -d);

  float rad = clamp(length(lp) / (localCell*0.95), 0.0, 1.0);
  vec2 n = normalize(lp + 1e-6);

  float ripple=0.0; vec2 rippleDir=vec2(0.0);
  if(uEnableRipple>0.5 && uRippleC.x>=0.0){
    vec2 cp=uRippleC-0.5*res; float R=length(p-cp); float dt=max(0.0,iTime-uRippleT);
    float env=exp(-R*0.006)*exp(-dt*1.0); ripple=sin(R*0.06 - dt*6.0)*env;
    rippleDir=normalize(p-cp+1e-6);
  }

  vec3 base=sampleImage(uvw);
  float strength=uAmp*(1.0-pow(rad,1.4))*0.07;
  vec2 refr=n*strength + rippleDir*(0.02*ripple);

  vec2 ca=refr*(0.25*uChrom); float ca2=0.6*uChrom;
  vec3 glass;
  glass.r=sampleImage(uvw+refr+ca).r;
  glass.g=sampleImage(uvw+refr).g;
  glass.b=sampleImage(uvw+refr-ca*ca2).b;

  vec2 L=(uUseMouseLight>0.01 && hasMouse)?normalize(mp):normalize(vec2(0.7,1.0));
  float spec=pow(max(0.0,dot(normalize(L),n)),14.0)*(1.0-rad);
  glass+=vec3(1.0,0.96,0.9)*spec*0.45;

  vec3 col=mix(base,glass,inside);
  if(uWireframe>0.5){
    float wf=smoothstep(1.5,0.0,abs(d));
    col=mix(col, vec3(1.0), wf*0.3);
  }

  float vign=smoothstep(1.2,0.2,length((frag-0.5*res)/res.y));
  col*=mix(0.9,1.0,vign);
  gl_FragColor=vec4(col,1.0);
}
`;

function createInitialTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const grad = ctx.createRadialGradient(256, 256, 10, 256, 256, 320);
  grad.addColorStop(0, "#2a151b");
  grad.addColorStop(0.4, "#160e15");
  grad.addColorStop(1, "#07070a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(256, 256, 50 + i * 36, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? "rgba(255, 154, 156, 0.35)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = "#ff9a9c";
  ctx.font = "bold 32px monospace";
  ctx.textAlign = "center";
  ctx.fillText("LIQUID GLASS", 256, 240);

  ctx.fillStyle = "#f4f4f6";
  ctx.font = "16px monospace";
  ctx.fillText("AUTHORITYGRAPH MATRIX", 256, 280);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function LiquidGlass() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoReadyRef = useRef<boolean>(false);

  // WebGL & animation refs
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const tex0Ref = useRef<WebGLTexture | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Interaction refs matching exact code
  const mouseTargetRef = useRef<[number, number]>([-1, -1]);
  const mouseSmRef = useRef<[number, number]>([-1, -1]);
  const mouseFactorRef = useRef<number>(0);
  const mouseFactorTargetRef = useRef<number>(0);

  const uvOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const uvScaleRef = useRef<number>(1.0);
  const draggingRef = useRef<boolean>(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const wireframeRef = useRef<number>(0.0);
  const rippleCRef = useRef<[number, number]>([-1, -1]);
  const rippleTRef = useRef<number>(0);

  // Uniform locations ref
  const uniformsRef = useRef<{
    uRes: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
    uMouse: WebGLUniformLocation | null;
    uCell: WebGLUniformLocation | null;
    uAmp: WebGLUniformLocation | null;
    uChrom: WebGLUniformLocation | null;
    uSpeed: WebGLUniformLocation | null;
    uAnim: WebGLUniformLocation | null;
    uUVOffset: WebGLUniformLocation | null;
    uUVScale: WebGLUniformLocation | null;
    uWireframe: WebGLUniformLocation | null;
    uEnableRipple: WebGLUniformLocation | null;
    uEnableParallax: WebGLUniformLocation | null;
    uUseMouseLight: WebGLUniformLocation | null;
    uRippleC: WebGLUniformLocation | null;
    uRippleT: WebGLUniformLocation | null;
    uShapeLoc: WebGLUniformLocation | null;
  } | null>(null);

  // Always add glass-active class (canvas is persistent)
  useEffect(() => {
    document.body.classList.add("liquid-glass-active");
  }, []);

  const clientToGL = useCallback((e: MouseEvent | React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [-1, -1];
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width);
    const y = (e.clientY - r.top) * (canvas.height / r.height);
    return [x, canvas.height - y];
  }, []);

  const setupVideo = useCallback((src: string) => {
    if (videoElRef.current) {
      try {
        videoElRef.current.pause();
      } catch (_) {}
    }
    const videoEl = document.createElement("video");
    videoEl.crossOrigin = "anonymous";
    videoEl.src = src;
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;

    videoEl.addEventListener("canplay", () => {
      videoReadyRef.current = true;
      videoEl.play().catch(() => {});
    });

    videoElRef.current = videoEl;
    videoReadyRef.current = false;
  }, []);

  // WebGL initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) {
      console.warn("WebGL not supported");
      return;
    }
    glRef.current = gl;

    // Standard derivatives extension if supported
    gl.getExtension("OES_standard_derivatives");

    function resize() {
      if (!canvas) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl?.viewport(0, 0, w, h);
      }
    }
    window.addEventListener("resize", resize);
    resize();

    function compile(type: number, src: string) {
      const s = gl!.createShader(type);
      if (!s) throw new Error("Shader creation failed");
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error(gl!.getShaderInfoLog(s));
        throw new Error("Shader compile error");
      }
      return s;
    }

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      throw new Error("Link error");
    }
    progRef.current = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    uniformsRef.current = {
      uRes: gl.getUniformLocation(prog, "iResolution"),
      uTime: gl.getUniformLocation(prog, "iTime"),
      uMouse: gl.getUniformLocation(prog, "iMouse"),
      uCell: gl.getUniformLocation(prog, "uCell"),
      uAmp: gl.getUniformLocation(prog, "uAmp"),
      uChrom: gl.getUniformLocation(prog, "uChrom"),
      uSpeed: gl.getUniformLocation(prog, "uSpeed"),
      uAnim: gl.getUniformLocation(prog, "uAnimate"),
      uUVOffset: gl.getUniformLocation(prog, "uUVOffset"),
      uUVScale: gl.getUniformLocation(prog, "uUVScale"),
      uWireframe: gl.getUniformLocation(prog, "uWireframe"),
      uEnableRipple: gl.getUniformLocation(prog, "uEnableRipple"),
      uEnableParallax: gl.getUniformLocation(prog, "uEnableParallax"),
      uUseMouseLight: gl.getUniformLocation(prog, "uUseMouseLight"),
      uRippleC: gl.getUniformLocation(prog, "uRippleC"),
      uRippleT: gl.getUniformLocation(prog, "uRippleT"),
      uShapeLoc: gl.getUniformLocation(prog, "uShape"),
    };

    const uTex0 = gl.getUniformLocation(prog, "iChannel0");
    gl.uniform1i(uTex0, 0);

    const tex0 = createInitialTexture(gl) || gl.createTexture();
    tex0Ref.current = tex0;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    // Setup the video
    setupVideo(DEFAULT_VIDEO);

    return () => {
      window.removeEventListener("resize", resize);
      if (videoElRef.current) {
        try {
          videoElRef.current.pause();
          videoElRef.current.src = "";
        } catch (_) {}
      }
    };
  }, [setupVideo]);

  // Main Draw / Animation Loop with fixed parameters
  useEffect(() => {
    const draw = (tms: number) => {
      const gl = glRef.current;
      const prog = progRef.current;
      const canvas = canvasRef.current;
      const uniforms = uniformsRef.current;
      const videoEl = videoElRef.current;

      if (!gl || !prog || !canvas || !uniforms) {
        animFrameIdRef.current = requestAnimationFrame(draw);
        return;
      }

      const t = tms * 0.001;

      if (
        videoEl &&
        videoReadyRef.current &&
        !videoEl.paused &&
        videoEl.readyState >= 2 &&
        tex0Ref.current
      ) {
        gl.bindTexture(gl.TEXTURE_2D, tex0Ref.current);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          videoEl
        );
      }

      const k = 1.0 - Math.exp(-0.25);
      if (mouseSmRef.current[0] < 0 || mouseSmRef.current[1] < 0) {
        mouseSmRef.current = [...mouseTargetRef.current];
      }
      mouseSmRef.current[0] += (mouseTargetRef.current[0] - mouseSmRef.current[0]) * k;
      mouseSmRef.current[1] += (mouseTargetRef.current[1] - mouseSmRef.current[1]) * k;
      mouseFactorRef.current += (mouseFactorTargetRef.current - mouseFactorRef.current) * k;

      gl.useProgram(prog);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform2f(uniforms.uMouse, mouseSmRef.current[0], mouseSmRef.current[1]);

      // Locked fixed settings matching the screenshot
      gl.uniform1f(uniforms.uCell, GLASS_CELL);
      gl.uniform1f(uniforms.uAmp, GLASS_AMP);
      gl.uniform1f(uniforms.uChrom, GLASS_CHROM);
      gl.uniform1f(uniforms.uSpeed, GLASS_SPEED);
      gl.uniform1f(uniforms.uAnim, 1.0);

      gl.uniform2f(uniforms.uUVOffset, uvOffsetRef.current.x, uvOffsetRef.current.y);
      gl.uniform1f(uniforms.uUVScale, uvScaleRef.current);

      gl.uniform1f(uniforms.uWireframe, wireframeRef.current);
      gl.uniform1f(uniforms.uEnableRipple, 1.0);
      gl.uniform1f(uniforms.uEnableParallax, 0.0);
      gl.uniform1f(uniforms.uUseMouseLight, mouseFactorRef.current);

      gl.uniform2f(uniforms.uRippleC, rippleCRef.current[0], rippleCRef.current[1]);
      gl.uniform1f(uniforms.uRippleT, rippleTRef.current);

      gl.uniform1i(uniforms.uShapeLoc, GLASS_SHAPE);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animFrameIdRef.current = requestAnimationFrame(draw);
    };

    animFrameIdRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, []);

  // Global window mouse listeners for dragging and fluid distortion
  useEffect(() => {
    const handleWindowMouseUp = () => {
      draggingRef.current = false;
    };
    const handleWindowMouseMove = (e: MouseEvent) => {
      mouseTargetRef.current = clientToGL(e);
      mouseFactorTargetRef.current = 1;
    };
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("mousemove", handleWindowMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("mousemove", handleWindowMouseMove);
    };
  }, []);

  // Canvas Mouse Interactions
  const handleMouseEnter = () => {
    mouseFactorTargetRef.current = 1;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    mouseTargetRef.current = clientToGL(e);
    mouseFactorTargetRef.current = 1;

    if (draggingRef.current) {
      const r = canvas.getBoundingClientRect();
      const dx = (e.clientX - (lastRef.current?.x || e.clientX)) / r.width;
      const dy = (e.clientY - (lastRef.current?.y || e.clientY)) / r.height;
      uvOffsetRef.current.x -= dx * uvScaleRef.current;
      uvOffsetRef.current.y += dy * uvScaleRef.current;
      lastRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseLeave = () => {
    mouseFactorTargetRef.current = 0;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) return;
    rippleCRef.current = clientToGL(e);
    rippleTRef.current = performance.now() * 0.001;
  };

  const handleDoubleClick = () => {
    wireframeRef.current = wireframeRef.current > 0.5 ? 0.0 : 1.0;
  };

  // Pure canvas — UI overlays are handled by App.tsx
  return (
    <canvas
      id="c"
      ref={canvasRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    />
  );
}

export default LiquidGlass;
