import { Course } from '../../types';
import { hole, ramp, rock, rockBlock, wall, water } from './helpers';

export const pirateCove: Course = {
  id: 'pirate-cove',
  name: 'Pirate Cove',
  description: 'Dodge rocks and thread narrow gates to find the cup.',
  accentColor: '#39A0ED',
  holes: [
    // 0 — straight, around one big rock.
    hole(
      0,
      3,
      { x: 160, y: 520 },
      { x: 160, y: 80 },
      [rock(160, 300, 40)]
    ),

    // 1 — "Slalom": diagonal weave to the top-right through three rocks.
    hole(
      1,
      4,
      { x: 95, y: 520 },
      { x: 240, y: 95 },
      [rock(150, 385, 26), rock(205, 255, 26), rock(255, 150, 24)]
    ),

    // 2 — "The Funnel": angled walls squeeze the shot, then a central rock.
    hole(
      2,
      3,
      { x: 160, y: 520 },
      { x: 160, y: 90 },
      [wall(110, 420, 16, 200, 15), wall(210, 420, 16, 200, -15), rock(160, 250, 18)]
    ),

    // 3 — "Treasure Island": carry the moat with the ramp to the top-right
    // green, or take the long way round the left of the water.
    hole(
      3,
      5,
      { x: 80, y: 520 },
      { x: 255, y: 95 },
      [rockBlock(150, 330, 110, 60, 0)],
      11,
      {
        ramps: [ramp(255, 210, 110, 28, 2)],
        water: [water(250, 155, 130, 44)],
      }
    ),

    // 4 — "Twin Rocks": diagonal to the top-right, banking past two boulders.
    hole(
      4,
      4,
      { x: 125, y: 520 },
      { x: 235, y: 85 },
      [rock(150, 365, 34), rock(210, 225, 30)]
    ),

    // 5 — "The Long Haul": full-length zigzag through a gate and an angled wall.
    hole(
      5,
      5,
      { x: 160, y: 540 },
      { x: 160, y: 45 },
      [
        wall(100, 430, 16, 140, 0),
        wall(220, 430, 16, 140, 0),
        rock(160, 300, 30),
        wall(70, 170, 150, 16, 10),
      ]
    ),
  ],
};
