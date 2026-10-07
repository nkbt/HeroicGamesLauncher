// nk: #6 - Frontend jest project (pure-logic tests of fork modules, node env).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { compilerOptions } = require('../../tsconfig')

module.exports = {
  displayName: 'Frontend',

  moduleDirectories: ['node_modules', '<rootDir>'],
  // Module file extensions for importing
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testPathIgnorePatterns: ['./node_modules/'],
  resetMocks: true,

  rootDir: '../..',

  // The root of your source code, typically /src
  // `<rootDir>` is a token Jest substitutes
  roots: ['<rootDir>/src/frontend'],

  testEnvironment: 'node',

  testMatch: ['**/__tests__/**/*.test.ts'],
  // Jest transformations -- this adds support for TypeScript
  // using ts-jest
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },

  // assets and stylesheets resolve to a stub (e.g. GameCard/constants.ts
  // imports a .jpg)
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|svg|webp)$':
      '<rootDir>/src/frontend/nk/test/fileStub.ts',
    '\\.(css|scss)$': '<rootDir>/src/frontend/nk/test/fileStub.ts'
  },
  setupFiles: ['<rootDir>/src/frontend/nk/test/setupJest.ts'],

  modulePaths: [compilerOptions.baseUrl]
}
