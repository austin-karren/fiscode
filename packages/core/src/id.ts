import { ulid } from "ulid";

declare const IdBrand: unique symbol;
export type Id = string & { readonly [IdBrand]: true };

export const newId = (): Id => ulid() as Id;
export const asId = (s: string): Id => s as Id;
