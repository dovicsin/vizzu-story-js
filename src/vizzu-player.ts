"use strict";
//import VizzuController from "./vizzu-controller.js";
//import type Vizzu from 'vizzu'
import AnimationQueue from "./AnimationQueue.js";
import { AnimationParameters } from './AnimationQueue.js';

import type Vizzu from "vizzu";
import type {Config, Data, Styles, Anim} from "vizzu";

//type VizzuType = typeof vizzuType;

const LOG_PREFIX = [
  "%cVIZZU%cPLAYER",
  "background: #e2ae30; color: #3a60bf; font-weight: bold",
  "background: #3a60bf; color: #e2ae30;",
];

interface Phase {
  config?: Config.Chart;
  filter?: Data.FilterCallback | null;
  style?: Styles.Chart;
  data?: Data.Set;
  animOptions?: Anim.Options;
}

/** Slide consists of a single or multiple phase. Controls will navigate
 *  between slides. */
type Slide = Phase | Phase[];

/** Story configuration object represents the whole presentation containing
 *  the underlying data and the slides. */
interface Story {
  /** Data, copied into the initializer slide (if not present). */
  data?: Data.Set;
  /** Initial style, copied into the initializer slide (if not present). */
  style?: Styles.Chart;
  /** The sequence of the presentation's slides. */
  slides: Slide[];
}

type animData = {
  config?: Config.Chart;
  style?: Styles.Chart;
  data?: Data.Set | { filter: Data.FilterCallback } | undefined;
  options?: Anim.Options;
  filter?: Data.FilterCallback;
};
type animTargetData = {
  target: animData;
  options?: Anim.Options;
}


let VizzuElement:any;

class VizzuPlayer extends HTMLElement {
  shadowRoot!: ShadowRoot;
  initializing: Promise<boolean> | null = null;
  loading: Boolean = true;
  _slides: any;
  _currentSlide: number = 0;
  _originalSlides: any;
  _seekPosition: any;
  _animationQueue: any;

