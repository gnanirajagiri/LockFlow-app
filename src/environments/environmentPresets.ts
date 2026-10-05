/**
 * Maya environment presets — mockup 6 "Choose a base environment".
 *
 * Pure data: each preset seeds a fresh environment's v1 draft spec via the
 * existing `EnvironmentsService.updateSpec` (text anchors only) plus the
 * draft's lock level. No generation, no image analysis — presets are editorial
 * starting points the creator edits and locks themselves.
 */
import type { EnvironmentLockLevel } from '../domain/environments';

export interface EnvironmentPreset {
  key: string;
  name: string;
  description: string;
  /** CSS modifier for the card's gradient media block. */
  mediaClass: string;
  roomType: string;
  spec: {
    roomType: string;
    layoutFeel: string;
    heroAngle: string;
    lightingStyle: string;
    continuityNotes: string;
  };
  lockLevel: EnvironmentLockLevel;
}

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    key: 'warm-bedroom',
    name: 'Warm Bedroom Studio',
    description: 'Soft morning light, lived-in textures — ideal for routine and self-care stories.',
    mediaClass: 'lf-epreset__media--bedroom',
    roomType: 'Interior · bedroom',
    spec: {
      roomType: 'Bedroom',
      layoutFeel: 'Warm, lived-in, gently cluttered',
      heroAngle: 'North-facing window, wide three-quarter view',
      lightingStyle: 'Warm natural window light, sheer curtains',
      continuityNotes:
        'Bed against the left wall, vanity by the window, plants on the shelf — keep all three anchored.',
    },
    lockLevel: 'balanced',
  },
  {
    key: 'glass-loft',
    name: 'Glass Loft Kitchen',
    description: 'Bright daylight loft kitchen with an open counter — product demos and routines.',
    mediaClass: 'lf-epreset__media--loft',
    roomType: 'Interior · kitchen',
    spec: {
      roomType: 'Kitchen / loft',
      layoutFeel: 'Open plan, airy, editorial',
      heroAngle: 'Counter-height, facing the window wall',
      lightingStyle: 'Bright diffused daylight, soft bounce off glass',
      continuityNotes:
        'Island counter centred, stools tucked, open shelving right — counter stays clear for product placement.',
    },
    lockLevel: 'balanced',
  },
  {
    key: 'cafe-terrace',
    name: 'City Café Terrace',
    description: 'Golden-hour street café — lifestyle, social and on-the-go moments.',
    mediaClass: 'lf-epreset__media--cafe',
    roomType: 'Exterior · café',
    spec: {
      roomType: 'Café terrace',
      layoutFeel: 'Street-side, relaxed, candid',
      heroAngle: 'Across the table, street visible behind',
      lightingStyle: 'Golden hour, warm practical string lights',
      continuityNotes:
        'Two-seater marble table, rattan chairs, awning overhead — street signage stays constant.',
    },
    lockLevel: 'flexible',
  },
  {
    key: 'clean-backdrop',
    name: 'Clean Studio Backdrop',
    description: 'Seamless controlled backdrop — the strictest choice for identical product output.',
    mediaClass: 'lf-epreset__media--backdrop',
    roomType: 'Studio · backdrop',
    spec: {
      roomType: 'Studio',
      layoutFeel: 'Minimal, seamless, controlled',
      heroAngle: 'Straight-on, product height',
      lightingStyle: 'Softbox key at 45°, fill card opposite',
      continuityNotes:
        'Backdrop tone and floor line never move; product zone marked centre-frame.',
    },
    lockLevel: 'strict',
  },
];

/** Lock-level explainer copy for the picker and the lock dialog radios. */
export const LOCK_LEVEL_CHOICES: Array<{
  value: EnvironmentLockLevel;
  label: string;
  hint: string;
}> = [
  {
    value: 'flexible',
    label: 'Flexible',
    hint: 'Key anchors stay; styling, props and light can shift between generations.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    hint: 'Defining anchors and layout stay fixed; small styling details may vary.',
  },
  {
    value: 'strict',
    label: 'Strict',
    hint: 'Every element is pinned — generations aim for identical output each time.',
  },
];
