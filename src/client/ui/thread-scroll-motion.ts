const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Factory's transcript motion: exponential follow and a 180 ms ease-out jump to the bottom. */
export class ThreadScrollMotion {
  private frame = 0;
  private generation = 0;

  constructor(
    private readonly scroll: HTMLElement,
    private readonly settled: () => void,
  ) {}

  cancel() {
    this.generation++;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  snap() {
    this.cancel();
    this.scroll.scrollTop = this.scroll.scrollHeight;
    this.settled();
  }

  follow() {
    // Large appends also change content-visibility estimates; gliding through those estimates can
    // leave the reader above the new bottom. Reserve the glide for incremental streaming.
    if (reduced() || this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop > 240) return this.snap();
    this.cancel();
    const generation = this.generation;
    let previous = performance.now();
    const step = (now: number) => {
      if (generation !== this.generation) return;
      const remaining = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop;
      if (remaining <= 2) {
        this.scroll.scrollTop = this.scroll.scrollHeight;
        this.frame = 0;
        this.settled();
        return;
      }
      const dt = Math.min(100, Math.max(1, now - previous));
      previous = now;
      this.scroll.scrollTop += remaining * (1 - Math.exp(-dt / 50));
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  quick() {
    if (reduced()) return this.snap();
    this.cancel();
    const generation = this.generation;
    const from = this.scroll.scrollTop;
    const started = performance.now();
    const step = (now: number) => {
      if (generation !== this.generation) return;
      const t = Math.min(1, (now - started) / 180);
      const target = this.scroll.scrollHeight - this.scroll.clientHeight;
      this.scroll.scrollTop = from + (target - from) * (1 - (1 - t) ** 3);
      if (t >= 1) {
        this.scroll.scrollTop = this.scroll.scrollHeight;
        this.frame = 0;
        this.settled();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  dispose() {
    this.cancel();
  }
}