  vizzu: Vizzu | null = null;
  player: VizzuPlayer | null = null;
  direction: string = "normal";
  lastAnimation: AnimationParameters | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = this._render();


/*     this._resolvePlayer = null;
    this.ready = new Promise((resolve) => {
      this._resolvePlayer = resolve;
    }); */
  }
  
  async connectedCallback() { 
    await this._initVizzu();
    await this.vizzu?.initializing;
    this.loading = false;
    if (!this.hasAttribute("tabindex")) {
      this.setAttribute("tabindex", "0");
      this.tabIndex = 0;
    }

    window.addEventListener("hashchange", () => {
      if (this.hashNavigation) {
        const hashSlide = this._slideFromHash(this._slides.length);
        if (this._currentSlide !== hashSlide) {
          this.setSlide(hashSlide);
        }
      }
    });
  }

  get debug(): boolean {
    try {
      const debugCookie = document.cookie
        .split(";")
        .some((c) => c.startsWith("vizzu-debug"));
      return debugCookie || this.hasAttribute("debug") || this.player?.debug || false;
    } catch (e) {
      return this.hasAttribute("debug");
    }
  }

  log(...msg: any[]) {
    if (this.debug) {
      console.log(...LOG_PREFIX, ...msg);
    }
  }

  get Vizzu() {
    return VizzuElement;
  }

  get hashNavigation() {
    return this.hasAttribute("hash-navigation");
  }

  get vizzuUrl(): string | undefined {
    if ("Vizzu" in window) return undefined;
    return (
      this.getAttribute("vizzu-url") ||
      "https://cdn.jsdelivr.net/npm/vizzu@0.8/dist/vizzu.min.js"
    );
  }

  async _initVizzu() {
    if (!this.vizzu) {
      VizzuElement = "Vizzu" in window ? window.Vizzu as Vizzu : this.vizzuUrl && (await import(this.vizzuUrl)).default;

      if (!VizzuElement) {
        throw new Error("Vizzu not found");
      }
     // this._resolveVizzu(VizzuElement);
      this.vizzu = new VizzuElement(this.vizzuCanvas);
    }
  }

  _slideToAnimparams(slide:Phase) {

    const animTarget:animData = {};
    if (slide.config) {
      animTarget.config = slide.config;
    }
    if (slide.style) {
      animTarget.style = slide.style;
    }
    if (slide.data) {
      animTarget.data = slide.data;
    }
    if (typeof slide.filter !== "undefined") {
      if (!animTarget.data) {
        animTarget.data = {};
      }
      animTarget.data.filter = slide.filter;
    }

    const animParams:animTargetData = { target: animTarget };
    if (slide.animOptions) {
      animParams.options = slide.animOptions;
    }

    return animParams;
  }

  async _convertSlides(slides:Story) {
    if (slides?.slides?.length) {
      if (!Array.isArray(slides.slides[0])) {
        slides.slides[0] = [slides.slides[0]];
      }
      const firstSlide = slides.slides[0][0];
      firstSlide.data = firstSlide.data || Object.assign({}, slides.data);
      firstSlide.style = firstSlide.style || slides.style;
    }

    await this.initializing;
    this.vizzu?.on("animation-complete", () => {
      this._update();
    });
    this.animationQueue = new AnimationQueue(this.vizzu);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof this.vizzu?._setStyle === "function") {
      // workaround
      if (!slides.style) {
        slides.style = {};
      }
      if (!slides.style.fontSize) {
        slides.style.fontSize = "100%";
      }
      this.vizzu._setStyle(slides.style ?? null);
    }
    const seekToEnd = () => this._seekToEnd();
    this.vizzu.on("animation-begin", seekToEnd);

    const convertedSlides = [];

    let lastFilter;
    for (const slide of slides.slides) {
      let steps = slide;
      if (!Array.isArray(steps)) {
        steps = [steps];
      }

      const chartSteps:(Anim.Keyframe | undefined)[] =
        convertedSlides.length > 0 ? [convertedSlides?.at(-1)?.at(-1)] : [];

      const animParams = steps.map((step) => this._slideToAnimparams(step));

      for (const animParam of animParams) {
        const anim = this.vizzu.animate(animParam.target);
        await anim;
        const targetData:animTargetData = {
          target: {
            config: this.vizzu.config,
            style: this.vizzu.getComputedStyle(),
          },
        };
        if (animParam.options) {
          targetData.options = animParam.options;
        }
        if (
          animParam.target?.data &&
          "filter" in animParam.target?.data &&
          animParam.target.data.filter !== undefined
        ) {
          targetData.target.data = { filter: animParam.target.data.filter };
          lastFilter = animParam.target.data.filter;
        } else if (targetData.target.filter) {
          targetData.target.data = { filter: animParam.target.filter };
        } else if (lastFilter) {
          targetData.target.data = { filter: lastFilter };
        }

        chartSteps.push(targetData);
      }
      convertedSlides.push(chartSteps);
    }
    if (convertedSlides.length > 0) {
      await this.vizzu.animate(convertedSlides[this._currentSlide || 0]);
    }
    this.vizzu.off("animation-begin", seekToEnd);

    return convertedSlides;
  }

  _slideFromHash(length: number): number {
    const hashSlide = parseInt(document.location.hash.substring(1));

    return this._normalizeSlideNumber(hashSlide, length);
  }

  _getStartSlide(length: number):number {
    const startSlide = parseInt(this.getAttribute("start-slide")|| "0") || 0;

    return this._normalizeSlideNumber(startSlide, length);
  }

  _normalizeSlideNumber(nr:number, length:number) {
    if (isNaN(nr)) return 0;
    if (!nr) return 0;
    return nr < 0 ? Math.max(length + nr, 0) : Math.min(nr - 1, length - 1);
  }

  get slides() {
    return this._slides;
  }

  set slides(slidesSourceData:Story) {
    const slides:Story = this._recursiveCopy(slidesSourceData);
    let startSlide = this._getStartSlide(slides.slides.length);
    if (this.hashNavigation) {
      const hashSlide = this._slideFromHash(slides.slides.length);
      if (hashSlide !== null) {
        startSlide = hashSlide;
      }
    }
    this._currentSlide = startSlide;
    this._setSlides(slides);
  }

  _recursiveCopy(obj) {
    if (obj === null) return null;
    const clone = Object.assign({}, obj);
    Object.keys(clone).forEach(
      (key) =>
        (clone[key] =
          typeof obj[key] === "object"
            ? this._recursiveCopy(obj[key])
            : obj[key])
    );
    if (Array.isArray(obj)) {
      clone.length = obj.length;
      return Array.from(clone);
    }
    return clone;
  }

  async _setSlides(slides:Story) {
    this.setAttribute("initializing", "");
    this._originalSlides = slides;
    this._slides = await this._convertSlides(slides);
    this.setSlide(this._currentSlide);
    this.removeAttribute("initializing");
    this._resolvePlayer();
  }

  get vizzuCanvas() {
    return this.shadowRoot.getElementById("vizzu");
  }

  get length() {
    return this._slides?.length || 0;
  }

  get currentSlide() {
    return this._currentSlide;
  }

  set currentSlide(slide) {
    this.setSlide(slide);
  }

  get slide() {
    return this._slides?.[this._currentSlide];
  }

  get _includeController() {
    return this.hasAttribute("controller");
  }

  _step(step:Anim.Keyframe[], options = {}) {
    this.animationQueue.enqueue(step, options, {
      currentSlide: this._currentSlide,
    });
  }

  async _seekTo(percent:number) {
    this.vizzu.animation.seek(`${percent}%`);
  }

  async _seekToStart() {
    return this._seekTo(0);
  }

  async _seekToEnd() {
    return this._seekTo(100);
  }

  set seekPosition(percent) {
    this._seekPosition = percent;
  }

  get seekPosition() {
    return this._seekPosition;
  }

  set animationQueue(queue) {
    this._animationQueue = queue;
  }

  get animationQueue() {
    return this._animationQueue;
  }

  async setSlide(slide:number) {
    if (this.length === 0) {
      return;
    }

    if (
      this._state.seekPosition &&
      ((slide <= 0 && this._currentSlide === 0) ||
        (this._slides.length <= slide &&
          this._currentSlide === this._slides.length - 1) ||
        slide === this._currentSlide)
    ) {
      return;
    }

    this._update();

    const actualSlideKey = this._currentSlide || 0;
    if (!slide || slide < 0) {
      slide = 0;
    } else if (slide >= this.length) {
      slide = this.length - 1;
    }
    this._currentSlide = slide;
    this.direction = "normal";
    if (actualSlideKey - slide === 1) {
      if (actualSlideKey > 0) {
        this.direction = "reverse";
        const currentSlide = this._slides[actualSlideKey];

        this._step(currentSlide, { position: 1, direction: "reverse" });
        this.lastAnimation = currentSlide;
      }
    } else if (actualSlideKey - slide === -1) {
      const ns = this._slides[slide];
      this._step(ns);
      this.lastAnimation = ns;
    } else {
      const targetSlide = this._slides[slide];
      const currentSlide = this._slides[actualSlideKey];

      this._step([currentSlide.at(-1), ...targetSlide]);
      this.lastAnimation = targetSlide;
    }

    this._update();

    if (this.hashNavigation) {
      document.location.hash = `#${slide + 1}`;
    }
  }

  next() {
    return this.setSlide(this.currentSlide + 1);
  }

  previous() {
    return this.setSlide(this.currentSlide - 1);
  }

  toStart() {
    return this.setSlide(0);
  }

  toEnd() {
    return this.setSlide(this.length - 1);
  }

  async seek(percent:number) {
    this._update();
    this.log(
      `seek to ${percent}%, current: ${this._seekPosition}% [${this._currentSlide}]`
    );
    this.vizzu.animation.seek(`${percent}%`);
    this._update();
  }

  get _state() {
    return {
      currentSlide: this.currentSlide,
      slide: this.slide,
      seekPosition: this._seekPosition,
      length: this.length,
    };
  }

  _update() {
    const e = new CustomEvent("update", { detail: this._state });
    this.dispatchEvent(e);
  }

  get customSpinner() {
    return this.getAttribute("custom-spinner");
  }

  private _render() {
    return `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          --_c: var(--vizzu-color, #333);
          --_bg: var(--vizzu-background-color, #fff);
          background-color: var(--_bg);
        }
        :host(:focus) {
          outline: none;
        }
        :host([initializing]) #vizzu {
          visibility: hidden;
        }
        :host([initializing]) .spinner {
          display: block;
        }
        #vizzucnt {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          max-height: calc(100% - 52px);
          box-sizing: border-box;
          flex: 1;
        }
        #vizzu {
          width: 100%;
          height: 100%;
          flex: 1;
        }
        .spinner {
          display: none;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          margin: auto;
          width: 80px;
          height: 80px;
        }
        ${
          this.customSpinner
            ? `
        .spinner {
          background-image: url(${this.customSpinner});
          background-repeat: no-repeat;
          background-position: center;
          width: auto;
          height: auto;
        }`
            : `
        .spinner:after {
          content: " ";
          display: block;
          width: 64px;
          height: 64px;
          margin: 8px;
          border-radius: 50%;
          border: 6px solid #fff;
          border-color: var(--_c) transparent var(--_c) transparent;
          animation: spin 1.2s linear infinite;
        }`
        }
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      </style>
      <div id="vizzucnt">
        <canvas id="vizzu"></canvas>
        <div class="spinner"></div>
      </div>
      ${
        this._includeController
          ? `<vizzu-controller id="controller" slider-update="input"></vizzu-controller>`
          : ""
      }
      `;
  }
}

try {
  if (!customElements.get("vizzu-player")) {
    customElements.define("vizzu-player", VizzuPlayer);
  } else {
    console.warn("VizzuPlayer already defined");
  }
} catch (e) {
  console.error("Failed to register custom element: ", e);
}

export default VizzuPlayer;
//export { VizzuController: };
