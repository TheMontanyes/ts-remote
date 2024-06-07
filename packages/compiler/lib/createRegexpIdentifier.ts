export const createRegexpIdentifier = (identifier: string) =>
  new RegExp(`(?<![.'"])\\b${identifier}\\b(?!['":?])`, 'gm');
