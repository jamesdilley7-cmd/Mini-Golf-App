import { Course } from '../../types';
import { hole, ramp, rock, rockBlock, wall, water } from './helpers';

export const sunnyMeadows: Course = {
  id: 'sunny-meadows',
  name: 'Sunny Meadows',
  description: 'A gentle warm-up course with wide open fairways.',
  accentColor: '#3DDC97',
  holes: [
    // 0 — dead simple straight putt to settle in.
    hole(0, 2, { x: 160, y: 520 }, { x: 160, y: 120 }, []),

    // 1 — diagonal to the right, curling around a lone boulder.
    hole(
      1,
      3,
      { x: 100, y: 515 },
      { x: 235, y: 110 },
      [rock(175, 310, 32)]
    ),

    // 2 — "The Carry": ramp launches over a wide pond (or sneak around the
    // narrow turf on either side).
    hole(
      2,
      3,
      { x: 160, y: 530 },
      { x: 160, y: 95 },
      [],
      11,
      {
        ramps: [ramp(160, 380, 130, 28, 2)],
        water: [water(160, 315, 220, 54)],
      }
    ),

    // 3 — "Sidewinder": long diagonal past an angled wall (gaps at both ends).
    hole(
      3,
      3,
      { x: 75, y: 515 },
      { x: 250, y: 110 },
      [wall(150, 300, 150, 14, 20)]
    ),

    // 4 — sweeping curve to the top-left, weaving past a rock and a block.
    hole(
      4,
      4,
      { x: 245, y: 520 },
      { x: 85, y: 110 },
      [rock(160, 320, 30), rockBlock(235, 215, 90, 50, 0)]
    ),

    // 5 — "Twin Gates": staggered walls make you weave right, then left.
    hole(
      5,
      4,
      { x: 160, y: 530 },
      { x: 160, y: 80 },
      [wall(95, 395, 150, 14, 0), wall(225, 215, 150, 14, 0)]
    ),
  ],
};
