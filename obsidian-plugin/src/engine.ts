// The typing engine: what has been typed, mistakes, accuracy, WPM and the clock.
// No DOM and no Obsidian API; every method takes the current time as an argument so
// it can be tested deterministically.
//
// Rules (same as the Django app):
//  - a wrong key still advances; Backspace steps back and removes the mistake
//  - the run is complete when the end is reached with no mistakes left
//  - the clock only runs while you type: it stops idleMs after your last keystroke
//  - WPM is net: (correct characters / 5) per minute

export interface EngineSnapshot {
  typed: string;
  bankedMs: number;
  keystrokes: number;
  errors: number;
}

export type TypeResult = "correct" | "wrong" | "ignored";

export class TypingEngine {
  readonly chars: string[];
  readonly idleMs: number;
  /** 0 = untyped, 1 = correct, 2 = wrong */
  state: number[];
  typed: string[] = [];
  mistakes = 0;
  keystrokes = 0;
  errors = 0;
  bankedMs = 0;
  segmentStart: number | null = null;
  lastKeyAt = 0;
  /** true after the clock stopped because you stopped typing */
  idle = false;

  constructor(text: string, idleMs: number) {
    // Array.from so characters outside the BMP count once.
    this.chars = Array.from(text);
    this.idleMs = idleMs;
    this.state = new Array<number>(this.chars.length).fill(0);
  }

  static restore(text: string, snapshot: EngineSnapshot, idleMs: number): TypingEngine {
    const engine = new TypingEngine(text, idleMs);
    const previous = Array.from(snapshot.typed);
    if (previous.length === 0 || previous.length > engine.chars.length) return engine;
    previous.forEach((ch, i) => {
      const ok = ch === engine.chars[i];
      engine.state[i] = ok ? 1 : 2;
      if (!ok) engine.mistakes++;
    });
    engine.typed = previous;
    engine.keystrokes = Math.max(snapshot.keystrokes, previous.length);
    engine.errors = snapshot.errors;
    engine.bankedMs = Math.max(0, snapshot.bankedMs);
    return engine;
  }

  get total(): number {
    return this.chars.length;
  }

  get index(): number {
    return this.typed.length;
  }

  get percent(): number {
    return this.total ? (this.index / this.total) * 100 : 0;
  }

  /** At the end with nothing wrong. */
  get complete(): boolean {
    return this.total > 0 && this.index === this.total && this.mistakes === 0;
  }

  get running(): boolean {
    return this.segmentStart !== null;
  }

  type(ch: string, now: number): TypeResult {
    if (this.index >= this.total || this.complete) return "ignored";
    this.touch(now);
    this.keystrokes++;
    const i = this.index;
    const ok = ch === this.chars[i];
    if (!ok) {
      this.errors++;
      this.mistakes++;
    }
    this.state[i] = ok ? 1 : 2;
    this.typed.push(ch);
    return ok ? "correct" : "wrong";
  }

  backspace(now: number): boolean {
    if (this.index === 0) return false;
    this.touch(now);
    const i = this.index - 1;
    if (this.state[i] === 2) this.mistakes--;
    this.state[i] = 0;
    this.typed.pop();
    return true;
  }

  /** Active typing time. Never extends more than idleMs past the last keystroke. */
  elapsedMs(now: number): number {
    if (this.segmentStart === null) return this.bankedMs;
    const end = Math.min(now, this.lastKeyAt + this.idleMs);
    return this.bankedMs + Math.max(0, end - this.segmentStart);
  }

  /** Stop the clock if you've been idle too long. Returns true if it just stopped. */
  tick(now: number): boolean {
    if (this.segmentStart !== null && now - this.lastKeyAt > this.idleMs) {
      this.pause(now);
      return true;
    }
    return false;
  }

  pause(now: number): void {
    if (this.segmentStart === null) return;
    this.bankedMs = this.elapsedMs(now);
    this.segmentStart = null;
    this.idle = true;
  }

  wpm(now: number): number {
    const seconds = this.elapsedMs(now) / 1000;
    if (this.index === 0 || seconds <= 0) return 0;
    const minutes = Math.max(seconds, 1) / 60;
    return Math.max(0, (this.index - this.mistakes) / 5 / minutes);
  }

  accuracy(): number {
    if (this.keystrokes === 0) return 100;
    return Math.max(0, ((this.keystrokes - this.errors) / this.keystrokes) * 100);
  }

  snapshot(now: number): EngineSnapshot {
    return {
      typed: this.typed.join(""),
      bankedMs: this.elapsedMs(now),
      keystrokes: this.keystrokes,
      errors: this.errors,
    };
  }

  private touch(now: number): void {
    this.lastKeyAt = now;
    if (this.segmentStart === null) {
      this.segmentStart = now;
      this.idle = false;
    }
  }
}
