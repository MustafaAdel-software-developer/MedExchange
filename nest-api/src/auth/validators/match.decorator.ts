import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

/** Cross-field equality check (e.g. confirmPassword === password), matching FluentValidation's `.Equal(dto => dto.Password)`. */
export function Match(property: string, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'match',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedProperty] = args.constraints;
          return value === (args.object as Record<string, unknown>)[relatedProperty];
        },
      },
    });
  };
}
