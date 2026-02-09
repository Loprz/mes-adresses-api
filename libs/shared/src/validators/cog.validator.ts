import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { isValidJurisdiction } from '../utils/fips.utils';

/**
 * Validates jurisdiction FIPS codes.
 *
 * This replaces the French COG commune validator with US FIPS validation.
 * Accepts:
 * - 5-digit US county FIPS codes (e.g. "06037" for Los Angeles County, CA)
 * - 7-digit US place FIPS codes (e.g. "0644000" for Los Angeles city, CA)
 *
 * Constraint fields:
 * - 'commune' → validates as a current jurisdiction (county or place FIPS)
 * - 'commune_deleguee' → optional, accepts any valid jurisdiction code
 */
@ValidatorConstraint({ name: 'validatorCogCommune' })
export class ValidatorCogCommune implements ValidatorConstraintInterface {
  constructor() {}

  validate(code: string, args: ValidationArguments) {
    const field = args.constraints[0];
    if (field === 'commune') {
      return isValidJurisdiction(code);
    } else if (field === 'commune_deleguee') {
      // Delegated jurisdictions are optional in the US context
      return code ? isValidJurisdiction(code) : true;
    }
  }

  defaultMessage(args: ValidationArguments) {
    const field = args.constraints[0];
    const fieldLabel =
      field === 'commune' ? 'jurisdiction' : 'delegated jurisdiction';
    return (
      'The ' +
      fieldLabel +
      ' FIPS code "' +
      args.value +
      '" is not valid. Must be a 5-digit county or 7-digit place FIPS code.'
    );
  }
}
