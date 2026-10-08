// Branded ids: an issue number can't be passed where a PR number is expected. Imports nothing.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type IssueNumber = Brand<number, 'IssueNumber'>;
export type PrNumber = Brand<number, 'PrNumber'>;

export const IssueNumber = (n: number) => n as IssueNumber;
export const PrNumber = (n: number) => n as PrNumber;
