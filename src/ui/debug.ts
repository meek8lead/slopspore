export class DebugUI {
  private el: HTMLElement;
  private lastUpdate = 0;

  constructor() {
    this.el = document.getElementById('debug')!;
  }

  update(lines: string[], behavior?: Record<string, number>) {
    const now = performance.now();
    if (now - this.lastUpdate < 50) return; // ~20 Hz
    this.lastUpdate = now;

    let s = lines.join('\n');
    if (behavior) {
      s += '\n';
      for (const [k, v] of Object.entries(behavior)) {
        const bars = Math.round(v * 10);
        const bar = '|'.repeat(bars) + '·'.repeat(Math.max(0, 10 - bars));
        s += `\n${k.padEnd(15)} [${bar}] ${v.toFixed(2)}`;
      }
    }
    this.el.textContent = s;
  }
}