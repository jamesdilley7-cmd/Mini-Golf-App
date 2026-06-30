import { Course } from '../../types';
import { castleGreens } from './castleGreens';
import { pirateCove } from './pirateCove';
import { sunnyMeadows } from './sunnyMeadows';

export const COURSES: Course[] = [sunnyMeadows, pirateCove, castleGreens];

export function getCourseById(id: string): Course {
  const course = COURSES.find((c) => c.id === id);
  if (!course) {
    throw new Error(`Unknown course id: ${id}`);
  }
  return course;
}
