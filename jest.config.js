module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  modulePathIgnorePatterns: ['<rootDir>/archive/'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: 'tsconfig.json', diagnostics: false },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};
