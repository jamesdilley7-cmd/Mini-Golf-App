import { Course } from '../../types';
import { hole, ramp, rock, rockBlock, wall, water } from './helpers';

export const castleGreens: Course = {
  id: 'castle-greens',
  name: 'Castle Greens',
  description: 'Tight zigzags and long approaches for putting masters.',
  accentColor: '#B968C7',
  holes: [
    hole(
      0,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [wall(70, 440, 140, 14, 0), wall(250, 330, 140, 14, 0), wall(70, 220, 140, 14, 0)]
    ),
    hole(
      1,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [rockBlock(160, 260, 18, 160, 30), wall(40, 260, 16, 300, 0), wall(280, 260, 16, 300, 0)]
    ),
    hole(
      2,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [wall(90, 400, 150, 14, 0), wall(230, 220, 150, 14, 0)],
      9
    ),
    hole(
      3,
      5,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [rock(110, 420, 24), rock(210, 330, 24), rock(110, 240, 24), rock(210, 150, 24)],
      9
    ),
    hole(
      4,
      6,
      { x: 160, y: 540 },
      { x: 160, y: 50 },
      [
        wall(100, 470, 16, 140, 0),
        wall(220, 470, 16, 140, 0),
        wall(40, 330, 140, 16, 0),
        wall(280, 190, 140, 16, 0),
      ],
      9,
      {
        ramps: [ramp(140, 130, 100, 24, 2)],
        water: [water(140, 85, 140, 40)],
      }
    ),
    hole(
      5,
      6,
      { x: 160, y: 545 },
      { x: 250, y: 50 },
      [
        wall(70, 460, 140, 14, 0),
        rock(250, 380, 26),
        wall(230, 300, 140, 14, 0),
        rock(90, 220, 26),
        wall(70, 140, 140, 14, 0),
      ],
      9
    ),
  ],
};
