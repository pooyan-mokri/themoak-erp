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
    balance: Prisma.Decimal;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface Transaction {
    id: string;
    amount: Prisma.Decimal;
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
    purchasePrice: Prisma.Decimal;
    salvageValue: Prisma.Decimal;
    usefulLife: number;
    depreciationMethod: DepreciationMethod;
    assetType: AssetType;
    createdAt: Date;
    updatedAt: Date;
  }

  // Transaction options interface
  export interface TransactionOptions {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  }

  // PrismaClient class
  export class PrismaClient {
    constructor(options?: {
      datasources?: { db?: { url?: string } };
      log?: Array<'query' | 'info' | 'warn' | 'error'>;
    });
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $transaction<R>(fn: (prisma: PrismaClient) => Promise<R>, options?: TransactionOptions): Promise<R>;

    // Model accessors
    user: any;
    customer: any;
    product: any;
    warehouse: any;
    inventory: any;
    order: any;
    account: any;
    transaction: any;
    supplier: any;
    employee: any;
    shareholder: any;
    loan: any;
    fixedAsset: any;
    project: any;
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

    // Type helpers for GetPayload - these will be replaced by actual Prisma generated types
    export type OrderItemGetPayload<T extends { select?: any; include?: any }> = {
      id: string;
      orderId: string;
      productId: string;
      quantity: number;
      price: Decimal;
      product?: T extends { include: { product: true } } ? any : never;
    };

    export type PurchaseOrderItemGetPayload<T extends { select?: any; include?: any }> = {
      id: string;
      purchaseOrderId: string;
      productId: string;
      quantity: number;
      unitPrice: Decimal;
      product?: T extends { include: { product: true } } ? any : never;
    };

    export interface InventoryAuditWhereInput {
      id?: string;
      warehouseId?: string;
      status?: string;
      createdAt?: { gte?: Date; lte?: Date; };
      AND?: InventoryAuditWhereInput[];
      OR?: InventoryAuditWhereInput[];
      NOT?: InventoryAuditWhereInput[];
    }
  }
}
