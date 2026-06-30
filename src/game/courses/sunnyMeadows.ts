import { Course } from '../../types';
import { hole, ramp, rockBlock, wall, water } from './helpers';

export const sunnyMeadows: Course = {
  id: 'sunny-meadows',
  name: 'Sunny Meadows',
  description: 'A gentle warm-up course with wide open fairways.',
  accentColor: '#3DDC97',
  holes: [
    hole(0, 2, { x: 160, y: 520 }, { x: 160, y: 60 }, []),
    hole(
      1,
      3,
      { x: 100, y: 520 },
      { x: 220, y: 70 },
      [],
      11,
      {
        ramps: [ramp(160, 345, 130, 28, 2)],
        water: [water(160, 290, 250, 56)],
      }
    ),
    hole(
      2,
      3,
      { x: 70, y: 520 },
      { x: 250, y: 70 },
      [wall(225, 300, 190, 16, 0)]
    ),
    hole(
      3,
      3,
      { x: 160, y: 520 },
      { x: 160, y: 80 },
      [wall(110, 350, 16, 260, 0), wall(210, 350, 16, 260, 0)]
    ),
    hole(
      4,
      4,
      { x: 240, y: 520 },
      { x: 80, y: 80 },
      [rockBlock(160, 300, 90, 50, 0)],
      11,
      { water: [water(130, 170, 200, 44)] }
    ),
    hole(
      5,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [wall(90, 380, 140, 16, 0), wall(230, 200, 140, 16, 0)]
    ),
  ],
};
