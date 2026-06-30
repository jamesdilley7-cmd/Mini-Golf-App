import { Course } from '../../types';
import { hole, ramp, rock, rockBlock, wall, water } from './helpers';

export const pirateCove: Course = {
  id: 'pirate-cove',
  name: 'Pirate Cove',
  description: 'Dodge rocks and thread narrow gates to find the cup.',
  accentColor: '#39A0ED',
  holes: [
    hole(
      0,
      3,
      { x: 160, y: 520 },
      { x: 160, y: 70 },
      [rock(160, 300, 40)]
    ),
    hole(
      1,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [wall(60, 420, 120, 16, 0), wall(260, 260, 120, 16, 0), rock(160, 140, 26)]
    ),
    hole(
      2,
      3,
      { x: 160, y: 520 },
      { x: 160, y: 90 },
      [wall(110, 420, 16, 200, 15), wall(210, 420, 16, 200, -15), rock(160, 250, 18)]
    ),
    hole(
      3,
      5,
      { x: 80, y: 520 },
      { x: 260, y: 70 },
      [rockBlock(220, 280, 110, 70, 0)],
      11,
      {
        ramps: [ramp(220, 190, 110, 26, 2)],
        water: [water(220, 130, 140, 50)],
      }
    ),
    hole(
      4,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 70 },
      [rock(130, 360, 34), rock(190, 200, 34)]
    ),
    hole(
      5,
      5,
      { x: 160, y: 540 },
      { x: 160, y: 40 },
      [
        wall(100, 430, 16, 140, 0),
        wall(220, 430, 16, 140, 0),
        rock(160, 300, 30),
        wall(70, 170, 150, 16, 10),
      ]
    ),
  ],
};
