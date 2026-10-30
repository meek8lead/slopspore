export class DebugUI {
  private el: HTMLElement;
  private lastUpdate = 0;

  constructor() {
    this.el = document.getElementById('debug')!;
  }

  /**
   * Кнопка «СБРОС» в debug-оверлее (не HUD — это инструмент разработки,
   * как и весь оверлей). Нужна, чтобы тестировщик мог начать новую жизнь,
   * не копаясь в localStorage: сохранение может затащить в далёкую/пустую
   * точку мира, и без сброса игрок застревает на «чистом экране».
   */
  addResetButton(onClick: () => void) {
    const btn = document.createElement('button');
    btn.textContent = 'СБРОС';
    btn.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:10;background:#222;color:#ddd;' +
      'border:1px solid #555;font:12px monospace;padding:4px 10px;cursor:pointer;opacity:0.6';
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
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