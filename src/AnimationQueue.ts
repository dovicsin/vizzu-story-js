import type { Anim  } from 'vizzu'
import type Vizzu from 'vizzu'

type ParameterOptions = {
  currentSlide: number;
} | null;

export type AnimationParameters = {
  configObject: Anim.Keyframe[];
  animOptions: Anim.ControlOptions;
  parameters: ParameterOptions | null;
}

class AnimationNode {
  configObject: Anim.Keyframe[];
  animOptions: Anim.ControlOptions;
  parameters: ParameterOptions;
  next: AnimationNode | null;

  constructor({configObject, animOptions, parameters=null}:AnimationParameters) {
    this.configObject = configObject;
    this.animOptions = animOptions;
    this.parameters = parameters;
    this.next = null;
  }
}

class AnimationQueue {
  head: AnimationNode | null = null;
  tail: AnimationNode | null = null;
  vizzu: Vizzu;
  playing: boolean = false;
  paused: boolean = false;
  controller: Anim.Control | null = null;
  lastAnimation: {
    configObject: Anim.Keyframe[];
    animOptions: Anim.ControlOptions;
  } | null = null;
  _lastParameters: ParameterOptions = null;


  constructor(vizzu:Vizzu) {
    this.vizzu = vizzu;

    this.vizzu.on("animation-complete", () => {
      this.playing = false;
      this.next();
    });
  }

  enqueue({configObject, animOptions, parameters=null}:AnimationParameters) {
    if (
      this.tail &&
      this.tail.configObject === configObject &&
      this.tail.animOptions === animOptions &&
      this.tail.parameters === parameters
    )
      return;

    const newNode = new AnimationNode({configObject, animOptions, parameters});
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else  if (this.tail) {
      this.tail.next = newNode;
      this.tail = newNode;
    }

    if (!this.playing) {
      this.play();
    }
  }

  dequeue() {
    if (!this.head) return;

    const removedNode = this.head;
    this.head = this.head.next;
    return removedNode;
  }

  insertqueue(configObject:Anim.Keyframe[], animOptions:Anim.ControlOptions) {
    if (!this.head) return;
    const firstAnimation = this.head;
    const newAnimation = new AnimationNode({configObject, animOptions, parameters:null});

    if (!firstAnimation.next) {
      firstAnimation.next = newAnimation;
      this.tail = newAnimation;
    } else {
      newAnimation.next = firstAnimation.next;
      firstAnimation.next = newAnimation;
    }
  }

  isLast(animationNode: AnimationNode) {
    if (!animationNode || !animationNode.next) return true;
    return animationNode.next === null;
  }

  isEmpty() {
    return this.head === null;
  }

  clear() {
    this.head = null;
    this.tail = null;
  }

  peek() {
    return this.head;
  }

  play() {
    this.playing = false;
    if (!this.head) return;

    const firstAnimation = this.head;
    if (firstAnimation?.animOptions?.playState === "paused") {
      this.paused = true;
      firstAnimation.animOptions.playState = "running";
    }

    // change speed when the current animate is not a last
    let configObject = firstAnimation.configObject;

    if (!this.isLast(firstAnimation)) {
      configObject = this._speedUp(firstAnimation.configObject);
    }

    let startSlideConfig = null;
    if (configObject.length > 1) {
      startSlideConfig = configObject[0];
      this.vizzu.feature("rendering", false);
      this.vizzu.animate(startSlideConfig.target, 0);
    }
    this.vizzu
      .animate(configObject, firstAnimation.animOptions)
      .activated.then((control) => {
        this.playing = true;
        this._lastParameters = firstAnimation.parameters || null;
        this.vizzu.feature("rendering", true);
        this.controller = control;

        if (this.paused) {
          control.pause();
        }
      });

    this.lastAnimation = {
      configObject,
      animOptions: firstAnimation.animOptions,
    };
    if (
      !this.paused &&
      firstAnimation.animOptions.direction === "reverse" &&
      startSlideConfig !== null
    ) {
      this.vizzu.animate(startSlideConfig.target, 0);
    }
  }

  next() {
    this.dequeue();

    if (!this.head) {
      this.playing = false;
      return;
    }

    this.play();
  }

  pause() {
    if (!this.controller) return;

    this.playing = false;
    this.paused = true;
    this.controller.pause();
  }

  reverse() {
    if (!this.controller) return;
    this.playing = true;
    this.controller.reverse();
    this.controller.play();
  }

  seekStart(percent:number) {
    this.playing = false;
    if (!this.controller || !this.lastAnimation ) return;
    this.controller.cancel();
    this.vizzu.feature("rendering", false);
    if (this.lastAnimation.configObject.length > 1) {
      this.vizzu.animate(this.lastAnimation.configObject[0].target, {
        position: 1,
        duration: "0s",
      });
    }
    this.vizzu
      .animate(
        this._speedUp(this.lastAnimation.configObject),
        this.lastAnimation.animOptions
      )
      .activated.then((control) => {
        this.controller = control;
        control.pause();
        this.paused = true;
        control.seek(`${percent}%`);
        this.vizzu.feature("rendering", true);
      });
  }

  seek(percent:number) {
    if (!this.controller) return;

    this.controller.seek(`${percent}%`);
  }

  getParameter(key: keyof ParameterOptions): string | null | number {
    if (this._lastParameters && key in this._lastParameters) {
      return this._lastParameters[key];
    }
    return null;
  }

  manualUpdate(animationParameters:AnimationParameters) {
    if (this.controller) {
      this.controller.play();
      this.controller.stop();
    }

    if (!this.head) {
      this.enqueue(animationParameters);
      return;
    }

    // Override the configuration and options of the first animation
    this.head.configObject = animationParameters.configObject;
    this.head.animOptions = animationParameters.animOptions;
    this.play();
  }

  abort() {
    if (!this.controller) return;

    this.playing = false;
    this.paused = false;
    this.controller.stop();
    this.controller = null;
    this.dequeue();
    this.next();
  }

  isPaused() {
    return this.paused;
  }

  isPlaying() {
    return this.playing;
  }

  hasNext() {
    return !!this.head && !!this.head.next;
  }

  continue() {
    if (!this.controller) return;

    this.paused = false;
    this.playing = true;

    if (this.head?.animOptions?.direction === "reverse") {
      this.reverse();
      return;
    }
    this.controller.play();
  }

  _speedUp(configObject:Anim.Keyframe[]):Anim.Keyframe[] {
    if (configObject instanceof Array) {
      return configObject.map((elem) => {
        return { target: elem.target, options: { duration: "500ms" } };
      });
    }
    return [{
      target: configObject,
      options: { duration: "500ms" },
    }];
  }
}

export default AnimationQueue;
