import { CONFIG } from '../config';

/**
 * Сериализация состояния мира (правило M4: чем раньше, тем больнее не делать).
 * localStorage, JSON, с версией. Никаких внешних зависимостей.
 */

export interface NpcSaveState {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  tier: 'small' | 'large';
}

export interface GameState {
  version: number;
  ecoLevel: number;
  mass: number;
  energy: number;
  mitosisCount: number;
  position: { x: number; y: number; z: number };
  behavior: Record<string, number>;
  npcs: NpcSaveState[];
  reactivity: { food: number; predator: number; difficulty: number };
  seed: number;
}

export function saveState(state: Omit<GameState, 'version'>): void {
  try {
    const payload: GameState = { ...state, version: CONFIG.save.version };
    localStorage.setItem(CONFIG.save.key, JSON.stringify(payload));
  } catch {
    // приватный режим / переполнение — молча пропускаем, игра не должна падать
  }
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(CONFIG.save.key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.version !== CONFIG.save.version) {
      localStorage.removeItem(CONFIG.save.key);
      return null;
    }
    return parsed as GameState;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(CONFIG.save.key);
  } catch {
    /* noop */
  }
}
