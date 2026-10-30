export type BehaviorField =
  | 'predation' | 'herbivory' | 'scavenging' | 'symbiosis'
  | 'motility' | 'sessility' | 'armor' | 'toxicity' | 'evasion'
  | 'photosynthesis' | 'chemosynthesis';

export const BEHAVIOR_FIELDS: BehaviorField[] = [
  'predation', 'herbivory', 'scavenging', 'symbiosis', 'motility',
  'sessility', 'armor', 'toxicity', 'evasion', 'photosynthesis', 'chemosynthesis',
];

/**
 * Каждое поле — EMA в [0,1]. Растёт, когда поведение происходит (state),
 * или при pulse (event: съел еду, съел NPC). Затухает, когда не происходит.
 *
 *   tick(dt, state) — state: { motility: moving, sessility: !moving, ... }
 *   pulse(field)    — разовый импульс, используется для дискретных событий
 */
export class BehaviorProfile {
  predation = 0;
  herbivory = 0;
  scavenging = 0;
  symbiosis = 0;
  motility = 0;
  sessility = 0;
  armor = 0;
  toxicity = 0;
  evasion = 0;
  photosynthesis = 0;
  chemosynthesis = 0;

  private pulses: Record<BehaviorField, number> = {
    predation: 0, herbivory: 0, scavenging: 0, symbiosis: 0, motility: 0,
    sessility: 0, armor: 0, toxicity: 0, evasion: 0, photosynthesis: 0, chemosynthesis: 0,
  };

  private rate: number;
  private pulseDecay: number;

  constructor(rate = 0.15, pulseDecay = 2.5) {
    this.rate = rate;
    this.pulseDecay = pulseDecay;
  }

  pulse(field: BehaviorField, amount = 0.6) {
    this.pulses[field] = Math.min(1, this.pulses[field] + amount);
  }

  tick(dt: number, state: Partial<Record<BehaviorField, boolean>>) {
    const k = 1 - Math.exp(-this.rate * dt);
    const decay = Math.exp(-this.pulseDecay * dt);
    for (const f of BEHAVIOR_FIELDS) {
      this.pulses[f] *= decay;
      const target = Math.min(1, (state[f] ? 1 : 0) + this.pulses[f]);
      (this as unknown as Record<BehaviorField, number>)[f] +=
        (target - (this as unknown as Record<BehaviorField, number>)[f]) * k;
    }
  }

  dominant(): BehaviorField {
    let best: BehaviorField = 'motility';
    let bestV = -1;
    for (const f of BEHAVIOR_FIELDS) {
      const v = (this as unknown as Record<BehaviorField, number>)[f];
      if (v > bestV) {
        bestV = v;
        best = f;
      }
    }
    return best;
  }

  dominantIndex(): number {
    return BEHAVIOR_FIELDS.indexOf(this.dominant());
  }

  snapshot(): Record<BehaviorField, number> {
    const out = {} as Record<BehaviorField, number>;
    for (const f of BEHAVIOR_FIELDS) {
      out[f] = (this as unknown as Record<BehaviorField, number>)[f];
    }
    return out;
  }
}