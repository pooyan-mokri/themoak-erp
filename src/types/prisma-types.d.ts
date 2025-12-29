/**
 * Prisma type definitions
 * These match the Prisma schema enums and will be overridden by generated Prisma client
 */

declare module '@prisma/client' {
  // Enums from schema
  export enum Role {
    ADMIN = 'ADMIN',
    ACCOUNTANT = 'ACCOUNTANT',
    WAREHOUSE = 'WAREHOUSE',
    SALES = 'SALES',
    PROJECT_MANAGER = 'PROJECT_MANAGER',
    USER = 'USER',
  }

  export enum Currency {
    TOMAN = 'TOMAN',
    USD = 'USD',
    EUR = 'EUR',
    CNY = 'CNY',
  }

  export enum TransactionType {
    INCOME = 'INCOME',
    EXPENSE = 'EXPENSE',
    TRANSFER = 'TRANSFER',
    ADJUSTMENT = 'ADJUSTMENT',
  }

  export enum AssetType {
    FIXED = 'FIXED',
    CONSUMABLE = 'CONSUMABLE',
  }

  export enum DepreciationMethod {
    STRAIGHT_LINE = 'STRAIGHT_LINE',
    DECLINING_BALANCE = 'DECLINING_BALANCE',
    UNITS_OF_PRODUCTION = 'UNITS_OF_PRODUCTION',
  }

  // Model types (simplified versions matching what's used in code)
  export interface Account {
    id: string;
    name: string;
    type: string;
    currency: Currency;
    balance: any; // Decimal
    createdAt: Date;
    updatedAt: Date;
  }

  export interface Transaction {
    id: string;
    amount: any; // Decimal
    accountId?: string | null;
    projectId?: string | null;
    description?: string | null;
    date: Date;
    type: TransactionType;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface FixedAsset {
    id: string;
    name: string;
    purchaseDate: Date;
    purchasePrice: any; // Decimal
    salvageValue: any; // Decimal
    usefulLife: number;
    depreciationMethod: DepreciationMethod;
    assetType: AssetType;
    createdAt: Date;
    updatedAt: Date;
  }

  // PrismaClient class
  export class PrismaClient {
    constructor(options?: any);
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $transaction<R>(fn: (prisma: any) => Promise<R>, options?: any): Promise<R>;
    [key: string]: any;
  }

  // Prisma namespace
  export namespace Prisma {
    export class Decimal {
      constructor(value: string | number);
      toNumber(): number;
      toString(): string;
    }

    export enum QueryMode {
      default = 'default',
      insensitive = 'insensitive',
    }

    // Type helpers for GetPayload
    export type OrderItemGetPayload<T = {}> = any;
    export type PurchaseOrderItemGetPayload<T = {}> = any;
    export type InventoryAuditWhereInput = any;
  }
}
