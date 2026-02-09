import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Point } from '@turf/turf';

/**
 * Validates that a GeoJSON Point has valid WGS84 coordinates.
 *
 * Replaces the French `@etalab/project-legal` Lambert-93 projection check
 * with standard WGS84 coordinate range validation:
 * - Longitude: -180 to 180
 * - Latitude: -90 to 90
 *
 * For US addresses, we additionally check that coordinates fall within
 * a reasonable bounding box for US territories (including Hawaii, Alaska,
 * Guam, USVI, etc.):
 * - Longitude: -180 to -60 (or 130 to 180 for Pacific territories)
 * - Latitude: 15 to 72
 *
 * However, we keep the validation permissive (full WGS84) to allow for
 * edge cases and testing.
 */
@ValidatorConstraint({ name: 'pointCoord', async: true })
export class PointValidator implements ValidatorConstraintInterface {
  async validate(point: Point) {
    if (!Array.isArray(point.coordinates) || point.coordinates.length !== 2) {
      return false;
    }

    const [longitude, latitude] = point.coordinates;

    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
      return false;
    }

    // Standard WGS84 bounds
    if (longitude < -180 || longitude > 180) {
      return false;
    }
    if (latitude < -90 || latitude > 90) {
      return false;
    }

    // Check for NaN/Infinity
    if (!isFinite(longitude) || !isFinite(latitude)) {
      return false;
    }

    return true;
  }

  defaultMessage() {
    return 'The point coordinates are not valid WGS84 (longitude: -180..180, latitude: -90..90)';
  }
}

/**
 * Validates that a LineString has valid WGS84 coordinates.
 */
@ValidatorConstraint({ name: 'lineStringCoord', async: true })
export class LineStringValidator implements ValidatorConstraintInterface {
  async validate(coordinates: any) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return false;
    }

    for (const coord of coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2) {
        return false;
      }

      const [longitude, latitude] = coord;

      if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        return false;
      }

      if (longitude < -180 || longitude > 180) {
        return false;
      }
      if (latitude < -90 || latitude > 90) {
        return false;
      }
      if (!isFinite(longitude) || !isFinite(latitude)) {
        return false;
      }
    }

    return true;
  }

  defaultMessage() {
    return 'The LineString coordinates are not valid';
  }
}
