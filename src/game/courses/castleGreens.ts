import { Course } from '../../types';
import { hole, ramp, rock, rockBlock, wall, water } from './helpers';

export const castleGreens: Course = {
  id: 'castle-greens',
  name: 'Castle Greens',
  description: 'Tight zigzags and long approaches for putting masters.',
  accentColor: '#B968C7',
  holes: [
    // 0 — "Battlements": three offset walls force a tight up-the-middle zigzag.
    hole(
      0,
      4,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [wall(70, 440, 140, 14, 0), wall(250, 330, 140, 14, 0), wall(70, 220, 140, 14, 0)]
    ),

    // 1 — "The Gauntlet": a walled channel split by an angled stone.
    hole(
      1,
      4,
      { x: 160, y: 525 },
      { x: 160, y: 60 },
      [wall(40, 260, 16, 300, 0), wall(280, 260, 16, 300, 0), rockBlock(160, 260, 18, 150, 30)]
    ),

    // 2 — "Long Approach": a diagonal finish to a tucked-away top-right cup.
    hole(
      2,
      4,
      { x: 160, y: 520 },
      { x: 255, y: 90 },
      [wall(90, 400, 150, 14, 0), wall(200, 220, 150, 14, 0)],
      9
    ),

    // 3 — "Rock Garden": a straight-ish slalom through four staggered boulders.
    hole(
      3,
      5,
      { x: 160, y: 520 },
      { x: 160, y: 60 },
      [rock(110, 420, 24), rock(210, 330, 24), rock(110, 240, 24), rock(210, 150, 24)],
      9
    ),

    // 4 — "Moat Crossing": zigzag up to a ramp that carries the castle moat.
    hole(
      4,
      6,
      { x: 160, y: 540 },
      { x: 150, y: 60 },
      [
        wall(100, 470, 16, 140, 0),
        wall(220, 470, 16, 140, 0),
        wall(40, 330, 140, 16, 0),
        wall(280, 190, 140, 16, 0),
      ],
      9,
      {
        ramps: [ramp(150, 180, 120, 26, 2)],
        water: [water(150, 120, 150, 44)],
      }
    ),

    // 5 — "The Winder": a long S all the way to a top-right cup.
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
